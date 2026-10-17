#!/bin/bash
# git-format-staged 的 stdin→stdout formatter（见 .pre-commit-config.yaml）。
# shfmt/shellcheck 只认 sh/bash/dash/ksh：shebang 为 zsh 的脚本原样透传，
# 其余按 bash 语法以 2 空格缩进格式化。
set -euo pipefail
IFS= read -r first
case "$first" in
*zsh*) {
  printf '%s\n' "$first"
  cat
} ;;
*) {
  printf '%s\n' "$first"
  cat
} | shfmt -i 2 ;;
esac
