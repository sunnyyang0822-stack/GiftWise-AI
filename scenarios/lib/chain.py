# -*- coding: utf-8 -*-
"""场景链路执行器：intake 原文 → 确定性适配 → request → 三候选 → 真实规则层校验。

设计原则
--------
1. **只读调用**：`workflow.intake.adapt_intake` 与 `validator.rules.validate`，不修改任何规则/适配代码。
2. **零第三方依赖**：只用标准库。
3. **不做模型调用**：本模块**从不**调用 Dify 或任何模型。候选来源只有两种，且必须在用例里显式声明：
   - `"source": "evidence"` —— 取自仓库中**真实运行产物**（`workflow/evidence/**`）；
   - `"source": "authored"` —— 由本线**按契约人工构造**，非模型产出。
4. **保留原始输出**：每个用例的适配结果、请求、候选、规则层返回都原样落盘，便于复核。
"""

import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from workflow.intake import adapt_intake          # noqa: E402
from validator.rules import validate              # noqa: E402


def _dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def run_case(case):
    """跑一个用例，返回结构化结果（不抛异常，异常也记进结果）。"""
    result = {
        "id": case.get("id"),
        "title": case.get("title"),
        "relation_id": case.get("relation_id"),
        "relation_label": case.get("relation_label"),
        "priority_group": case.get("priority_group"),
        "narrative": case.get("narrative"),
        "source": case.get("source", "authored"),
        "source_note": case.get("source_note", ""),
        "intake": case.get("intake"),
        "stage": None,
        "intake_status": None,
        "intake_errors": [],
        "request_json": None,
        "candidate_ids": [],
        "candidate": [],
        "all_passed": False,
        "selectable_ids": [],
        "rejected_ids": [],
        "verdict": "",
        "notes": "",
    }

    try:
        intake_json = _dump(case["intake"])
        adapted = adapt_intake(intake_json)
        result["intake_status"] = adapted.get("status")
        result["intake_errors"] = adapted.get("errors", [])

        if adapted.get("status") != "ready":
            # 适配层就把输入挡下了：这正是"该追问而不是硬给方案"的场景
            result["stage"] = "intake"
            result["verdict"] = "未进入校验：适配层要求补充或澄清（未调用模型）"
            return result

        request_json = adapted["request_json"]
        result["request_json"] = request_json
        result["request"] = json.loads(request_json)

        batch = case["candidates"]
        result["candidate_ids"] = [c.get("id") for c in batch.get("candidates", [])]
        validation = validate(request_json, _dump(batch))
        result["stage"] = "validate"
        result["validation"] = validation
        result["all_passed"] = validation.get("all_passed", False)

        for item in validation.get("candidate_results", []):
            result["candidate"].append({
                "id": item.get("id"),
                "passed": item.get("passed"),
                "errors": item.get("errors", []),
                "warnings": item.get("warnings", []),
            })
            (result["selectable_ids"] if item.get("passed") else result["rejected_ids"]).append(item.get("id"))

        status = validation.get("status")
        if status == "passed":
            result["verdict"] = "三案全部通过规则校验 → 用户可在 3 个合法方案中选择"
        elif status == "needs_input":
            result["verdict"] = "请求层拒绝 → 应回到追问，不生成方案"
        elif status == "error":
            result["verdict"] = "内部错误（非输入问题）"
        else:
            result["verdict"] = (
                "部分方案不合法 → 只放行 %d 个，失败项不进入可选集合"
                % len(result["selectable_ids"])
            )
        return result
    except Exception as exc:                                    # noqa: BLE001
        result["stage"] = result["stage"] or "unknown"
        result["verdict"] = "执行器异常"
        result["notes"] = f"{type(exc).__name__}: {exc}"
        return result


def run_all(cases):
    return [run_case(c) for c in cases]


def summarize(results):
    """给一张便于人读的摘要表数据。"""
    rows = []
    for r in results:
        rows.append({
            "id": r["id"],
            "关系": r["relation_label"],
            "优先级": r["priority_group"],
            "阶段": r["stage"],
            "三案通过": r["all_passed"],
            "可选项": r["selectable_ids"],
            "被拒项": r["rejected_ids"],
            "结论": r["verdict"],
        })
    return rows


if __name__ == "__main__":
    # 冒烟：用仓库官方虚构样例（追求对象生日）跑通链路
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(_ROOT, "workflow", "examples", "intake.json"), encoding="utf-8") as fh:
        intake = json.load(fh)
    with open(os.path.join(_ROOT, "workflow", "examples", "candidates.json"), encoding="utf-8") as fh:
        cands = json.load(fh)
    demo = run_case({
        "id": "smoke", "title": "官方虚构样例", "relation_id": "pursuit",
        "relation_label": "追求对象", "priority_group": "1",
        "source": "evidence", "source_note": "workflow/examples/*.json",
        "intake": intake, "candidates": cands,
    })
    print("intake_status:", demo["intake_status"])
    print("stage        :", demo["stage"])
    print("all_passed   :", demo["all_passed"])
    print("selectable   :", demo["selectable_ids"])
    print("verdict      :", demo["verdict"])
