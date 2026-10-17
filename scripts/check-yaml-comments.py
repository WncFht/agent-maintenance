"""检查 YAML 纯注释行的 80 显示列上限，排除标量中的字面内容。"""

import argparse
import subprocess
import sys
import unicodedata
from pathlib import Path

import yaml
from yaml.tokens import ScalarToken

LIMIT = 80


def display_width(text):
    """按终端显示宽度计算列数，制表符展开为 8 列。"""
    return sum(
        2 if unicodedata.east_asian_width(char) in "WF" else 1
        for char in text.expandtabs(8)
    )


def check(path):
    """返回超宽注释诊断；YAML 扫描器负责区分注释与多行标量。"""
    text = path.read_text(encoding="utf-8")
    scalar_lines = set()
    for token in yaml.scan(text):
        if isinstance(token, ScalarToken):
            scalar_lines.update(range(token.start_mark.line + 1, token.end_mark.line))
            if token.style in ("'", '"'):
                scalar_lines.add(token.end_mark.line)
    errors = []
    for number, line in enumerate(text.splitlines()):
        if number in scalar_lines or not line.lstrip().startswith("#"):
            continue
        body = line.lstrip().lstrip("#").strip()
        if " " not in body and display_width(body) == len(body):
            continue
        width = display_width(line)
        if width > LIMIT:
            errors.append(f"{path}:{number + 1}: 注释为 {width} 显示列，上限 {LIMIT}")
    return errors


def main():
    """检查指定文件，未传文件时检查 Git 跟踪的全部 YAML。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", type=Path, nargs="*")
    paths = parser.parse_args().paths
    if not paths:
        paths = (
            subprocess.check_output(
                ["git", "ls-files", "-z", "--", "*.yaml", "*.yml"],
            )
            .decode()
            .split("\0")[:-1]
        )
    if not paths:
        sys.exit("没有可检查的 YAML 文件")
    errors = [error for path in paths for error in check(Path(path))]
    for error in errors:
        print(error)
    return int(bool(errors))


if __name__ == "__main__":
    sys.exit(main())
