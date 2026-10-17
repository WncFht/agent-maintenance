"""Check owned shell files, dispatching zsh by shebang."""

import argparse
import subprocess
from pathlib import Path

from check_spacing import selected_paths


def main():
    """Fail on every shell violation, including earlier files in a batch."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*")
    parser.add_argument("--fix", action="store_true", help="Format sh/bash only")
    args = parser.parse_args()
    root = Path.cwd()
    paths = args.paths or selected_paths(root, [])
    count = 0
    for name in paths:
        path = root / name
        with path.open(encoding="utf-8") as source:
            first = source.readline()
        if path.suffix not in {".sh", ".bash", ".zsh", ".command"} and (
            not first.startswith("#!")
            or not any(language in first for language in ("bash", "zsh", "/sh"))
        ):
            continue
        count += 1
        commands = (
            [["zsh", "-n", name]]
            if "zsh" in first or path.suffix == ".zsh"
            else [
                ["shfmt", "-w" if args.fix else "-d", "-i", "2", name],
                ["shellcheck", "-S", "warning", name],
            ]
        )
        for command in commands:
            subprocess.run(command, check=True)
    if not count:
        parser.error("No eligible shell files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
