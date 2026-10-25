#!/bin/bash
# Compatibility entry: synchronize owned copies instead of linking source files.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f AGENTS.md || -d .git ]] || {
  echo "error: 请从目标仓 scripts/ 运行此入口（仓根需有 AGENTS.md 或 .git）" >&2
  exit 1
}
SRC="${CROSSNOTE_SRC:-$HOME/src/agent-maintenance/assets/.crossnote}"
[[ -f $SRC/scripts/sync.cjs ]] || {
  echo "error: 同步入口不存在：$SRC/scripts/sync.cjs（使用 CROSSNOTE_SRC 指定维护资源）" >&2
  exit 1
}
exec node "$SRC/scripts/sync.cjs" --target "$PWD" "$@"
