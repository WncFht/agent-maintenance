"""Check owned prose and code with AutoCorrect; only Markdown may be auto-fixed."""

import argparse
import subprocess
from pathlib import Path

SUFFIXES = {
    ".md",
    ".py",
    ".sh",
    ".bash",
    ".zsh",
    ".command",
    ".yaml",
    ".yml",
    ".toml",
    ".json",
    ".jsonc",
    ".js",
    ".cjs",
    ".mjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".css",
    ".less",
    ".html",
}
NAMES = {".prettierrc", ".autocorrectrc"}
EXCLUDED = (".agents/notes/archived/", "assets/.crossnote/")


def selected_paths(root, paths):
    """Select Git-owned or explicitly supplied inputs, including hidden files."""
    explicit = bool(paths)
    if not explicit:
        paths = (
            subprocess.check_output(
                ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                cwd=root,
            )
            .decode("utf-8", "surrogateescape")
            .split("\0")
        )
    selected = []
    for name in sorted(set(paths)):
        if not name:
            continue
        path = root / name
        if path.is_symlink() or not path.is_file():
            if explicit:
                message = f"Not a regular input file: {name}"
                raise ValueError(message)
            continue
        relative = path.resolve().relative_to(root).as_posix()
        if relative.startswith(EXCLUDED):
            continue
        supported = path.suffix in SUFFIXES or path.name in NAMES
        if not supported and not path.suffix:
            with path.open("rb") as source:
                first = source.readline(256)
            supported = first.startswith(b"#!") and any(
                language in first for language in (b"python", b"bash", b"zsh", b"/sh")
            )
        if supported:
            selected.append(relative)
        elif explicit:
            message = f"Unsupported AutoCorrect input: {name}"
            raise ValueError(message)
    return selected


def main():
    """Check all selected files, or fix Markdown without rewriting code strings."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--fix", action="store_true", help="Fix Markdown only")
    parser.add_argument("--list", action="store_true", help="Print selected paths")
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    root = args.root.resolve()
    selected = selected_paths(root, args.paths)
    if args.fix:
        if args.paths and any(Path(path).suffix != ".md" for path in selected):
            parser.error(
                "--fix only accepts Markdown; review code diagnostics manually"
            )
        selected = [path for path in selected if Path(path).suffix == ".md"]
    if not selected:
        parser.error("No eligible input files; refusing an empty check")
    if args.list:
        print("\n".join(selected))
        return 0
    groups = {"": []}
    for name in selected:
        path = root / name
        kind = ""
        if path.name in NAMES:
            kind = "json" if path.name == ".prettierrc" else "yaml"
        elif path.suffix in {".command", ".bash", ".zsh"}:
            kind = "shell"
        elif not path.suffix:
            with path.open("rb") as source:
                first = source.readline(256)
            kind = "python" if b"python" in first else "shell"
        groups.setdefault(kind, []).append(name)
    failed = False
    for kind, paths in groups.items():
        for start in range(0, len(paths), 100):
            result = subprocess.run(
                [
                    "autocorrect",
                    "--fix" if args.fix else "--lint",
                    "--strict",
                    *(["--type", kind] if kind else []),
                    "--",
                    *paths[start : start + 100],
                ],
                cwd=root,
                check=False,
            )
            failed |= result.returncode != 0
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
