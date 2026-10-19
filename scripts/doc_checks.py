"""Local Markdown anchors and explicit size budgets; never compare document content."""

from __future__ import annotations

import fnmatch
import json
import re
import unicodedata
from html.parser import HTMLParser
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt

if TYPE_CHECKING:
    from pathlib import Path


class HTMLReferences(HTMLParser):
    """Read explicit anchors and links only from parsed HTML tokens."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.anchors = set()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if not value:
                continue
            if key == "id" or (tag == "a" and key == "name"):
                self.anchors.add(value)
            if key == "href" or (tag == "img" and key == "src"):
                self.links.append(value)


def html_references(tokens):
    """Exclude fenced code and code spans from HTML interpretation."""
    parser = HTMLReferences()
    for token in tokens:
        if token.type == "html_block":
            parser.feed(token.content)
        for child in token.children or []:
            if child.type == "html_inline":
                parser.feed(child.content)
    parser.close()
    return parser


def markdown_links(tokens):
    """Yield Markdown and authored HTML destinations, including local fragments."""
    for token in tokens:
        for child in token.children or []:
            if child.type == "link_open":
                yield child.attrGet("href")
            elif child.type == "image":
                yield child.attrGet("src")
    yield from html_references(tokens).links


def heading_slug(text):
    """GitHub-style text slugs: lowercase, retain Unicode letters and hyphens."""
    text = text.lower()
    return "".join(
        "-" if char == " " else char
        for char in text
        if char in " _-" or unicodedata.category(char)[0] in "LMN"
    )


def markdown_anchors(source):
    """Collect heading collisions in source order and explicit HTML anchors."""
    tokens = MarkdownIt().parse(source)
    result = set(html_references(tokens).anchors)
    used = set()
    for index, token in enumerate(tokens):
        if token.type != "heading_open":
            continue
        inline = tokens[index + 1]
        text = "".join(
            child.content
            for child in inline.children or []
            if child.type in {"text", "code_inline", "image", "softbreak"}
        )
        slug = heading_slug(text)
        candidate = slug
        suffix = 0
        while candidate in used:
            suffix += 1
            candidate = f"{slug}-{suffix}"
        used.add(candidate)
        result.add(candidate)
    return result


def check_link(root: Path, source: Path, target: str, cache: dict):  # noqa: PLR0911
    # Each early return identifies a distinct link-validation outcome.
    """Return a diagnostic for an invalid local destination, otherwise None."""
    try:
        url = urlsplit(target)
    except ValueError:
        return f"无效链接：{target}"
    if url.scheme or url.netloc:
        return None
    destination = (
        (source.parent / unquote(url.path)).resolve() if url.path else source.resolve()
    )
    if not destination.is_relative_to(root.resolve()) or not destination.exists():
        return f"本地链接不存在或越出仓库：{target}"
    if url.fragment and destination.is_dir():
        readmes = sorted(
            p for p in destination.iterdir() if p.name.lower() == "readme.md"
        )
        if not readmes:
            return f"目录片段缺少 README：{target}"
        destination = readmes[0].resolve()
        if not destination.is_relative_to(root.resolve()):
            return f"本地链接不存在或越出仓库：{target}"
    if not url.fragment or destination.suffix.lower() != ".md":
        return None
    if destination not in cache:
        cache[destination] = markdown_anchors(destination.read_text(encoding="utf-8"))
    if unquote(url.fragment) not in cache[destination]:
        return f"章节锚点不存在：{target}"
    return None


def source_characters(source):
    """Count all non-whitespace source characters, including code and tables."""
    return len(re.sub(r"\s", "", source))


def validate_policy(policy, root):
    """Validate project-controlled policy before reading its declared documents."""
    if not isinstance(policy, dict) or policy.get("version") != 1:
        raise ValueError("需要 version: 1")
    if set(policy) != {"version", "hard_limits", "soft_limits"}:
        raise ValueError("字段必须为 version、hard_limits、soft_limits")
    hard, soft = policy["hard_limits"], policy["soft_limits"]
    if not isinstance(hard, dict) or not isinstance(soft, list):
        raise TypeError("hard_limits 必须为对象，soft_limits 必须为数组")
    for name, limit in hard.items():
        if not isinstance(name, str) or not name.endswith(".md"):
            raise ValueError("硬预算必须指向 Markdown 文件")
        target = (root / name).resolve()
        if not target.is_relative_to(root.resolve()) or name.startswith(
            ".agents/notes/archived/"
        ):
            raise ValueError("硬预算不得越界或修改冻结历史")
        if type(limit) is not int or limit <= 0:
            raise ValueError("篇幅阈值必须为正整数")
    for rule in soft:
        if not isinstance(rule, dict) or set(rule) != {"glob", "characters"}:
            raise ValueError("软预算字段必须为 glob、characters")
        if not isinstance(rule["glob"], str) or not rule["glob"]:
            raise ValueError("软预算 glob 不能为空")
        if type(rule["characters"]) is not int or rule["characters"] <= 0:
            raise ValueError("篇幅阈值必须为正整数")
    return hard, soft


def check_budgets(root: Path, documents):
    """Read project policy, keeping hard failures separate from warnings."""
    path = root / "scripts/doc-policy.json"
    if not path.exists():
        return [], []
    errors, warnings = [], []
    try:
        hard, soft = validate_policy(json.loads(path.read_text()), root)
        for name, limit in hard.items():
            target = root / name
            if not target.is_file():
                errors.append(f"预算文件不存在：{name}")
                continue
            count = source_characters(target.read_text())
            if count > limit:
                errors.append(
                    f"{name}：{count} 非空白字符超过硬上限 {limit}；先检查内容归属"
                )
        for rule in soft:
            limit = rule["characters"]
            for document in documents:
                relative = document.relative_to(root).as_posix()
                if relative.startswith(".agents/notes/archived/"):
                    continue
                if fnmatch.fnmatchcase(relative, rule["glob"]):
                    count = source_characters(document.read_text())
                    if count > limit:
                        warnings.append(
                            f"{relative}：{count} 非空白字符超过软预算 {limit}；"
                            "审阅主题与导航，不自动拆分"
                        )
    except (OSError, ValueError, TypeError) as error:
        errors.append(f"doc-policy.json: {error}")
    return errors, warnings
