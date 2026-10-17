"""验证维护包的技能结构与 Markdown 本地文件链接，不访问外网。"""

from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import unquote, urlsplit

import yaml
from markdown_it import MarkdownIt

SKILLS = {
    "maintain-docs",
    "maintain-prose",
    "maintain-decision-notes",
}
IGNORED = {
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".ruff_cache",
    ".claude",
    ".crossnote",
}


def check(root: Path) -> list[str]:
    errors = []
    skills = root / ".agents/skills"
    found = {p.parent.name for p in skills.glob("*/SKILL.md")}
    if found != SKILLS:
        errors.append(
            f"技能集合不符：缺少 {sorted(SKILLS - found)}；"
            f"多出 {sorted(found - SKILLS)}"
        )
    for name in sorted(found):
        path = skills / name / "SKILL.md"
        parts = path.read_text(encoding="utf-8").split("---", 2)
        try:
            metadata = (
                yaml.safe_load(parts[1]) if len(parts) == 3 and not parts[0] else None
            )
            if not isinstance(metadata, dict) or metadata.get("name") != name:
                raise ValueError("frontmatter name 与目录不符")
            if (
                not isinstance(metadata.get("description"), str)
                or not metadata["description"].strip()
            ):
                raise ValueError("description 为空")
            ui = yaml.safe_load(
                (path.parent / "agents/openai.yaml").read_text(encoding="utf-8")
            )
            if (
                not ui["interface"]["display_name"]
                or not ui["interface"]["short_description"]
            ):
                raise ValueError("界面元数据为空")
        except (ValueError, TypeError, KeyError, OSError, yaml.YAMLError) as exc:
            errors.append(f"{path.relative_to(root)}：{exc}")
    parser = MarkdownIt()
    files = 0
    links = 0
    for path in sorted(root.rglob("*.md")):
        relative = path.relative_to(root)
        if relative.parts[:2] == ("assets", ".crossnote"):
            continue
        if set(relative.parts) & IGNORED or relative.parts[:3] == (
            ".agents",
            "notes",
            "archived",
        ):
            continue
        files += 1
        tokens = parser.parse(path.read_text(encoding="utf-8"))
        for token in tokens:
            for child in token.children or []:
                target = (
                    child.attrGet("href")
                    if child.type == "link_open"
                    else child.attrGet("src")
                    if child.type == "image"
                    else None
                )
                if not target:
                    continue
                url = urlsplit(target)
                if url.scheme or url.netloc or not url.path:
                    continue
                links += 1
                destination = (path.parent / unquote(url.path)).resolve()
                if not destination.is_relative_to(root) or not destination.exists():
                    errors.append(f"{relative}：本地链接不存在或越出仓库：{target}")
    if not files:
        errors.append("没有扫描到 Markdown 文件")
    print(f"Markdown {files} 份，本地文件链接 {links} 条，技能 {len(found)} 个")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path())
    args = parser.parse_args()
    errors = check(args.root.resolve())
    for error in errors:
        print(error)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
