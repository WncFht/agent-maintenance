"""检查单语 Agent Notes 的结构与追加式归档清单。"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

CLASSES = {"feature", "bug-fix", "simplification", "architecture", "process", "testing"}
STATES = {"proposed", "implemented", "rejected", "archived"}
NAME = re.compile(r"(\d{4}-\d{2}-\d{2})-.+\.md$")
DIGEST = re.compile(r"[0-9a-f]{64}$")


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args], text=True, capture_output=True, check=False
    )
    if result.returncode:
        raise ValueError("Git 操作失败：" + result.stderr.strip())
    return result.stdout


def load_manifest(text: str) -> dict[str, str]:
    data = json.loads(text)
    if set(data) != {"version", "files"} or data["version"] != 1:
        raise ValueError("归档清单格式或版本错误")
    files = data["files"]
    if not isinstance(files, dict):
        raise ValueError("files 必须是路径到哈希的对象")
    for name, digest in files.items():
        path = PurePosixPath(name)
        if (
            not isinstance(name, str)
            or path.is_absolute()
            or ".." in path.parts
            or len(path.parts) < 3
            or path.parts[0] != "archived"
            or path.parts[1] not in CLASSES
            or str(path) != name
            or path.name == "AGENTS.md"
            or not isinstance(digest, str)
            or not DIGEST.fullmatch(digest)
        ):
            raise ValueError("非法封存路径或哈希：" + str(name))
    return files


def valid_date(value: str) -> bool:
    try:
        return dt.date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def check_note(path: Path, state: str, errors: list[str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    label = str(path)
    if len(lines) < 4 or not lines[0].startswith("# Agent Note: ") or lines[1] != "":
        errors.append(label + "：标题和空行不符合格式")
        return
    expected = "implemented" if state == "archived" else state
    status = lines[2]
    if expected == "rejected":
        if not re.fullmatch(r"Status: rejected — \S.*", status):
            errors.append(label + "：rejected 需要同一行拒绝原因")
    elif status != "Status: " + expected:
        errors.append(label + "：状态与目录不一致")
    if state == "archived":
        if not lines[3].startswith("Archived: ") or not valid_date(lines[3][10:]):
            errors.append(label + "：归档日期缺失或无效")
        # 冻结历史不接受现行章节格式的追溯改写。
        return
    if lines[3] != "":
        errors.append(label + "：状态后应为空行")
    heads = [line[3:] for line in lines if line.startswith("## ")]
    required = {
        "proposed": ["问题", "提案", "考虑过的替代方案", "验收条件", "风险"],
        "implemented": ["问题", "决策", "考虑过的替代方案", "后果"],
        "rejected": ["问题", "提案", "考虑过的替代方案"],
    }[state]
    if not heads or heads[0] != "问题":
        errors.append(label + "：正文首节必须为问题")
    positions = []
    for heading in required:
        if heads.count(heading) != 1:
            errors.append(label + "：必须有且仅有一个章节：" + heading)
        else:
            positions.append(heads.index(heading))
    if positions != sorted(positions):
        errors.append(label + "：必需章节顺序错误")
    if state == "implemented" and set(heads) & {"提案", "计划", "迁移计划", "验收条件"}:
        errors.append(label + "：已实施记录包含过期计划章节")


def run(root: Path, base: str | None, seal: bool) -> list[str]:
    tree = root / ".agents/notes"
    manifest_path = tree / "archive-seals.json"
    errors: list[str] = []
    if not tree.is_dir():
        return ["缺少 .agents/notes 目录，不能把空扫描报为通过"]
    current = load_manifest(manifest_path.read_text()) if manifest_path.exists() else {}
    if base:
        git(root, "rev-parse", "--verify", base + "^{commit}")
        repo = Path(git(root, "rev-parse", "--show-toplevel").strip()).resolve()
        relative = manifest_path.relative_to(repo).as_posix()
        exists = git(root, "ls-tree", "--name-only", base, "--", relative).strip()
        old = load_manifest(git(root, "show", base + ":" + relative)) if exists else {}
        for name, digest in old.items():
            if current.get(name) != digest:
                errors.append("可信基线中的封存项被修改或删除：" + name)
    found: dict[str, str] = {}
    count = 0
    for path in sorted(tree.rglob("*")):
        if path.is_symlink():
            errors.append("记录目录内不允许软链：" + str(path))
            continue
        if not path.is_file() or path.name in {
            "AGENTS.md",
            "README.md",
            "archive-seals.json",
        }:
            continue
        parts = path.relative_to(tree).parts
        if len(parts) < 3 or parts[0] not in STATES or parts[1] not in CLASSES:
            errors.append("非法生命周期或分类路径：" + str(path))
            continue
        state = parts[0]
        if state == "archived":
            found[path.relative_to(tree).as_posix()] = hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
        match = NAME.fullmatch(path.name)
        if state != "archived" and (len(parts) != 3 or not match):
            errors.append("active 记录命名或层级错误：" + str(path))
            continue
        if match:
            if not valid_date(match[1]):
                errors.append("文件名日期无效：" + str(path))
            check_note(path, state, errors)
            count += 1
    for name, digest in current.items():
        if found.get(name) != digest:
            errors.append("封存文件丢失或内容改变：" + name)
    new = found.keys() - current.keys()
    if new and not seal:
        errors.extend("归档未封存：" + name for name in sorted(new))
    if seal and not errors:
        # 不重算旧哈希；只有新文件可加入。
        merged = current | {name: found[name] for name in sorted(new)}
        manifest_path.write_text(
            json.dumps({"version": 1, "files": merged}, ensure_ascii=False, indent=2)
            + "\n",
            encoding="utf-8",
        )
    print(f"记录 {count} 个，封存文件 {len(found)} 个，新增封存 {len(new)} 个")
    if found and not base:
        print("仅核对当前清单；完整冻结保护还需要可信 --base。")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--base", help="由可信工作流确定的目标历史提交")
    parser.add_argument(
        "--seal", action="store_true", help="审阅封存差异后追加新增哈希"
    )
    args = parser.parse_args()
    try:
        errors = run(args.root.resolve(), args.base, args.seal)
    except (ValueError, OSError, UnicodeError, KeyError, TypeError) as exc:
        errors = [str(exc)]
    for error in errors:
        print(error, file=sys.stderr)
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
