#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""规则门「否定语义」缺陷现场复现探针（零模型调用、零第三方依赖）。

用途：答辩现场被问「『不含酒精』你们真的会拒吗？」时，一条命令给出真值。
只读 `validator/rules.py` 的公开入口 `validate(request_json, candidates_json)`，
不写任何生产文件。

用法（Windows 本机）：
    "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe" ^
        docs/qa-prep/tools/probe_negation.py

退出码：0 = 复现成功（即"缺陷如描述存在"）；1 = 与预期不符（口径已变，请改答案）。
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from validator.rules import validate  # noqa: E402

# 注意：禁忌词走 request.forbidden_terms（上游 workflow/intake.py 把
# hard_exclusions.terms 映射到这里，见 rulefix/evidence/prove-run.txt §3 映射说明）。
REQUEST = {
    "recipient_relation": "partner",
    "occasion": "birthday",
    "budget_amount": "500.00",
    "currency": "CNY",
    "available_days": 5,
    "forbidden_terms": ["酒"],
    "forbidden_tags": [],
    "facts": [{"id": "interest:coffee_food", "text": "对方对咖啡与美食有兴趣"}],
    "notes": "完全虚构的探针请求：对方禁忌为「酒」。",
}


def candidate(cid: str, desc: str) -> dict:
    return {
        "id": cid,
        "name": "探针候选" + cid,
        "description": desc,
        "estimated_total": "100.00",
        "currency": "CNY",
        "estimated_preparation_days": 1,
        "tags": ["other"],
        "reason": "支撑字段，避免其他闸门干扰。",
        "fact_refs": ["interest:coffee_food"],
        "inferences": ["中性推断"],
        "unknowns": ["未知项"],
    }


CLEAN = "中性描述，不含任何敏感词。"

# (标签, c1 的描述文本, 期望: 'hit' = 现在仍被判 FORBIDDEN_TERM, 'miss' = 不判)
CASES = [
    ("Q8 误杀 · 描述含「不含酒精」", "本组合不含酒精，适合不饮酒的人。", "hit"),
    ("Q8 误杀 · 描述含「不含酒类」", "礼盒不含酒类，另有茶与咖啡。", "hit"),
    ("Q8 误杀 · 描述含「无酒」", "无酒的清单：气泡水与冷萃。", "hit"),
    ("Q8 误杀 · 描述含「无酒精」", "无酒精饮品组合。", "hit"),
    ("Q7 绕过 · 语义是酒但避字面词", "陈年佳酿一瓶，配手工杯。", "miss"),
    ("残留假阳性 · 无酒精啤酒", "无酒精啤酒，适合不饮酒的人。", "hit"),
    ("真阳性 · 未否定的字面命中", "礼盒内含一瓶红酒。", "hit"),
]


def main() -> int:
    req = json.dumps(REQUEST, ensure_ascii=False)
    bad = 0
    print("规则源: %s" % os.path.join(ROOT, "validator", "rules.py"))
    print("禁忌词: %s   候选数: 3（规则要求恰好三个）" % REQUEST["forbidden_terms"])
    print("-" * 78)
    for label, text, expect in CASES:
        cands = json.dumps(
            {"candidates": [candidate("c1", text), candidate("c2", CLEAN), candidate("c3", CLEAN)]},
            ensure_ascii=False,
        )
        out = validate(req, cands)
        codes = [e.get("code") for e in out.get("errors", [])]
        # 候选侧的 FORBIDDEN_TERM 落在 candidate_results[i].errors 里，不在顶层 errors。
        c1 = next((cr for cr in out.get("candidate_results", []) if cr.get("id") == "c1"), {})
        c1_codes = [e.get("code") for e in c1.get("errors", [])]
        c1_paths = [e.get("path") for e in c1.get("errors", [])]
        hit = "FORBIDDEN_TERM" in c1_codes
        got = "hit" if hit else "miss"
        mark = "OK " if got == expect else "!! "
        if got != expect:
            bad += 1
        print("%s%-32s 本题判定=%-4s 期望=%-4s 顶层 status=%s" % (mark, label, got, expect, out.get("status")))
        print("    文本: %s" % text)
        print("    顶层错误码: %s" % (codes or "无"))
        print("    c1 错误码: %s" % (c1_codes or "无"))
        print("    c1 命中路径: %s" % (c1_paths or "无"))
    print("-" * 78)
    print("与预期不符: %d 条" % bad)
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
