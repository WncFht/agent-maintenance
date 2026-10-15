"""以参数数组运行有依赖的检查；不安装工具、不猜测变更影响。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path


def load(path: Path) -> dict[str, dict]:
    data = json.loads(path.read_text())
    if set(data) != {"version", "checks"} or data["version"] != 1:
        raise ValueError("检查配置格式或版本错误")
    if not isinstance(data["checks"], list) or not data["checks"]:
        raise ValueError("检查列表不能为空")
    result: dict[str, dict] = {}
    for item in data["checks"]:
        if not isinstance(item, dict) or set(item) != {
            "id",
            "command",
            "needs",
            "modes",
            "timeout",
            "allow_failure",
        }:
            raise ValueError(
                "每项需声明 id、command、needs、modes、timeout、allow_failure"
            )
        key = item["id"]
        if not isinstance(key, str) or not key or key in result:
            raise ValueError("检查 id 无效或重复")
        for field in ("command", "needs", "modes"):
            values = item[field]
            if not isinstance(values, list) or any(
                not isinstance(v, str) or not v for v in values
            ):
                raise ValueError(field + " 必须是非空字符串数组")
            if len(values) != len(set(values)) and field != "command":
                raise ValueError(field + " 不能包含重复值")
        if not item["command"] or not item["modes"]:
            raise ValueError("命令和模式不能为空")
        timeout = item["timeout"]
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not 0 < timeout <= 86400
        ):
            raise ValueError("timeout 必须在 0 到 86400 秒之间")
        if not isinstance(item["allow_failure"], bool):
            raise ValueError("allow_failure 必须为布尔值")
        result[key] = item
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(key: str) -> None:
        if key not in result:
            raise ValueError("不存在的依赖：" + key)
        if key in visiting:
            raise ValueError("检查图存在环：" + key)
        if key in done:
            return
        visiting.add(key)
        for dependency in result[key]["needs"]:
            visit(dependency)
        visiting.remove(key)
        done.add(key)

    for key in result:
        visit(key)
    return result


def execute(item: dict, root: Path) -> tuple[str, str, float]:
    start = time.monotonic()
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(
                item["command"],
                cwd=root,
                stdout=output,
                stderr=subprocess.STDOUT,
                timeout=item["timeout"],
                check=False,
            )
            status = "passed" if result.returncode == 0 else "failed"
        except (OSError, subprocess.TimeoutExpired) as exc:
            status = "failed"
            output.write(("\n" + str(exc)).encode())
        output.seek(0, 2)
        output.seek(max(0, output.tell() - 16000))
        tail = output.read().decode("utf-8", errors="replace")
    return status, tail, time.monotonic() - start


def schedule(
    checks: dict[str, dict], mode: str, root: Path, jobs: int
) -> dict[str, str]:
    selected = {key for key, item in checks.items() if mode in item["modes"]}
    if not selected:
        raise ValueError("模式未选择任何检查：" + mode)

    def include(key: str) -> None:
        for dependency in checks[key]["needs"]:
            if dependency not in selected:
                selected.add(dependency)
                include(dependency)

    for key in list(selected):
        include(key)
    status: dict[str, str] = {}
    running = {}
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        while len(status) < len(selected):
            for key in sorted(selected - status.keys() - set(running.values())):
                needs = checks[key]["needs"]
                if not all(dep in status for dep in needs):
                    continue
                if any(status[dep] != "passed" for dep in needs):
                    status[key] = "skipped"
                    print(key + ": skipped（依赖未通过）")
                elif len(running) < jobs:
                    running[pool.submit(execute, checks[key], root)] = key
            if running:
                complete, _ = wait(running, return_when=FIRST_COMPLETED)
                for future in complete:
                    key = running.pop(future)
                    state, output, duration = future.result()
                    status[key] = state
                    print(f"{key}: {state} ({duration:.3f}s)")
                    if output:
                        print(output.rstrip())
            elif len(status) < len(selected):
                # 一个新 skipped 状态可能在下一轮解锁后代。
                if not any(
                    all(dep in status for dep in checks[key]["needs"])
                    for key in selected - status.keys()
                ):
                    raise ValueError("调度无进展")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--mode", required=True)
    parser.add_argument("--root", type=Path, default=Path())
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    try:
        if args.jobs < 1:
            raise ValueError("jobs 必须为正整数")
        checks = load(args.config)
        statuses = schedule(checks, args.mode, args.root.resolve(), args.jobs)
        blocked = [
            key
            for key, state in statuses.items()
            if state != "passed" and not checks[key]["allow_failure"]
        ]
        print("阻断项：" + ("、".join(blocked) or "无"))
        return int(bool(blocked))
    except (ValueError, OSError, TypeError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
