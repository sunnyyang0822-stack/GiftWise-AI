"""从公开契约独立构造完整虚构输入；不读取开发 fixture 或规则实现。"""

import copy
import json
from pathlib import Path


REQUEST = {
    "recipient_relation": "虚构用户的朋友", "occasion": "毕业祝福",
    "budget_amount": "100.10", "currency": "CNY", "available_days": 3,
    "facts": [{"id": "coffee", "text": "喜欢手冲咖啡"},
              {"id": "simple", "text": "喜欢简洁的日常用品"}],
    "forbidden_tags": ["alcohol"], "forbidden_terms": ["烈酒"], "notes": "不需要回应压力"
}
BATCH = {"candidates": [
    {"id": "c1", "name": "手冲分享杯", "description": "一只分享杯，含基础包装配送估算",
     "estimated_total": "99.90", "currency": "CNY", "estimated_preparation_days": 3,
     "tags": ["other"], "reason": "呼应已知咖啡兴趣", "fact_refs": ["coffee"],
     "inferences": ["分享杯可能适合日常使用"], "unknowns": ["实际供应未核实"],
     "presentation": "纸盒基础包装，详细呈现等待选择"},
    {"id": "c2", "name": "纸质阅读手账", "description": "一本手账，含贺卡与配送估算",
     "estimated_total": "48.20", "currency": "CNY", "estimated_preparation_days": 1,
     "tags": ["other"], "reason": "提供书写方向，不假定阅读习惯", "fact_refs": [],
     "inferences": [], "unknowns": ["是否使用纸本"]},
    {"id": "c3", "name": "折叠布袋", "description": "一只随身布袋，含基本呈现费用估算",
     "estimated_total": "35.00", "currency": "CNY", "estimated_preparation_days": 2,
     "tags": ["other"], "reason": "呼应简洁用品偏好", "fact_refs": ["simple"],
     "inferences": ["随身用品可能实用"], "unknowns": ["颜色偏好未提供"]}
]}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build():
    cases = []

    def add(case_id, group, change=None, status="passed", code=None, path=None,
            location="top", passed=None, message=None, mode="normal", absent=None):
        r, b = copy.deepcopy(REQUEST), copy.deepcopy(BATCH)
        if change:
            change(r, b)
        expected = {"status": status, "all_passed": status == "passed", "errors": []}
        if code:
            error = {"code": code, "path": path, "location": location}
            if message:
                error["message"] = message
            expected["errors"].append(error)
        if passed is not None:
            expected["candidate_passed"] = passed
        if absent:
            expected["absent_codes"] = absent
        case = {"id": case_id, "group": group, "request_arg": encoded(r),
                "candidates_arg": encoded(b), "expected": expected, "mode": mode}
        cases.append(case)
        return case

    def field(side, name, value):
        def change(r, b):
            (r if side == "request" else b["candidates"][0])[name] = value
        return change

    add("B001_base", "T01", passed=[True, True, True])
    for side, name in (("request", "budget_amount"), ("candidate", "estimated_total")):
        for i, value in enumerate(("0", "0.0", "0.00", "12", "12.3", "12.30")):
            def valid_money(r, b, side=side, name=name, value=value):
                field(side, name, value)(r, b)
                if side == "request":
                    for candidate in b["candidates"]:
                        candidate["estimated_total"] = "0"
            add(f"money_allowed_{side}_{i}", "T02_T11", valid_money)
        bad_values = ("-0", "-1.00", "00", "01.00", "+1", "1e1", "1,000", "¥1",
                      "１.００", " 1", "1 ", ".5", "1.", "1.001", "NaN", "Infinity", "", "1\n")
        for i, value in enumerate(bad_values + (1, True, None, [], {})):
            add(f"money_reject_{side}_{i}", "T11", field(side, name, value),
                "needs_input" if side == "request" else "failed",
                "INVALID_AMOUNT" if isinstance(value, str) else "INVALID_TYPE",
                f"request.{name}" if side == "request" else f"candidates[0].{name}",
                "top" if side == "request" else 0)
    for value, status in (("100.10", "passed"), ("100.11", "failed")):
        add("budget_boundary_" + value, "T02", field("candidate", "estimated_total", value),
            status, "OVER_BUDGET" if status == "failed" else None,
            "candidates[0].estimated_total", 0, [status == "passed", True, True])
    for side, name in (("request", "available_days"), ("candidate", "estimated_preparation_days")):
        for i, value in enumerate((-1, True, False, 1.0, "3", None, [], {})):
            add(f"days_reject_{side}_{i}", "T04_T11", field(side, name, value),
                "needs_input" if side == "request" else "failed", "INVALID_TYPE",
                f"request.{name}" if side == "request" else f"candidates[0].{name}",
                "top" if side == "request" else 0)
    for days in (0, 3, 4):
        add(f"days_boundary_{days}", "T04", field("candidate", "estimated_preparation_days", days),
            "failed" if days == 4 else "passed", "PREPARATION_TOO_LONG" if days == 4 else None,
            "candidates[0].estimated_preparation_days", 0)
    for side, fields in (("request", ("recipient_relation", "occasion", "budget_amount", "currency", "available_days")),
                         ("candidate", tuple(k for k in BATCH["candidates"][0] if k != "presentation"))):
        for name in fields:
            def remove(r, b, side=side, name=name):
                (r if side == "request" else b["candidates"][0]).pop(name)
            add(f"required_{side}_{name}", "T05_T10", remove,
                "needs_input" if side == "request" else "failed", "MISSING_FIELD",
                f"request.{name}" if side == "request" else f"candidates[0].{name}",
                "top" if side == "request" else 0)
    def empty_optional(r, b):
        r.update(facts=[], forbidden_tags=[], forbidden_terms=[], notes="")
        for c in b["candidates"]:
            c.update(fact_refs=[], inferences=[], unknowns=[])
    add("optional_arrays_empty", "T05_PM_VAL_001", empty_optional, passed=[True, True, True])
    for index in range(3):
        def empty_tags(r, b, index=index):
            b["candidates"][index]["tags"] = []
        add(f"empty_tags_position_{index}", "PM_VAL_001", empty_tags, "failed", "INVALID_TYPE",
            f"candidates[{index}].tags", index, [i != index for i in range(3)],
            "候选类别至少需要一个已知标签")
    for name in ("fact_refs", "inferences", "unknowns", "tags"):
        for i, value in enumerate(("coffee", None, 1, [None], [{}], [""])):
            add(f"array_type_{name}_{i}", "T10_T13", field("candidate", name, value), "failed",
                "INVALID_TYPE", f"candidates[0].{name}" + ("[0]" if isinstance(value, list) else ""), 0)
    for name in ("name", "description", "reason", "presentation"):
        for i, value in enumerate(("", " \t", None, [], 1)):
            add(f"text_type_{name}_{i}", "T10", field("candidate", name, value), "failed",
                "INVALID_TYPE", f"candidates[0].{name}", 0)
    for side in ("request", "candidate"):
        add("currency_" + side, "T09", field(side, "currency", "USD"),
            "needs_input" if side == "request" else "failed",
            "UNSUPPORTED_CURRENCY" if side == "request" else "CURRENCY_MISMATCH",
            "request.currency" if side == "request" else "candidates[0].currency",
            "top" if side == "request" else 0)
    for i, raw in enumerate(("{", "{'x':1}", '{"a":1,"a":2}', '{"outer":{"a":1,"a":2}}',
                             '{"a":NaN}', '{"a":Infinity}', '{"a":-Infinity}', '{} garbage')):
        for side in ("request", "candidates"):
            c = add(f"parse_{side}_{i}", "T06", status="error", code="INVALID_JSON", path=side + "_json")
            c[side + "_arg"] = raw
    for side in ("request", "candidates"):
        for i, value in enumerate((None, 123, False, [])):
            c = add(f"parameter_type_{side}_{i}", "C1", status="needs_input" if side == "request" else "failed",
                    code="INVALID_TYPE", path=side + "_json")
            c[side + "_arg"] = value
        for i, root in enumerate((None, [], 1, "text", True)):
            c = add(f"root_{side}_{i}", "T06_C1", status="needs_input" if side == "request" else "failed",
                    code="INVALID_REQUEST" if side == "request" else "INVALID_TYPE",
                    path="request" if side == "request" else "candidates")
            c[side + "_arg"] = encoded(root)
        c = add("invalid_utf8_" + side, "C1", status="error", code="INVALID_JSON", path=side + "_json")
        c[side + "_arg"] = "\ud800"
    for value in ("", "c4", "C1", "c1 ", " c1"):
        add("id_" + repr(value), "C3", field("candidate", "id", value), "failed",
            "INVALID_CANDIDATE_ID", "candidates[0].id", 0)
    for i, value in enumerate((None, [], 1)):
        add(f"id_type_{i}", "C3", field("candidate", "id", value), "failed", "INVALID_TYPE", "candidates[0].id", 0)
    add("id_duplicate", "T12_C3", field("candidate", "id", "c2"), "failed", "DUPLICATE_ID", "candidates[1].id")
    add("id_reordered", "C3", lambda r, b: b["candidates"].reverse())
    for count in (0, 2, 4, 21):
        def count_change(r, b, count=count):
            b["candidates"] = (b["candidates"] * 7)[:count]
        add(f"count_{count}", "T12", count_change, "failed", "INVALID_CANDIDATE_COUNT", "candidates",
            absent=["LIMIT_EXCEEDED"])
    for i, value in enumerate((None, {}, "x", True)):
        add(f"batch_type_{i}", "T12", lambda r, b, value=value: b.update(candidates=value),
            "failed", "INVALID_TYPE", "candidates")
    for side, name in (("request", "forbidden_tags"), ("candidate", "tags")):
        add("unknown_tag_" + side, "C2", field(side, name, ["unmapped"]),
            "needs_input" if side == "request" else "failed", "UNKNOWN_TAG",
            f"request.{name}[0]" if side == "request" else "candidates[0].tags[0]",
            "top" if side == "request" else 0)
        add("tag_type_" + side, "C2", field(side, name, [None]),
            "needs_input" if side == "request" else "failed", "INVALID_TYPE",
            f"request.{name}[0]" if side == "request" else "candidates[0].tags[0]",
            "top" if side == "request" else 0, absent=["UNKNOWN_TAG"])
    add("tag_forbidden_normalized", "T03_C2", field("candidate", "tags", [" ＡｌＣｏＨｏＬ "]),
        "failed", "FORBIDDEN_TAG", "candidates[0].tags[0]", 0)
    add("tag_known_normalized", "C2", field("candidate", "tags", [" ＯＴＨＥＲ "]))
    for name in ("name", "description", "reason", "presentation", "inferences"):
        add("forbidden_term_" + name, "T03", field("candidate", name, ["含烈酒"] if name == "inferences" else "含烈酒"),
            "failed", "FORBIDDEN_TERM", "candidates[0]." + name + ("[0]" if name == "inferences" else ""), 0)
    def nfkc_term(r, b):
        r["forbidden_terms"] = ["ＡＢＣ"]
        b["candidates"][0]["description"] = "组合abc物品"
    add("forbidden_term_nfkc_case", "T03", nfkc_term, "failed", "FORBIDDEN_TERM", "candidates[0].description", 0)
    add("unknown_fact", "T10", field("candidate", "fact_refs", ["invented"]),
        "failed", "UNKNOWN_FACT_REF", "candidates[0].fact_refs[0]", 0)
    def duplicate_fact(r, b):
        r["facts"].append({"id": "coffee", "text": "不同原文也不能复用编号"})
    add("duplicate_fact", "T12", duplicate_fact, "needs_input", "DUPLICATE_ID", "request.facts[2].id")
    for i, facts in enumerate(([None], [{"id": [], "text": "事实"}], [{"id": "f", "text": None}], [{"id": "", "text": "事实"}])):
        add(f"fact_shape_{i}", "T10", field("request", "facts", facts), "needs_input", "INVALID_TYPE",
            "request.facts[0]" + (".id" if i in (1, 3) else ".text" if i == 2 else ""))
    def duplicate_content(r, b):
        b["candidates"][0].update(name="ABC  礼物", description="桌面\n用品")
        b["candidates"][1].update(name=" ａｂｃ\t礼物 ", description=" 桌面　用品 ")
    c = add("content_duplicate_pair", "C4", duplicate_content, "failed", "DUPLICATE_CANDIDATE_CONTENT", "candidates[0]", 0, [False, False, True])
    c["expected"]["errors"].append({"code": "DUPLICATE_CANDIDATE_CONTENT", "path": "candidates[1]", "location": 1})
    for name in ("name", "description"):
        def partial_same(r, b, name=name):
            b["candidates"][1][name] = b["candidates"][0][name]
        add("content_only_same_" + name, "C4", partial_same)
    for side in ("request", "candidate"):
        for size in (1000, 1001):
            name = "notes" if side == "request" else "description"
            add(f"text_limit_{side}_{size}", "C6", field(side, name, "😀" * size),
                "passed" if size == 1000 else "needs_input" if side == "request" else "failed",
                "LIMIT_EXCEEDED" if size == 1001 else None,
                f"request.{name}" if side == "request" else f"candidates[0].{name}", "top" if side == "request" else 0)
    for side in ("request", "candidates"):
        for size in (32768, 32769):
            c = add(f"raw_limit_{side}_{size}", "C6", status="passed" if size == 32768 else "needs_input" if side == "request" else "failed",
                    code="LIMIT_EXCEEDED" if size == 32769 else None, path=side + "_json")
            raw = c[side + "_arg"]
            c[side + "_arg"] += " " * (size - len(raw.encode("utf-8")))
        c = add("oversize_invalid_not_parsed_" + side, "C1_C6", status="needs_input" if side == "request" else "failed",
                code="LIMIT_EXCEEDED", path=side + "_json", absent=["INVALID_JSON"])
        c[side + "_arg"] = "{" + "x" * 32768
    for side, names in (("request", ("facts", "forbidden_tags", "forbidden_terms")),
                        ("candidate", ("tags", "fact_refs", "inferences", "unknowns"))):
        for name in names:
            for count in (20, 21):
                values = ([{"id": f"fact_{i}", "text": "虚构事实"} for i in range(count)] if name == "facts" else
                          [{"forbidden_tags": "food", "forbidden_terms": "不出现的词", "tags": "other", "fact_refs": "coffee",
                            "inferences": "可能适合", "unknowns": "尚不清楚"}[name]] * count)
                def list_change(r, b, side=side, name=name, values=values):
                    field(side, name, values)(r, b)
                    if name == "facts":
                        for c in b["candidates"]:
                            c["fact_refs"] = []
                add(f"list_limit_{name}_{count}", "C6", list_change,
                    "passed" if count == 20 else "needs_input" if side == "request" else "failed",
                    "LIMIT_EXCEEDED" if count == 21 else None,
                    f"request.{name}" if side == "request" else f"candidates[0].{name}", "top" if side == "request" else 0)
    def mixed(r, b):
        r.pop("budget_amount")
        b["candidates"][0].pop("reason")
    add("priority_request_before_candidate", "C1", mixed, "needs_input", "MISSING_FIELD", "request.budget_amount")
    c = add("priority_parse_before_request", "C1", lambda r, b: r.pop("occasion"), "error", "INVALID_JSON", "candidates_json")
    c["candidates_arg"] = "{"
    c = add("priority_parse_before_limit", "C1", status="error", code="INVALID_JSON", path="candidates_json")
    c.update(request_arg="x" * 32769, candidates_arg="{")
    c = add("priority_both_limits", "C1_C6", status="needs_input", code="LIMIT_EXCEEDED", path="request_json")
    c.update(request_arg="x" * 32769, candidates_arg="x" * 32769)
    for name, amount, status in (("before", "120.00", "failed"), ("success_after", "90.00", "passed"), ("failure_after", "110.00", "failed")):
        add("offline_snapshot_" + name, "T07_T08", field("candidate", "estimated_total", amount), status,
            "OVER_BUDGET" if status == "failed" else None, "candidates[0].estimated_total", 0)
    add("isolation_no_io", "PURE", mode="deny_io")
    add("controlled_execution_failure", "T15_local_only", status="error", code="INTERNAL_ERROR", path="$", mode="fault")
    return cases


if __name__ == "__main__":
    target = Path(__file__).with_name("cases.json")
    with target.open("x", encoding="utf-8") as handle:
        json.dump({"notice": "独立虚构数据；固定快照不证明真实模型修订", "cases": build()}, handle, ensure_ascii=True, indent=2)
        handle.write("\n")
    print(target)
