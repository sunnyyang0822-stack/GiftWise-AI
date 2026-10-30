# -*- coding: utf-8 -*-
"""场景线总执行入口。

跑三类东西，全部落盘原始输出：
  1. 13 个完整场景走查（S01–S13）
  2. 4 个边界/拒绝场景（B01–B04）
  3. 7 条规则层产品级质疑探针（Q1–Q7）

**零模型调用**：候选要么取自仓库既有产物（evidence），要么按契约人工构造（authored）。
用法：
    python scenarios/run_all.py
输出：
    docs/scenarios/evidence/scenarios-raw.json     全量原始输出
    docs/scenarios/evidence/summary.txt            人读摘要表
    docs/scenarios/evidence/critique-raw.json      质疑探针原始输出
"""

import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_LIB = os.path.join(_HERE, "lib")
for p in (_HERE, _LIB):
    if p not in sys.path:
        sys.path.insert(0, p)

from chain import run_case, summarize                      # noqa: E402
from cases import CASES, BOUNDARY                          # noqa: E402
from critique import run_all as run_critique               # noqa: E402

_ROOT = os.path.dirname(_HERE)
_OUT = os.path.join(_ROOT, "docs", "scenarios", "evidence")


def main():
    os.makedirs(_OUT, exist_ok=True)
    scenarios = [run_case(c) for c in CASES]
    boundary = [run_case(c) for c in BOUNDARY]
    critiques = run_critique()

    with open(os.path.join(_OUT, "scenarios-raw.json"), "w", encoding="utf-8") as fh:
        json.dump({"scenarios": scenarios, "boundary": boundary},
                  fh, ensure_ascii=False, indent=2, sort_keys=True)
    with open(os.path.join(_OUT, "critique-raw.json"), "w", encoding="utf-8") as fh:
        json.dump(critiques, fh, ensure_ascii=False, indent=2, sort_keys=True)

    lines = []
    lines.append("GiftWise AI 场景走查摘要（真实适配层 + 真实规则层，0 次模型调用）")
    lines.append("=" * 96)
    lines.append(f"{'ID':<4} {'关系':<12} {'优先级':<9} {'阶段':<9} {'三案通过':<8} "
                 f"{'可选':<14} {'被拒':<14} 结论")
    lines.append("-" * 96)

    def row(r):
        return (f"{r['id']:<4} {str(r['relation_label'])[:12]:<12} {str(r['priority_group']):<9} "
                f"{str(r['stage']):<9} {str(r['all_passed']):<8} "
                f"{','.join(r['selectable_ids']) or '-':<14} "
                f"{','.join(r['rejected_ids']) or '-':<14} {r['verdict']}")

    lines.append("【一】13 个完整场景走查")
    for r in scenarios:
        lines.append(row(r))
    lines.append("")
    lines.append("【二】4 个边界 / 拒绝场景")
    for r in boundary:
        lines.append(row(r))
    lines.append("")
    lines.append("【三】规则层产品级质疑探针")
    for p in critiques:
        raw = p["raw_output"]
        if isinstance(raw, dict) and "status" in raw:
            detail = (f"status={raw.get('status')} all_passed={raw.get('all_passed')} "
                      f"codes={sorted({e['code'] for e in raw.get('errors', [])})}")
        else:
            detail = json.dumps(raw, ensure_ascii=False)[:120]
        lines.append(f"{p['id']:<4} {detail}")

    text = "\n".join(lines) + "\n"
    with open(os.path.join(_OUT, "summary.txt"), "w", encoding="utf-8") as fh:
        fh.write(text)
    sys.stdout.write(text)

    # 关键不变量自检：规则的"只放行合法方案"是否真的成立
    violations = []
    for r in scenarios + boundary:
        v = r.get("validation")
        if not v:
            continue
        selectable = set(r["selectable_ids"])
        for c in v.get("candidate_results", []):
            if c.get("passed") and c.get("errors"):
                violations.append(f"{r['id']}/{c.get('id')}: passed 但带 errors")
            if (not c.get("passed")) and c.get("id") in selectable:
                violations.append(f"{r['id']}/{c.get('id')}: 被拒却出现在可选集合")
    print("【自检】passed 与 errors 一致性：",
          "全部一致 ✅" if not violations else "发现矛盾 ❌ " + "; ".join(violations))
    return 0 if not violations else 1


if __name__ == "__main__":
    sys.exit(main())
