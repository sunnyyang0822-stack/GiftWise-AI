"""可在本地及构建后的 Code 节点运行；模型调用由 Dify 节点负责。"""

import json

from validator.rules import validate
from workflow.intake import adapt_intake, strict_load, dump


def check(request_json, candidates_json, repair_count=0):
    if type(repair_count) is not int or repair_count not in (0, 1):
        raise ValueError("invalid trusted repair count")
    validation = validate(request_json, candidates_json)
    # 分开检查请求，避免候选解析 error 掩盖请求字段错误而错误触发修订。
    request_check = validate(request_json, '{}')
    request_valid = request_check["status"] == "failed" and not any(
        e["path"].startswith("request") or e["code"] == "INTERNAL_ERROR" for e in request_check["errors"])
    internal = any(e["code"] == "INTERNAL_ERROR" for e in validation["errors"])
    return {"request_json": request_json, "candidates_json": candidates_json,
            "validation": validation, "repair_count": repair_count,
            "repairable": request_valid and not internal and not validation["all_passed"] and repair_count == 0,
            "workflow_errors": []}


def preserved_candidates(state):
    """批次无效无可靠 ID 对应时，允许重建；否则保留全部已通过项。"""
    if state["validation"]["errors"]:
        return {}
    try:
        candidates = strict_load(state["candidates_json"])["candidates"]
        passed = {r["id"] for r in state["validation"]["candidate_results"] if r["passed"]}
        return {c["id"]: c for c in candidates if c["id"] in passed}
    except (ValueError, KeyError, TypeError, RecursionError):
        return {}


def recheck(request_json, previous_candidates_json, candidates_json, repair_count=0):
    previous = check(request_json, previous_candidates_json, repair_count)
    if not previous["repairable"]:
        previous["repairable"] = False
        previous["workflow_errors"] = [{"code": "REPAIR_NOT_ALLOWED", "path": "repair_count", "message": "当前状态不允许自动修订，未采用新候选"}]
        return previous
    # 进入 N5 时已占用一次，超时及无效输出同样消耗额度，不回滚。
    state = check(request_json, candidates_json, 1)
    expected = preserved_candidates(previous)
    if expected:
        try:
            batch = strict_load(candidates_json)
            items = batch.get("candidates", []) if isinstance(batch, dict) else []
            for cid, candidate in expected.items():
                matches = [c for c in items if isinstance(c, dict) and c.get("id") == cid] if isinstance(items, list) else []
                # 完整对象比较，非只比较价格或名称；JSON 键序无关。
                if len(matches) != 1 or json.dumps(matches[0], sort_keys=True, ensure_ascii=False, allow_nan=False) != json.dumps(candidate, sort_keys=True, ensure_ascii=False, allow_nan=False):
                    state["workflow_errors"].append({"code": "PASSED_CANDIDATE_CHANGED", "path": cid, "message": "修订改动了已通过候选，整次修订拒绝用于选择"})
        except (ValueError, TypeError, RecursionError):
            state["workflow_errors"].append({"code": "PASSED_CANDIDATE_CHANGED", "path": "candidates", "message": "无法确认已通过候选保持不变，整次修订拒绝用于选择"})
    state["initial_candidates_json"] = previous_candidates_json
    state["initial_validation"] = previous["validation"]
    return state


