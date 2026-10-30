#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""指南自检：核对《复核指南》§0.4 结果表与归档 results.json 是否逐项一致。

本工具存在的理由：**指南本身也是对外声明**。
如果指南里写的结果表与某次归档的 `results.json` 不一致（例如后来把 FAIL 改成 PASS、
或删掉了某一行），本工具会直接报不一致并退出码非 0。

它检查 5 件事：
  1. 归档 `results.json` 里的每一项，都能在指南 §0.4 结果表里找到同名同状态的一行；
  2. 每一项声明的"原始输出路径"在磁盘上真实存在；
  3. 每个 FAIL 都同时出现在指南的缺口章节与 `docs/verification/发现的问题.md`；
  4. 每个 SKIP 都写了非空原因；
  5. 指南引用的每个归档目录都真实存在。

用法：
    python tools/verify_guide_selfcheck.py                      # 用最新的 runs/ 目录
    python tools/verify_guide_selfcheck.py --run docs/verification/runs/20261031T005152+0800
退出码：0 = 一致；1 = 不一致（差异逐条打印）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / "docs" / "verification" / "runs"
GUIDE = ROOT / "docs" / "verification" / "复核指南-2026-10-31.md"
PROBLEMS = ROOT / "docs" / "verification" / "发现的问题.md"


def latest_run() -> Path:
    candidates = sorted((p for p in RUNS.iterdir() if p.is_dir() and (p / "results.json").is_file()),
                        key=lambda p: p.name)
    if not candidates:
        raise SystemExit(f"找不到任何归档目录（{RUNS}）")
    return candidates[-1]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="核对复核指南与归档结果是否一致")
    parser.add_argument("--run", default=None, help="归档目录（默认取 runs/ 下最新一个）")
    parser.add_argument("--guide", default=str(GUIDE), help="指南文件路径")
    parser.add_argument("--problems", default=str(PROBLEMS), help="问题登记文件路径")
    args = parser.parse_args(argv)

    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    run_dir = (ROOT / args.run) if args.run else latest_run()
    data = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    guide = Path(args.guide).read_text(encoding="utf-8")
    problems = Path(args.problems).read_text(encoding="utf-8")

    print(f"归档：{data['run_dir']}  tier={data['tier']}  "
          f"PASS {data['passed']} / FAIL {data['failed']} / SKIP {data['skipped']}  "
          f"共 {len(data['rows'])} 项  model_calls={data.get('model_calls')}")

    fails: list[str] = []

    for row in data["rows"]:
        # 指南 §0.4 行形如：| 3 | contract | PASS | 0.5s | ...（允许名称/状态加粗）
        pattern = (rf"\|[^|]*\|\s*\*{{0,2}}`?{re.escape(row['name'])}`?\*{{0,2}}\s*\|"
                   rf"\s*\*{{0,2}}{row['status']}\*{{0,2}}\s*\|")
        if not re.search(pattern, guide):
            fails.append(f"指南结果表缺少或不一致：{row['name']} = {row['status']}")
        if not (ROOT / row["raw_output"]).is_file():
            fails.append(f"原始输出缺失：{row['raw_output']}")
        if row["status"] == "FAIL":
            gap_section = guide.split("## 4.")[0]
            if row["name"] not in gap_section:
                fails.append(f"FAIL 未出现在指南缺口章节：{row['name']}")
            if row["name"] not in problems:
                fails.append(f"FAIL 未登记进问题文件：{row['name']}")
        if row["status"] == "SKIP" and not str(row.get("note", "")).strip():
            fails.append(f"SKIP 未写原因：{row['name']}")

    runs = sorted(p.name for p in RUNS.iterdir() if p.is_dir())
    referenced = sorted(set(re.findall(r"(\d{8}T\d{6}\+0800)", guide)))
    print(f"归档目录 {len(runs)} 个；指南引用 {len(referenced)} 个：{referenced}")
    for name in referenced:
        if name not in runs:
            fails.append(f"指南引用了不存在的归档目录：{name}")

    print()
    if fails:
        print("提示（非判定，不影响退出码）：本自检默认对齐 runs/ 下的**最新归档**，而指南 §0.4 结果表是")
        print("  2026-10-31 00:51:52 那一跑（归档 20261031T005152+0800）的**时点快照**，该表自己声明是时点值。")
        print("  因此此后只要再跑过一次 verify_all.py，最新归档与 §0.4 的逐项状态就会不同——**这种不一致属预期**，")
        print("  不等于指南写错。要判定「指南是否被改动」，请指定与指南同次的归档：")
        print("      python tools/verify_guide_selfcheck.py --run docs/verification/runs/20261031T005152+0800")
        print("❌ 自检不通过（指南与实测归档不一致）：")
        for item in fails:
            print("   -", item)
        return 1
    print("✅ 自检通过：指南结果表与归档逐项一致；FAIL 均已登记；SKIP 均有原因；原始输出齐全。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
