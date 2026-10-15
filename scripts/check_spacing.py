"""仅整理自有文本，明确跳过冻结历史与被忽略文件。"""

import argparse
import subprocess
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    paths = (
        subprocess.check_output(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=root,
        )
        .decode()
        .split("\0")
    )
    selected = sorted(
        {
            path
            for path in paths
            if Path(path).suffix in {".md", ".yaml", ".yml"}
            and not path.startswith(".agents/notes/archived/")
            and (root / path).is_file()
            and not (root / path).is_symlink()
        }
    )
    if not selected:
        raise SystemExit("没有选中文字文件，拒绝空检查")
    failed = False
    for start in range(0, len(selected), 100):
        result = subprocess.run(
            [
                "autocorrect",
                "--fix" if args.fix else "--lint",
                *selected[start : start + 100],
            ],
            cwd=root,
            check=False,
        )
        failed |= result.returncode != 0
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
