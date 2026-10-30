# -*- coding: utf-8 -*-
"""一次性生成 rulefix/apply-package/regression-cases.json（6 条回归用例的**完整原文**）。

为什么需要它：6 条用例都以 `tests/test_cases.json#T01_normal` 的 request / candidate_batch
为底板（同一底板 ≠ 同一断言：c1 的 name/description 不同）。手工誊写容易抄错字段，
故由本脚本从**当前夹具文件**派生，产物是自包含的 6 条完整用例（apply 时按原样追加，
不做任何派生运算），既有可审计的推导过程，又让落地时零推导。

本脚本**只读** tests/test_cases.json，只写规则门修复线自己的 rulefix/apply-package/。

用法： python rulefix/apply-package/materialize-cases.py
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).with_name("regression-cases.json")

CASES = [
    dict(
        id="RF01_negation_bu_han_jiu_jing",
        field="description",
        value="冬季热饮粉与马克杯组合，不含酒精，适合不饮酒的人。",
        expected={"status": "passed", "all_passed": True, "candidate_passed": [True, True, True]},
        note="救回用例（否定路径）：描述含「不含酒精」。修复前该处必报 FORBIDDEN_TERM（"
             "词条「酒」字面命中「酒精」），修复后视为已声明不含，不再命中。断言的是「修复后通过」。",
    ),
    dict(
        id="RF02_negation_wu_jiu_in_name",
        field="name",
        value="单一产地挂耳咖啡礼盒（无酒）",
        expected={"status": "passed", "all_passed": True, "candidate_passed": [True, True, True]},
        note="救回用例（否定路径）：名称含「无酒」。修复前名称字段必报 FORBIDDEN_TERM，"
             "修复后视为已声明不含。断言的是「修复后通过」。",
    ),
    dict(
        id="RF03_negation_bu_han_jiu_lei",
        field="description",
        value="商务茶具与办公桌面摆件，不含酒类，稳重得体。",
        expected={"status": "passed", "all_passed": True, "candidate_passed": [True, True, True]},
        note="救回用例（否定路径）：「不含酒类」——否定标记与词条之间夹一个填充词「类」。"
             "修复前必报 FORBIDDEN_TERM，修复后视为已声明不含。断言的是「修复后通过」。",
    ),
    dict(
        id="RF04_KNOWN_LIMIT_wu_jiu_jing_pijiu_still_rejected",
        field="description",
        value="无酒精啤酒，适合不饮酒的人。",
        expected={"status": "failed", "all_passed": False, "candidate_passed": [False, True, True],
                  "code": "FORBIDDEN_TERM", "path": "candidates[0].description"},
        note="【已知限制的固定夹具——断言的是「仍被拒」，不是「该通过」】中文无词边界，词条「酒」"
             "会命中更长词「啤酒」内部的子串；否定标记「无」只作用于紧随其后的「酒精」，"
             "救不了被嵌进更长词里的字面命中。本用例**故意**保留为红：它是「本轮修复的边界」的"
             "可执行证据。将来若有人把它改成通过（例如引入分词/词边界），必须先改契约与提案文档，"
             "而不是悄悄改断言。修复前后均被拒，因此它在落地批次里不改变判定，只固定边界。",
    ),
    dict(
        id="RF05_true_positive_red_wine_in_description",
        field="description",
        value="精选礼盒，内含一瓶红酒，包装考究。",
        expected={"status": "failed", "all_passed": False, "candidate_passed": [False, True, True],
                  "code": "FORBIDDEN_TERM", "path": "candidates[0].description"},
        note="真阳性用例：真含酒精且**未声明不含**。修复只放宽「已声明不含」的表述，"
             "绝不放过未否定的字面命中。断言的是「修复后仍被拒」。",
    ),
    dict(
        id="RF06_true_positive_maotai_in_name",
        field="name",
        value="茅台酒礼盒",
        expected={"status": "failed", "all_passed": False, "candidate_passed": [False, True, True],
                  "code": "FORBIDDEN_TERM", "path": "candidates[0].name"},
        note="真阳性用例：名称字段真含酒精且未声明不含。与 RF05 一起覆盖 name / description "
             "两条文本路径，防止「只看描述不看名称」式的过度放宽。断言的是「修复后仍被拒」。",
    ),
]


def main():
    data = json.loads((ROOT / "tests" / "test_cases.json").read_text(encoding="utf-8"))
    base = next(c for c in data["cases"] if c["id"] == "T01_normal")
    print(f"底板夹具: T01_normal（forbidden_tags={base['request']['forbidden_tags']}，"
          f"forbidden_terms={base['request']['forbidden_terms']}）")

    out = []
    for spec in CASES:
        request = copy.deepcopy(base["request"])
        batch = copy.deepcopy(base["candidate_batch"])
        batch["candidates"][0][spec["field"]] = spec["value"]
        out.append({"id": spec["id"], "request": request, "candidate_batch": batch,
                    "expected": spec["expected"], "note": spec["note"]})

    ids = [c["id"] for c in out]
    assert len(set(ids)) == 6
    existing = {c["id"] for c in data["cases"]}
    assert not (set(ids) & existing), "新用例 ID 与既有用例冲突"
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8", newline="\n")
    print(f"已写出 {OUT.relative_to(ROOT)}：{len(out)} 条")
    for c in out:
        print(f"  {c['id']:<52} expected={json.dumps(c['expected'], ensure_ascii=False)}")


if __name__ == "__main__":
    sys.exit(main())
