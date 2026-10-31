"""三步输入的纯适配，不调用模型，不推断预算、天数或事实。"""

import json

from validator.rules import validate, check_budget_range, CONTRACT_VERSION, _amount
from workflow.labels import RELATIONS, CLOSENESS, OCCASIONS, INTERESTS, GIFT_STYLES, EXCLUSIONS


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def strict_load(raw, max_bytes=32768):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result

    def constant(_):
        raise ValueError("non-standard constant")

    if not isinstance(raw, str) or len(raw.encode("utf-8")) > max_bytes:
        raise ValueError("invalid size or type")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def adapt_intake(intake_json):
    errors = []

    def err(code, path, message):
        errors.append({"code": code, "path": path, "message": message})

    try:
        data = strict_load(intake_json)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        return {"status": "needs_input", "errors": [{"code": "INTAKE_INVALID_JSON", "path": "intake", "message": "输入须为不超过 32768 UTF-8 字节的严格 JSON 对象"}], "request_json": None}
    if not isinstance(data, dict):
        return {"status": "needs_input", "errors": [{"code": "INVALID_TYPE", "path": "intake", "message": "输入根节点须为对象"}], "request_json": None}

    fields = {"recipient_relation", "recipient_relation_custom", "closeness", "occasion", "occasion_custom", "budget_amount", "currency", "deadline_days", "interests", "interest_confidence", "gift_styles", "hard_exclusions", "additional_context", "contract_version", "budget_mode", "budget_range", "dislikes"}
    for key in data:
        if key in fields:
            continue
        err("INTAKE_UNKNOWN_FIELD", "intake." + key, "未声明的输入字段，请确认契约版本")
    revised = any(key in data for key in ("contract_version", "budget_mode", "budget_range"))
    required = ("recipient_relation", "occasion", "currency", "deadline_days") if revised else ("recipient_relation", "occasion", "budget_amount", "currency", "deadline_days")
    for key in required:
        if key not in data or data[key] is None:
            err("INTAKE_CLARIFICATION_REQUIRED", "intake." + key, "请补充明确的关系、场合、预算上限、币种及可用天数")
    budget = data.get("budget_amount")
    budget_errors = []
    if revised:
        if "contract_version" not in data:
            err("INTAKE_CLARIFICATION_REQUIRED", "intake.contract_version", "请提供新版输入契约版本")
        elif not isinstance(data["contract_version"], str):
            err("INVALID_TYPE", "intake.contract_version", "契约版本须为字符串")
        elif data["contract_version"] != CONTRACT_VERSION:
            err("INTAKE_UNKNOWN_LABEL", "intake.contract_version", "不支持此输入契约版本")
        interval = check_budget_range(data.get("budget_range"), "intake.budget_range", budget_errors, data.get("budget_mode"))
        if interval is not None:
            if "budget_amount" in data:
                if isinstance(budget, str) and len(budget) > 1000:
                    budget_errors.append({"code": "LIMIT_EXCEEDED", "path": "intake.budget_amount", "message": "字段字符串超过 1000 个 Unicode 码点"})
                    scalar = None
                else:
                    scalar = _amount(budget, "intake.budget_amount", budget_errors)
                if scalar is not None and scalar > 10000:
                    budget_errors.append({"code": "LIMIT_EXCEEDED", "path": "intake.budget_amount", "message": "预算须在 0 至 10000 之间"})
                elif scalar is not None and scalar != interval[1]:
                    budget_errors.append({"code": "BUDGET_RANGE_MISMATCH", "path": "intake.budget_amount", "message": "预算上限须与区间 max 数值一致"})
            else:
                budget = data["budget_range"]["max"]
        errors.extend(budget_errors)
    dislikes = data.get("dislikes", "")
    if not isinstance(dislikes, str):
        err("INVALID_TYPE", "intake.dislikes", "不喜欢的东西须为字符串，可为空")
    elif len(dislikes) > 1000:
        err("LIMIT_EXCEEDED", "intake.dislikes", "不喜欢的东西最多 1000 个 Unicode 码点")

    def choice(key, table, default=None):
        value = data.get(key, default)
        if not isinstance(value, str) or value not in table:
            err("INTAKE_UNKNOWN_LABEL", "intake." + key, "请选择已声明的标签 ID")
            return default
        return value

    relation = choice("recipient_relation", RELATIONS)
    occasion = choice("occasion", OCCASIONS)
    def custom_text(key):
        if key not in data:
            return None
        value = data[key]
        if not isinstance(value, str) or not value.strip():
            err("INVALID_TYPE", "intake." + key, "自定义文本必须为非空字符串")
            return None
        if len(value) > 1000:
            err("LIMIT_EXCEEDED", "intake." + key, "自定义文本最多 1000 个 Unicode 码点")
        return value
    relation_custom = custom_text("recipient_relation_custom")
    occasion_custom = custom_text("occasion_custom")
    if relation == "other" and relation_custom is None:
        err("INTAKE_CLARIFICATION_REQUIRED", "intake.recipient_relation_custom", "选择其他关系时请填写自定义关系")
    if relation != "other" and "recipient_relation_custom" in data:
        err("INTAKE_UNKNOWN_FIELD", "intake.recipient_relation_custom", "只有选择其他关系时才能填写自定义关系")
    if occasion == "other" and occasion_custom is None:
        err("INTAKE_CLARIFICATION_REQUIRED", "intake.occasion_custom", "选择其他场合时请填写自定义场合")
    if occasion != "other" and "occasion_custom" in data:
        err("INTAKE_UNKNOWN_FIELD", "intake.occasion_custom", "只有选择其他场合时才能填写自定义场合")
    closeness = choice("closeness", CLOSENESS, "unknown")
    for key in ("recipient_relation", "occasion"):
        if data.get(key) == "unknown":
            err("INTAKE_CLARIFICATION_REQUIRED", "intake." + key, "推荐前请确认关系或场合；可使用其他")

    def selections(key, table):
        values = data.get(key, [])
        if not isinstance(values, list):
            err("INVALID_TYPE", "intake." + key, "须为标签 ID 数组")
            return []
        if len(values) > 20:
            err("LIMIT_EXCEEDED", "intake." + key, "数组最多 20 项")
        seen = set()
        valid = []
        for i, value in enumerate(values):
            path = f"intake.{key}[{i}]"
            if not isinstance(value, str) or value not in table:
                err("INTAKE_UNKNOWN_LABEL", path, "未知标签；跳过兴趣或风格请使用空数组")
            elif value in seen:
                err("DUPLICATE_ID", path, "标签不得重复")
            else:
                seen.add(value)
                valid.append(value)
        return valid

    interests = selections("interests", INTERESTS)
    styles = selections("gift_styles", GIFT_STYLES)
    confidence = data.get("interest_confidence", {})
    if not isinstance(confidence, dict):
        err("INVALID_TYPE", "intake.interest_confidence", "可信度须为以兴趣 ID 为键的对象")
        confidence = {}
    if set(confidence) - set(interests):
        err("INTAKE_CONFIDENCE_MISMATCH", "intake.interest_confidence", "可信度只能对应本次选择的兴趣")
    for key in interests:
        if confidence.get(key, "inferred") not in ("confirmed", "inferred"):
            err("INTAKE_CONFIDENCE_MISMATCH", "intake.interest_confidence." + key, "已选兴趣只允许 confirmed 或 inferred；未知请取消选择")

    exclusions = data.get("hard_exclusions", {"tags": [], "terms": [], "unresolved": []})
    if not isinstance(exclusions, dict):
        err("INVALID_TYPE", "intake.hard_exclusions", "禁忌须为 tags、terms、unresolved 对象")
        exclusions = {}
    for key in exclusions:
        if key not in {"tags", "terms", "unresolved"}:
            err("INTAKE_UNKNOWN_FIELD", "intake.hard_exclusions." + key, "未知禁忌字段")
    for key in ("tags", "terms", "unresolved"):
        values = exclusions.get(key, [])
        if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
            err("INVALID_TYPE", "intake.hard_exclusions." + key, "须为非空字符串数组，可为空数组")
        elif len(values) > 20 or any(len(v) > 1000 for v in values):
            err("LIMIT_EXCEEDED", "intake.hard_exclusions." + key, "禁忌数组最多 20 项，每项最多 1000 码点")
    if exclusions.get("unresolved"):
        err("INTAKE_CLARIFICATION_REQUIRED", "intake.hard_exclusions.unresolved", "请将待澄清禁忌确认为类别或明确字面词；不能静默忽略")
    tags = exclusions.get("tags", [])
    if isinstance(tags, list):
        for i, tag in enumerate(tags):
            if not isinstance(tag, str) or tag not in EXCLUSIONS:
                err("INTAKE_UNKNOWN_LABEL", f"intake.hard_exclusions.tags[{i}]", "禁忌类别须使用固定 ID，不自动猜同义词")

    request = {
        # 两层契约：recipient_relation 是面向人与提示词的冻结中文显示文本，
        # recipient_relation_id 是供代码分支（关系优先级、追求对象低压力）使用的稳定机器值。
        # 它只由服务端 intake 产出，不在上面的 fields 输入白名单内，前端不得提交。
        "recipient_relation": relation_custom if relation == "other" and relation_custom is not None else RELATIONS.get(relation, ""),
        "recipient_relation_id": relation if relation in RELATIONS else "",
        "recipient_relation_custom": relation_custom if relation == "other" else None,
        "occasion": occasion_custom if occasion == "other" and occasion_custom is not None else OCCASIONS.get(occasion, ""),
        "occasion_custom": occasion_custom if occasion == "other" else None,
        "budget_amount": budget, "currency": data.get("currency"),
        "available_days": data.get("deadline_days"),
        "facts": [{"id": "interest:" + key, "text": "用户明确知道：对方对“" + INTERESTS[key] + "”感兴趣（未确认该组内具体偏好）"} for key in interests if confidence.get(key, "inferred") == "confirmed"],
        "forbidden_tags": tags, "forbidden_terms": exclusions.get("terms", []),
        "notes": data.get("additional_context", ""), "closeness": closeness,
        "preference_inferences": [{"interest_id": key, "text": "用户猜测：对方可能对“" + INTERESTS[key] + "”感兴趣"} for key in interests if confidence.get(key, "inferred") == "inferred"],
        "gift_styles": styles, "hard_exclusions_original": exclusions,
    }
    if revised:
        request.update(contract_version=CONTRACT_VERSION, budget_range=data.get("budget_range"), dislikes=dislikes)
    elif "dislikes" in data:
        request["dislikes"] = dislikes
    # 复用原规则的请求检查；空批次产生的候选错误不会成为输入错误。
    checked = validate(dump(request), '{}')
    errors.extend(e for e in checked["errors"] if e["path"].startswith("request")
                  and not (budget_errors and e["path"].startswith(("request.budget_range", "request.budget_amount")))
                  and not ("dislikes" in e["path"] and any(x["path"] == "intake.dislikes" for x in errors)))
    if checked["status"] == "error":
        err("INTERNAL_ERROR", "intake", "输入检查暂不可用，请稍后重试")
    return {"status": "needs_input" if errors else "ready", "errors": errors, "request_json": None if errors else dump(request)}