def report(state):
    # 报告的规则结果从实际候选重新计算；不接受模型声称的 passed。
    validation = validate(state["request_json"], state["candidates_json"])
    workflow_errors = state.get("workflow_errors", [])
    status = validation["status"]
    if workflow_errors and status not in ("error", "needs_input"):
        status = "failed"
    try:
        request = strict_load(state["request_json"])
        batch = strict_load(state["candidates_json"])
        candidates = batch.get("candidates", []) if isinstance(batch, dict) else []
        candidates = candidates if isinstance(candidates, list) else []
    except (ValueError, TypeError, UnicodeError, RecursionError):
        request, candidates = {}, []
    selectable = []
    if not validation["errors"] and not workflow_errors:
        selectable = [r["id"] for r in validation["candidate_results"] if r["passed"]]
    titles = {"passed": "三个方案均通过代码规则检查，请自行选择。", "failed": "部分或全部方案未通过，失败项不可选。", "needs_input": "请补充或澄清需求后再推荐。", "error": "暂时无法完成检查；未将结果标记为通过。"}
    lines = [titles[status], "费用与准备时间仅为估算；未核实真实价格、库存或实际送达。", "已用自动修订次数：" + str(state["repair_count"]) + " / 1。"]
    if isinstance(request, dict) and request.get("contract_version") == "giftwise-20261031-v2":
        lines.insert(1, "新版仅计所选礼物本身；包装、贺卡、装饰和配送不计价，不代表免费。")
    facts = {f["id"]: f["text"] for f in request.get("facts", []) if isinstance(f, dict) and isinstance(f.get("id"), str)} if isinstance(request, dict) else {}
    results = {r["id"]: r for r in validation["candidate_results"] if r["id"] in ("c1", "c2", "c3")}
    for candidate in candidates[:3]:
        if not isinstance(candidate, dict):
            continue
        cid = candidate.get("id")
        result = results.get(cid, {}) if isinstance(cid, str) else {}
        def text_field(key):
            value = candidate.get(key)
            return value if isinstance(value, str) else "字段无效"
        def string_array(key):
            value = candidate.get(key, [])
            return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []
        lines.extend(["", text_field("id") + "：" + text_field("name"), text_field("description"),
                      "理由：" + text_field("reason"),
                      "用户事实：" + ("；".join(ref + "＝" + facts.get(ref, "无有效事实引用") for ref in string_array("fact_refs")) or "未提供可引用事实"),
                      "推断：" + ("；".join(string_array("inferences")) or "无"),
                      "未知：" + ("；".join(string_array("unknowns")) or "未列出；不代表已经核实"),
                      ("礼物本身估价：" if request.get("contract_version") == "giftwise-20261031-v2" else "全量估算：") + text_field("estimated_total") + " " + text_field("currency") + "；准备天数：" + str(candidate.get("estimated_preparation_days", "字段无效")),
                      "代码检查：" + ("通过，可选择" if cid in selectable else "不可选择")])
        lines.extend(e["code"] + "：" + e["message"] for e in result.get("errors", []))
    lines.extend(e["code"] + "：" + e["message"] for e in validation["errors"] + workflow_errors)
    lines.append("等待你选择合格方案；选择后才进入详细包装与贺卡阶段。" if selectable else "当前没有可选方案，请人工调整或检查错误；未继续自动修订。")
    return {"status": status, "all_passed": validation["all_passed"] and not workflow_errors,
            "request": request, "candidates": candidates, "validation": validation,
            "workflow_errors": workflow_errors, "repair_count": state["repair_count"],
            "remaining_repairs": 1 - state["repair_count"], "selected_candidate_id": None,
            "selectable_candidate_ids": selectable, "business_data_verification": "not_verified",
            "report_text": "\n".join(lines)}


def main(action: str, payload_json: str) -> dict:
    """Dify：两个 String 输入，返回 JSON 字符串与浅层分支变量。"""
    try:
        payload = strict_load(payload_json, max_bytes=262144)
        if not isinstance(payload, dict):
            raise ValueError("invalid payload")
        if action == "intake":
            value = adapt_intake(payload["intake_json"])
        elif action == "check":
            value = check(payload["request_json"], payload["candidates_json"], payload["repair_count"])
        elif action == "recheck":
            value = recheck(payload["request_json"], payload["previous_candidates_json"], payload["candidates_json"], payload["repair_count"])
        elif action == "report":
            # state 必须来自可信 Code 输出，不能接受浏览器状态。
            value = report(payload["state"])
        else:
            raise ValueError("invalid action")
        status = value.get("status", value.get("validation", {}).get("status", "error"))
        if value.get("workflow_errors") and status not in ("error", "needs_input"):
            status = "failed"
        return {"envelope_json": dump(value), "status": status,
                "all_passed": value.get("all_passed", value.get("validation", {}).get("all_passed", False)) and not bool(value.get("workflow_errors")),
                "repairable": value.get("repairable", False), "repair_count": value.get("repair_count", 0)}
    except Exception:
        return {"envelope_json": dump({"status": "error", "errors": [{"code": "WORKFLOW_INPUT_ERROR", "path": "$", "message": "工作流变量无效或执行异常，未放行候选"}]}), "status": "error", "all_passed": False, "repairable": False, "repair_count": 1}
