#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CONTRACT-001 探针 1/3：错误码全量清点与动态触发。

用途：把「契约文档的错误码清单」与「代码实际会发出的错误码」做双向对账，
并证明每一个静态声明的码都能被真实输入触达（不是纸面声明）。

用法（从仓库根执行；脚本自身定位仓库根，任意 cwd 均可）：
    python docs/test-reports/contract-001/tools/probe_error_codes.py

口径：
    - validator/rules.py 静态声明 19 个码  -> 必须 19/19 动态触达
    - workflow/intake.py  静态声明  9 个码  -> 必须  9/9 动态触达
      （另有 1 个 UNKNOWN_TAG 由 validator 复核 request 时透传，合计适配层可达 10 个）
    - workflow/runtime.py  静态声明 3 个码  -> 必须  3/3 动态触达

退出码：全部触达为 0，否则 1（便于 PM/QA 直接当门禁用）。
本脚本只读调用公开函数，不写仓库文件、不访问网络、不调用模型。
"""

import ast
import copy
import json
import sys
from pathlib import Path
from unittest.mock import patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve()
REPO_ROOT = HERE.parents[4]  # tools -> contract-001 -> test-reports -> docs -> <repo>
sys.path.insert(0, str(REPO_ROOT))

import validator.rules as rules                                     # noqa: E402
from validator.rules import validate                                # noqa: E402
from workflow.intake import adapt_intake, dump                       # noqa: E402
from workflow.runtime import check, main, recheck                    # noqa: E402

BASE_INTAKE = json.loads(
    (REPO_ROOT / "workflow/examples/intake.json").read_text(encoding="utf-8"))
BATCH = json.loads(
    (REPO_ROOT / "workflow/examples/candidates.json").read_text(encoding="utf-8"))
REQ = json.loads(adapt_intake(dump(BASE_INTAKE))["request_json"])
RJ = dump(REQ)
BJ = dump(BATCH)

SOURCES = ("validator/rules.py", "workflow/intake.py", "workflow/runtime.py")


# ---------------------------------------------------------------- 静态清点
def static_codes(rel_path):
    """AST 提取 `_error(errors, "CODE", ...)` / `err("CODE", ...)` / {"code": "CODE"}。

    只统计**发出点**：`e["code"] == "X"` 这类比较不会被计入（字典字面量才计入）。
    """
    tree = ast.parse((REPO_ROOT / rel_path).read_text(encoding="utf-8"))
    found = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in ("_error", "err"):
            idx = 1 if node.func.id == "_error" else 0
            if len(node.args) > idx:
                arg = node.args[idx]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    found.setdefault(arg.value, []).append(node.lineno)
        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and k.value == "code" \
                        and isinstance(v, ast.Constant) and isinstance(v.value, str):
                    found.setdefault(v.value, []).append(node.lineno)
    return {k: sorted(set(v)) for k, v in sorted(found.items())}


INVENTORY = {src: static_codes(src) for src in SOURCES}


# ---------------------------------------------------------------- 动态触发
def codes_of(output):
    """从任一层的返回值里收集错误码：适配层/校验器/包装层通用。

    - validator.validate / admit 层：errors + candidate_results[].errors
    - workflow.runtime.recheck：workflow_errors
    - workflow.runtime.main：结果封在 envelope_json 字符串里
    """
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except ValueError:
            return set()
    if not isinstance(output, dict):
        return set()
    codes = {e.get("code") for e in output.get("errors") or []}
    codes |= {e.get("code") for e in output.get("workflow_errors") or []}
    for c in output.get("candidate_results") or []:
        if isinstance(c, dict):
            codes |= {e.get("code") for e in c.get("errors") or []}
    if "envelope_json" in output:
        codes |= codes_of(output["envelope_json"])
    return {c for c in codes if c}


def mreq(**kw):
    return dump(dict(REQ, **kw))


def mbatch(idx, field, value):
    b = copy.deepcopy(BATCH)
    b["candidates"][idx][field] = value
    return dump(b)


def over_len(n):
    """构造恰好 n 个 UTF-8 字节、根非对象的 JSON 参数。"""
    body = "a" * (n - 4)
    raw = '["' + body + '"]'
    assert len(raw.encode("utf-8")) == n, len(raw.encode("utf-8"))
    return raw


def dup_content():
    b = copy.deepcopy(BATCH)
    for c in b["candidates"][:2]:
        c["name"] = "同一名称"
        c["description"] = "同一描述"
    return dump(b)


def internal_error():
    with patch.object(rules, "_request", side_effect=RuntimeError("probe")):
        return rules.validate(RJ, BJ)


VALIDATOR_CASES = [
    ("INVALID_TYPE", "request 参数不是字符串", lambda: validate(None, BJ)),
    ("INVALID_JSON", "request 参数损坏 JSON", lambda: validate("{", BJ)),
    ("LIMIT_EXCEEDED", "request 参数 32769 UTF-8 字节（上限+1）", lambda: validate(over_len(32769), BJ)),
    ("MISSING_FIELD", "request 缺 occasion", lambda: validate(dump({k: v for k, v in REQ.items() if k != "occasion"}), BJ)),
    ("INVALID_AMOUNT", "预算前导零（0200）", lambda: validate(mreq(budget_amount="0200"), BJ)),
    ("INVALID_REQUEST", "request 根节点非对象", lambda: validate("[]", BJ)),
    ("UNSUPPORTED_CURRENCY", "币种 USD", lambda: validate(mreq(currency="USD"), BJ)),
    ("DUPLICATE_ID", "request.facts 的 ID 重复", lambda: validate(mreq(facts=[{"id": "f1", "text": "a"}, {"id": "f1", "text": "b"}]), BJ)),
    ("UNKNOWN_TAG", "forbidden_tags 含词表外类别", lambda: validate(mreq(forbidden_tags=["nonsense"]), BJ)),
    ("INVALID_CANDIDATE_ID", "候选 ID 为 c4", lambda: validate(RJ, mbatch(0, "id", "c4"))),
    ("OVER_BUDGET", "候选估算超过预算", lambda: validate(RJ, mbatch(0, "estimated_total", "250.00"))),
    ("PREPARATION_TOO_LONG", "候选准备天数超过可用天数", lambda: validate(RJ, mbatch(0, "estimated_preparation_days", 99))),
    ("CURRENCY_MISMATCH", "候选币种与请求不一致", lambda: validate(RJ, mbatch(0, "currency", "USD"))),
    ("FORBIDDEN_TAG", "候选命中请求禁忌类别", lambda: validate(RJ, mbatch(0, "tags", ["alcohol"]))),
    ("UNKNOWN_FACT_REF", "候选引用不存在的事实 ID", lambda: validate(RJ, mbatch(0, "fact_refs", ["interest:nope"]))),
    ("FORBIDDEN_TERM", "候选文本命中禁忌字面词", lambda: validate(RJ, mbatch(0, "description", "包含酒的组合"))),
    ("INVALID_CANDIDATE_COUNT", "候选只有 2 个", lambda: validate(RJ, dump({"candidates": BATCH["candidates"][:2]}))),
    ("DUPLICATE_CANDIDATE_CONTENT", "两候选名称与描述完全相同", lambda: validate(RJ, dup_content())),
    ("INTERNAL_ERROR", "校验器内部异常兜底（注入 _request 抛错）", internal_error),
]


def intake_payload(**kw):
    d = copy.deepcopy(BASE_INTAKE)
    d.update(kw)
    return dump(d)


def intake_drop(*keys):
    d = copy.deepcopy(BASE_INTAKE)
    for k in keys:
        d.pop(k, None)
    return dump(d)


def intake_internal_error():
    with patch("workflow.intake.validate", return_value={
            "status": "error", "all_passed": False,
            "errors": [{"code": "INTERNAL_ERROR", "path": "$", "message": "probe"}],
            "candidate_results": []}):
        return adapt_intake(dump(BASE_INTAKE))


INTAKE_CASES = [
    ("INTAKE_INVALID_JSON", "损坏 JSON", lambda: adapt_intake("{")),
    ("INVALID_TYPE", "根节点非对象", lambda: adapt_intake("[]")),
    ("INTAKE_UNKNOWN_FIELD", "注入未声明字段", lambda: adapt_intake(intake_payload(nope=1))),
    ("INTAKE_CLARIFICATION_REQUIRED", "缺 recipient_relation", lambda: adapt_intake(intake_drop("recipient_relation"))),
    ("INTAKE_UNKNOWN_LABEL", "未声明关系值 boss", lambda: adapt_intake(intake_payload(recipient_relation="boss"))),
    ("DUPLICATE_ID", "interests 重复标签", lambda: adapt_intake(intake_payload(interests=["coffee_food", "coffee_food"], interest_confidence={}))),
    ("LIMIT_EXCEEDED", "gift_styles 21 项", lambda: adapt_intake(intake_payload(gift_styles=["design"] * 21))),
    ("INTAKE_CONFIDENCE_MISMATCH", "可信度值 unknown", lambda: adapt_intake(intake_payload(interest_confidence={"coffee_food": "unknown"}))),
    ("INTERNAL_ERROR", "复核返回 status=error", intake_internal_error),
]


def runtime_cases():
    good = BJ
    over = mbatch(0, "estimated_total", "250.00")
    tampered = copy.deepcopy(BATCH)
    tampered["candidates"][1]["reason"] = "tampered"
    return [
        ("REPAIR_NOT_ALLOWED", "额度已用仍再次修订", lambda: recheck(RJ, over, good, 1)),
        ("PASSED_CANDIDATE_CHANGED", "修订篡改已通过项", lambda: recheck(RJ, over, dump(tampered))),
        ("WORKFLOW_INPUT_ERROR", "main payload 无效", lambda: main("check", "{}")),
    ]


# ---------------------------------------------------------------- 执行
def run(label, source, declared, cases):
    codes = set(declared)
    print(f"\n=== {label} ===")
    print(f"静态声明：{len(codes)} 个码  {json.dumps(sorted(codes), ensure_ascii=False)}")
    hit, miss = [], []
    for code, desc, fn in cases:
        try:
            got = codes_of(fn())
        except Exception as exc:                                  # pragma: no cover
            print(f"  !! {code:<28} 探针异常 {type(exc).__name__}: {exc}")
            miss.append(code)
            continue
        ok = code in got
        (hit if ok else miss).append(code)
        mark = "触达" if ok else "未触达"
        extra = "" if ok else f"  实际={json.dumps(sorted(got), ensure_ascii=False)}"
        print(f"  [{mark}] {code:<28} {desc}{extra}")
    print(f"动态触达：{len(hit)}/{len(codes)}")
    if miss:
        print(f"未触达：{json.dumps(sorted(miss), ensure_ascii=False)}")
    return len(hit), len(codes), miss


def main_probe():
    print("CONTRACT-001 探针 1/3：错误码全量清点与动态触发")
    print(f"仓库根：{REPO_ROOT}")
    for src in SOURCES:
        print(f"  {src}: {len(INVENTORY[src])} 个静态码")

    vhit, vtot, vmiss = run("validator/rules.py", "validator/rules.py",
                            INVENTORY["validator/rules.py"], VALIDATOR_CASES)
    ihit, itot, imiss = run("workflow/intake.py", "workflow/intake.py",
                            INVENTORY["workflow/intake.py"], INTAKE_CASES)
    rcases = runtime_cases()
    rhit, rtot, rmiss = run("workflow/runtime.py", "workflow/runtime.py",
                            INVENTORY["workflow/runtime.py"], rcases)

    print("\n=== 汇总 ===")
    print(f"validator/rules.py   {vhit}/{vtot}")
    print(f"workflow/intake.py   {ihit}/{itot}（另有 UNKNOWN_TAG 由 validator 透传，适配层可达 "
          f"{len(set(INVENTORY['workflow/intake.py']) | {'UNKNOWN_TAG'})} 个）")
    print(f"workflow/runtime.py  {rhit}/{rtot}")
    passed = vhit == vtot and ihit == itot and rhit == rtot
    print(f"结论：validator {vhit}/{vtot} " + ("全部触达 ✅" if passed else "存在未触达 ❌"))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main_probe())
