# -*- coding: utf-8 -*-
"""机制探针：逐字段测出 FORBIDDEN_TERM 到底扫了哪些字段，以及否定语境是否被误杀。

只读生产文件（import validator.rules），不改任何东西。
用法： python rulefix/probe_mechanism.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402

# 请求：禁忌标签 alcohol，禁忌字面词「酒」（与官方样例 workflow/examples/intake.json 一致）
REQUEST = {
    "recipient_relation": "pursuit",
    "closeness": "limited",
    "occasion": "birthday",
    "budget_amount": "200.00",
    "currency": "CNY",
    "available_days": 2,
    "forbidden_tags": ["alcohol"],
    "forbidden_terms": ["酒"],
}

CLEAN = "以日常饮用器具为方向，温和不张扬，适合低压力表达。"


def mk(cid, **over):
    c = {
        "id": cid,
        "name": "简洁杯具与杯垫",
        "description": CLEAN,
        "estimated_total": "150.00",
        "currency": "CNY",
        "estimated_preparation_days": 1,
        "tags": ["other"],
        "reason": "回应送礼者希望实用、精致但不张扬的要求。",
        "fact_refs": [],
        "inferences": ["日常用品可能较便于表达低压力祝福。"],
        "unknowns": ["实际价格、库存和送达均未核实。"],
    }
    c.update(over)
    return c


def run(label, cands, expect_note):
    req = json.dumps(REQUEST, ensure_ascii=False)
    got = validate(req, json.dumps({"candidates": cands}, ensure_ascii=False))
    codes = sorted({
        e["code"] for c in got["candidate_results"] for e in c["errors"]
    } | {e["code"] for e in got["errors"]})
    passed = [c["id"] for c in got["candidate_results"] if c["passed"]]
    flag = "命中" if "FORBIDDEN_TERM" in codes else "未命中"
    print(f"  {label}")
    print(f"      status={got['status']:<11} 通过候选={passed}  禁忌判定={flag}  错误码={codes}")
    print(f"      说明: {expect_note}")
    return "FORBIDDEN_TERM" in codes


def three(**over):
    """三个候选都套同一组覆盖字段（只测 c1 的判定，但必须给满 3 个）。"""
    return [mk("c1", **over), mk("c2", name="空白便笺与书写笔"), mk("c3", name="极简桌面收纳托盘")]


print("=" * 78)
print("探针 1：字面命中与否定语境（核心缺陷）")
print("=" * 78)
print("  请求禁忌：tags=['alcohol']  terms=['酒']")
print()
run("A 描述含「酒」字面（未否定）        → 期望命中",
    three(description="精选陈年佳酿，风味醇厚，适合小酌。"),
    "真含忌，应命中")
run("B 描述含「酒」字面（未否定，直白）  → 期望命中",
    three(description="礼盒内含一瓶酒。"),
    "真含忌，应命中")
run("C 描述写「不含酒精」                → 现在是误杀",
    three(description="本方案不含酒精，适合不饮酒的人。"),
    "声明合规，反而被拒 = Q8 缺陷")
run("D 描述写「无酒」                    → 现在是误杀",
    three(description="无酒配方，全家适用。"),
    "声明合规，反而被拒 = Q8 缺陷")
run("E 描述写「不含酒类」                → 现在是误杀",
    three(description="不含酒类的实用礼品。"),
    "声明合规，反而被拒 = Q8 缺陷")

print()
print("=" * 78)
print("探针 2：逐字段定位——「酒」只放进某一个字段，看哪些字段会被扫")
print("=" * 78)
for field, value, note in [
    ("name", "陈年酒礼盒", "name 是否被扫"),
    ("description", "礼盒内含酒。", "description 是否被扫"),
    ("reason", "因为对方喜欢酒，所以选它。", "reason 是否被扫"),
    ("presentation", "呈现时会提到酒。", "presentation 是否被扫"),
]:
    run(f"{field} 含「酒」", three(**{field: value}), note)
for field in ("inferences", "unknowns"):
    run(f"{field}[0] 含「酒」", three(**{field: ["这里提到酒。"]}), f"{field} 是否被扫")

print()
print("=" * 78)
print("探针 3：绕过硬边界（Q7）与双重否定")
print("=" * 78)
run("F 语义是酒但避开字面词（tags=['other']）→ 通过 = Q7 绕过",
    three(name="精选陈年佳酿礼盒", description="风味醇厚的陈年佳酿，适合小酌。"),
    "语义含酒精但无字面词 → 现状通过（漏放坏方案）")
run("G 「不含酒精，但含红酒」→ 期望命中",
    three(description="不含酒精，但含红酒。"),
    "第二次出现未被否定，应命中")
run("H 「并非不含酒精」→ 期望命中（双重否定）",
    three(description="并非不含酒精。"),
    "双重否定，语义回到含忌，应命中")
run("I 「无酒精啤酒」→ 期望未命中（这是合规的）",
    three(description="无酒精啤酒，适合不饮酒的人。"),
    "「无酒精」+「啤酒」是合规品，不应命中（词表扩张的陷阱）")
