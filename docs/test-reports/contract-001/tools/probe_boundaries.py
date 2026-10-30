#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CONTRACT-001 探针 2/3：边界值矩阵实测（含 2026-10-30 数值范围裁决）。

用途：逐条复现 `docs/intake-contract.md` §3 边界值矩阵里记录的实测结论，
并把本轮新裁决的数值范围（请求预算 ∈ [1,10000]、可用天数 ∈ [0,365]、
候选侧不受范围约束）作为**可回归的断言**固定下来。

用法（从仓库根执行；脚本自身定位仓库根，任意 cwd 均可）：
    python docs/test-reports/contract-001/tools/probe_boundaries.py

判定口径：每个场景都能给出「必须出现的码」与「必须不出现的码」；
全部通过退出 0，任一失败退出 1。
本脚本只读调用公开函数，不写仓库文件、不访问网络、不调用模型。
"""

import copy
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve()
REPO_ROOT = HERE.parents[4]
sys.path.insert(0, str(REPO_ROOT))

from validator.rules import validate                                # noqa: E402
from workflow.intake import adapt_intake, dump                       # noqa: E402
from workflow.labels import RELATIONS                                # noqa: E402

BASE_INTAKE = json.loads(
    (REPO_ROOT / "workflow/examples/intake.json").read_text(encoding="utf-8"))
BATCH = json.loads(
    (REPO_ROOT / "workflow/examples/candidates.json").read_text(encoding="utf-8"))
REQ = json.loads(adapt_intake(dump(BASE_INTAKE))["request_json"])
RJ = dump(REQ)
BJ = dump(BATCH)


def codes_of(output):
    codes = {e.get("code") for e in output.get("errors") or []}
    codes |= {e.get("code") for e in output.get("workflow_errors") or []}
    for c in output.get("candidate_results") or []:
        if isinstance(c, dict):
            codes |= {e.get("code") for e in c.get("errors") or []}
    return {c for c in codes if c}


def run_validate(req_json, batch_json, kind):
    out = validate(req_json, batch_json)
    if kind == "intake":
        return out["status"], codes_of(out)
    return out["status"], codes_of(out)


def mreq(**kw):
    return dump(dict(REQ, **kw))


def mbatch(idx, field, value):
    b = copy.deepcopy(BATCH)
    b["candidates"][idx][field] = value
    return dump(b)


def mintake(**kw):
    d = copy.deepcopy(BASE_INTAKE)
    d.update(kw)
    return dump(d)


def nested(n):
    return '{"a":' * n + "1" + "}" * n


# JSON 文本里以 \ud800 转义形式出现、但整体是纯 ASCII 的合法请求。
# 解析后 notes 在内存中是孤立代理字符，用于观察校验器是否拒绝。
# 做法：取一份**完全合法**的请求文本，只把 notes 的值换成转义代理，
# 这样若仍 passed，即可证明该字符被静默接受且不影响校验。
ESCAPED_SURROGATE = RJ.replace(
    json.dumps(REQ.get("notes"), ensure_ascii=False), '"\\ud800"', 1)
assert ESCAPED_SURROGATE != RJ, "notes 替换失败，转义代理用例未生效"


# (分组, 场景, 调用, 必须出现, 必须不出现)
CASES = [
    # ---- 请求预算范围（2026-10-30 裁决 [1, 10000]）----
    ("请求预算", '"0"（下界-1）', lambda: validate(mreq(budget_amount="0"), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("请求预算", '"0.00"', lambda: validate(mreq(budget_amount="0.00"), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("请求预算", '"1"（下界）', lambda: validate(mreq(budget_amount="1"), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("请求预算", '"200.00"', lambda: validate(mreq(budget_amount="200.00"), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("请求预算", '"10000"（上界）', lambda: validate(mreq(budget_amount="10000"), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("请求预算", '"10000.00"（上界）', lambda: validate(mreq(budget_amount="10000.00"), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("请求预算", '"10000.01"（上界+0.01）', lambda: validate(mreq(budget_amount="10000.01"), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("请求预算", '"10001"', lambda: validate(mreq(budget_amount="10001"), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("请求预算", "1000 位数字串", lambda: validate(mreq(budget_amount="9" * 1000), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("请求预算", '"-1"', lambda: validate(mreq(budget_amount="-1"), BJ), {"INVALID_AMOUNT"}, set()),
    ("请求预算", '"0200"（前导零）', lambda: validate(mreq(budget_amount="0200"), BJ), {"INVALID_AMOUNT"}, set()),
    ("请求预算", '"1e3"（指数）', lambda: validate(mreq(budget_amount="1e3"), BJ), {"INVALID_AMOUNT"}, set()),
    ("请求预算", '"２００"（全角）', lambda: validate(mreq(budget_amount="２００"), BJ), {"INVALID_AMOUNT"}, set()),
    ("请求预算", '"1,000"（千位分隔）', lambda: validate(mreq(budget_amount="1,000"), BJ), {"INVALID_AMOUNT"}, set()),
    ("请求预算", '"200😀"', lambda: validate(mreq(budget_amount="200😀"), BJ), {"INVALID_AMOUNT"}, set()),
    ("请求预算", '" 200"（前后空白）', lambda: validate(mreq(budget_amount=" 200"), BJ), {"INVALID_AMOUNT"}, set()),
    # ---- 可用天数范围（2026-10-30 裁决 [0, 365]）----
    ("可用天数", "0（下界，当天）", lambda: validate(mreq(available_days=0), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("可用天数", "1", lambda: validate(mreq(available_days=1), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("可用天数", "365（上界）", lambda: validate(mreq(available_days=365), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("可用天数", "366（上界+1）", lambda: validate(mreq(available_days=366), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("可用天数", "10^20", lambda: validate(mreq(available_days=10 ** 20), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("可用天数", "-1", lambda: validate(mreq(available_days=-1), BJ), {"INVALID_TYPE"}, set()),
    ("可用天数", "True（bool）", lambda: validate(mreq(available_days=True), BJ), {"INVALID_TYPE"}, set()),
    ("可用天数", "1.0（float）", lambda: validate(mreq(available_days=1.0), BJ), {"INVALID_TYPE"}, set()),
    ("可用天数", '"3"（字符串）', lambda: validate(mreq(available_days="3"), BJ), {"INVALID_TYPE"}, set()),
    # ---- 候选侧不受范围约束（2026-10-30 裁决）----
    ("候选侧", 'estimated_total "0.00"', lambda: validate(RJ, mbatch(0, "estimated_total", "0.00")), set(), {"LIMIT_EXCEEDED"}),
    ("候选侧", 'estimated_total "0"', lambda: validate(RJ, mbatch(0, "estimated_total", "0")), set(), {"LIMIT_EXCEEDED"}),
    ("候选侧", 'estimated_total "1000000.00"', lambda: validate(RJ, mbatch(0, "estimated_total", "1000000.00")), {"OVER_BUDGET"}, {"LIMIT_EXCEEDED"}),
    ("候选侧", "estimated_preparation_days 99999", lambda: validate(RJ, mbatch(0, "estimated_preparation_days", 99999)), {"PREPARATION_TOO_LONG"}, {"LIMIT_EXCEEDED"}),
    # ---- 长度与字节上限 ----
    ("上限", "字段 1000 码点", lambda: validate(mreq(notes="备" * 1000), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("上限", "字段 1001 码点", lambda: validate(mreq(notes="备" * 1001), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("上限", "数组 20 项", lambda: validate(mreq(gift_styles=["design"] * 20), BJ), set(), {"LIMIT_EXCEEDED"}),
    ("上限", "数组 21 项", lambda: validate(mreq(gift_styles=["design"] * 21), BJ), {"LIMIT_EXCEEDED"}, set()),
    ("上限", "候选 21 个", lambda: validate(RJ, dump({"candidates": (BATCH["candidates"] * 7)[:21]})), {"INVALID_CANDIDATE_COUNT"}, {"LIMIT_EXCEEDED"}),
    ("上限", "参数 32768 字节（=上限）", lambda: validate('["' + "a" * (32768 - 4) + '"]', BJ), set(), {"LIMIT_EXCEEDED"}),
    ("上限", "参数 32769 字节（上限+1）", lambda: validate('["' + "a" * (32769 - 4) + '"]', BJ), {"LIMIT_EXCEEDED"}, set()),
    # ---- 解析与嵌套 ----
    ("解析", "嵌套 2000 层", lambda: validate(nested(2000), BJ), set(), {"INVALID_JSON"}),
    ("解析", "嵌套 3000 层", lambda: validate(nested(3000), BJ), {"INVALID_JSON"}, set()),
    ("解析", "参数含真实孤立代理字符", lambda: validate("\ud800", BJ), {"INVALID_JSON"}, set()),
    ("解析", "JSON 转义孤立代理（ASCII 文本）", lambda: validate(ESCAPED_SURROGATE, BJ), set(), {"INVALID_JSON"}),
    # ---- 适配层：枚举、注入、标签口径 ----
    ("适配层", "interests 空数组", lambda: adapt_intake(mintake(interests=[], interest_confidence={})), set(), set()),
    ("适配层", "colleague（技术回归值）", lambda: adapt_intake(dump(json.loads((REPO_ROOT / 'workflow/examples/intake-colleague.json').read_text(encoding='utf-8')))), set(), set()),
    ("适配层", "注入 recipient_relation_id", lambda: adapt_intake(mintake(recipient_relation_id="partner")), {"INTAKE_UNKNOWN_FIELD"}, set()),
    ("适配层", 'tags ["ALCOHOL"]（精确匹配）', lambda: adapt_intake(mintake(hard_exclusions={"tags": ["ALCOHOL"], "terms": [], "unresolved": []})), {"INTAKE_UNKNOWN_LABEL"}, set()),
    ("适配层", 'tags [1]（非字符串）', lambda: adapt_intake(mintake(hard_exclusions={"tags": [1], "terms": [], "unresolved": []})), {"INTAKE_UNKNOWN_LABEL", "INVALID_TYPE"}, set()),
    ("适配层", 'tags ["nonsense"]（词表外）', lambda: adapt_intake(mintake(hard_exclusions={"tags": ["nonsense"], "terms": [], "unresolved": []})), {"INTAKE_UNKNOWN_LABEL", "UNKNOWN_TAG"}, set()),
    ("适配层", "interest_confidence unknown", lambda: adapt_intake(mintake(interest_confidence={"coffee_food": "unknown"})), {"INTAKE_CONFIDENCE_MISMATCH"}, set()),
]


def main_probe():
    print("CONTRACT-001 探针 2/3：边界值矩阵实测")
    print(f"仓库根：{REPO_ROOT}")
    print(f"relations（{len(RELATIONS)} 个）：{json.dumps(sorted(RELATIONS), ensure_ascii=False)}\n")
    group, failed = None, 0
    for grp, label, fn, must, forbid in CASES:
        if grp != group:
            group = grp
            print(f"--- {grp} ---")
        try:
            out = fn()
            status = out.get("status", "?")
            got = codes_of(out)
            err = None
        except Exception as exc:                                  # pragma: no cover
            status, got, err = "EXC", set(), f"{type(exc).__name__}: {exc}"
        missing = must - got
        present = forbid & got
        ok = not missing and not present and err is None
        if not ok:
            failed += 1
        mark = "ok  " if ok else "FAIL"
        detail = "" if ok else f"  缺少={sorted(missing)} 不该出现={sorted(present)} {err or ''}"
        print(f"  [{mark}] {label:<34} status={status:<12} codes={json.dumps(sorted(got), ensure_ascii=False)}{detail}")
    total = len(CASES)
    print(f"\n=== 汇总 ===\n边界场景 {total - failed}/{total} 通过")
    print("结论：" + ("全部符合 2026-10-30 契约 ✅" if failed == 0 else f"{failed} 项与契约不符 ❌"))
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main_probe())
