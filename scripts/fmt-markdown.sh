#!/bin/bash
# 管道任一 formatter 失败都须阻断暂存内容改写。
set -euo pipefail
autocorrect --stdin | ./node_modules/.bin/prettier --stdin-filepath "$1"
