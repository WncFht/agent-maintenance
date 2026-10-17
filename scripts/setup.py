"""安装仓库 hooks 与本机技能软链；不安装全局技能、不覆盖外来入口。"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from install_hooks import install


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    framework = shutil.which("pre-commit")
    if not framework:
        raise SystemExit("缺少 pre-commit；先安装 requirements-dev.txt 并激活环境")
    old = subprocess.run(
        ["git", "config", "--get", "core.hooksPath"],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if old.returncode == 0:
        raise SystemExit(
            "已配置 core.hooksPath，保留已有入口；请手动接入 .pre-commit-config.yaml"
        )
    link = root / ".claude/skills"
    if link.is_symlink():
        if link.resolve() != root / ".agents/skills":
            raise SystemExit(".claude/skills 指向外部位置，拒绝覆盖")
    elif link.exists():
        raise SystemExit(".claude/skills 是实体内容，拒绝覆盖")
    else:
        link.parent.mkdir(exist_ok=True)
        link.symlink_to("../.agents/skills", target_is_directory=True)
    install(root)
    install(root, "pre-push")


if __name__ == "__main__":
    main()
