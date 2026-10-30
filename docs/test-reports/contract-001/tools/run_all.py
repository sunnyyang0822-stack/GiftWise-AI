#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CONTRACT-001 探针入口：一条命令跑完全部三个探针。

用法（从仓库根执行；脚本自身定位仓库根，任意 cwd 均可）：
    python docs/test-reports/contract-001/tools/run_all.py

三个探针：
    1. probe_error_codes.py  错误码静态清点 + 逐码动态触发（validator 19/19）
    2. probe_boundaries.py   边界值矩阵实测（含 2026-10-30 数值范围裁决）
    3. probe_doc_parity.py   契约文档与实现的清单双向对账

退出码：三个全通过为 0，任一失败为 1。

实现说明：这里用 importlib 直接加载同级模块并调用其 main_probe()，
不使用 subprocess —— 本仓库的受限执行环境会拒绝创建子进程管道。
"""

import importlib.util
import sys
from pathlib import Path

# 本目录只放探针脚本，不要让加载动作留下 __pycache__
sys.dont_write_bytecode = True

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]          # tools -> contract-001 -> test-reports -> docs -> <repo>
sys.path.insert(0, str(REPO_ROOT))

PROBES = ("probe_error_codes", "probe_boundaries", "probe_doc_parity")


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main():
    print("CONTRACT-001 契约探针套件")
    print(f"仓库根：{REPO_ROOT}")
    results = []
    for name in PROBES:
        print("\n" + "=" * 74)
        try:
            code = load(name).main_probe()
        except Exception as exc:                                  # pragma: no cover
            print(f"  !! {name} 载入/执行异常：{type(exc).__name__}: {exc}")
            code = 1
        results.append((name, code))
    print("\n" + "=" * 74)
    print("汇总：")
    for name, code in results:
        print(f"  [{'PASS' if code == 0 else 'FAIL'}] {name}")
    failed = [n for n, c in results if c]
    print("结论：" + ("全部通过 ✅" if not failed else f"以下探针失败 ❌ {failed}"))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
