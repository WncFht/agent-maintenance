"""导出 Git index 到隔离目录，验证真正将提交的文档与记录。"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    root = Path(
        subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True
        ).strip()
    )
    with tempfile.TemporaryDirectory(prefix="maintenance-index-") as folder:
        snapshot = Path(folder)
        subprocess.run(
            ["git", "checkout-index", "--all", "--prefix", str(snapshot) + os.sep],
            cwd=root,
            check=True,
        )
        for script in ("check_docs.py", "notes_guard.py"):
            result = subprocess.run(
                [
                    sys.executable,
                    str(root / "scripts" / script),
                    "--root",
                    str(snapshot),
                ],
                cwd=root,
                check=False,
            )
            if result.returncode:
                return result.returncode
        # 本地 HEAD 仅用于拦常规误改；CI 使用事件提供的目标历史。
        base = subprocess.run(
            ["git", "rev-parse", "--verify", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        if base.returncode == 0:
            result = subprocess.run(
                [
                    sys.executable,
                    str(root / "scripts/check_archive.py"),
                    "--root",
                    str(snapshot),
                    "--history-root",
                    str(root),
                    "--base",
                    base.stdout.strip(),
                ],
                check=False,
            )
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
