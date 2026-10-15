"""对照可信 Git 历史保护已封存记录；不执行基线之外的代码。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath

from notes_guard import git, load_manifest


def check(root: Path, history: Path, base: str) -> list[str]:
    git(history, "rev-parse", "--verify", base + "^{commit}")
    name = ".agents/notes/archive-seals.json"
    if not git(history, "ls-tree", "--name-only", base, "--", name).strip():
        print("基线没有封存清单；当前清单和正文由 notes_guard 检查。")
        return []
    old = load_manifest(git(history, "show", base + ":" + name))
    manifest = root / name
    current = (
        load_manifest(manifest.read_text(encoding="utf-8")) if manifest.exists() else {}
    )
    errors = []
    for path, digest in old.items():
        target = root / ".agents/notes" / PurePosixPath(path)
        if (
            current.get(path) != digest
            or not target.is_file()
            or target.is_symlink()
            or not target.resolve().is_relative_to(root.resolve())
        ):
            errors.append("基线中的封存项被删除、移动或重写：" + path)
        elif hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            errors.append("基线中的封存内容被重写：" + path)
    print(f"可信历史封存项 {len(old)} 个")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path())
    parser.add_argument("--history-root", type=Path)
    parser.add_argument("--base", default=os.environ.get("MAINTENANCE_BASE"))
    args = parser.parse_args()
    root = args.root.resolve()
    base = args.base
    if not base:
        event = os.environ.get("GITHUB_EVENT_PATH")
        if event:
            payload = json.loads(Path(event).read_text(encoding="utf-8"))
            base = payload.get("pull_request", {}).get("base", {}).get(
                "sha"
            ) or payload.get("before")
        elif not os.environ.get("CI"):
            base = "HEAD"
    if base and set(base) == {"0"}:
        # 首次 push 没有 before；根提交是仓库内能够取得的最早历史。
        base = git(
            (args.history_root or root).resolve(), "rev-list", "--max-parents=0", "HEAD"
        ).splitlines()[0]
        print("首次 push：以根提交作为初始化历史基线。")
    if not base:
        parser.error("需要可信 --base；CI 使用 PR base SHA 或 push before SHA")
    try:
        errors = check(root, (args.history_root or root).resolve(), base)
    except (ValueError, OSError, TypeError) as exc:
        errors = [str(exc)]
    for error in errors:
        print(error)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
