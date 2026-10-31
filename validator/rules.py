"""推荐阶段确定性校验；遵循 PM 契约，不核实真实商品或执行修订。"""

import json
import re
import unicodedata
from decimal import Decimal, InvalidOperation


TAGS = frozenset({"alcohol", "food", "fragrance", "jewelry", "plant", "other"})
AMOUNT = re.compile(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?", re.ASCII)
UNAVAILABLE = object()
CONTRACT_VERSION = "giftwise-20261031-v2"


def _error(errors, code, path, message):
    errors.append({"code": code, "path": path, "message": message})


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _constant(_):
    raise ValueError("non-standard constant")


def _parse(raw, path, errors):
    if not isinstance(raw, str):
        _error(errors, "INVALID_TYPE", path, "接口输入必须为 JSON 字符串")
        return UNAVAILABLE
    try:
        size = len(raw.encode("utf-8"))
    except UnicodeEncodeError:
        _error(errors, "INVALID_JSON", path, "JSON 参数不是合法 UTF-8 文本")
        return UNAVAILABLE
    if size > 32768:
        _error(errors, "LIMIT_EXCEEDED", path, "JSON 参数超过 32768 UTF-8 字节上限")
        return UNAVAILABLE
    try:
        return json.loads(raw, object_pairs_hook=_pairs, parse_constant=_constant,
                          parse_float=Decimal)
    except (ValueError, RecursionError, InvalidOperation):
        _error(errors, "INVALID_JSON", path, "JSON 无效，可能含重复键、非标准常量或嵌套过深")
        return UNAVAILABLE


def _limits(value, path, errors):
    """检查所有字段（含扩展字段）的值；候选数组另按固定数量校验。"""
    stack = [(value, path)]
    while stack:
        item, current = stack.pop()
        if isinstance(item, str) and len(item) > 1000:
            _error(errors, "LIMIT_EXCEEDED", current, "字段字符串超过 1000 个 Unicode 码点")
        elif isinstance(item, list):
            if len(item) > 20:
                _error(errors, "LIMIT_EXCEEDED", current, "业务数组超过 20 项")
            stack.extend((v, f"{current}[{i}]") for i, v in reversed(list(enumerate(item))))
        elif isinstance(item, dict):
            stack.extend((v, f"{current}.{k}" if current else k) for k, v in reversed(list(item.items())))


def _required(obj, fields, path, errors):
    for field in fields:
        if field not in obj:
            _error(errors, "MISSING_FIELD", f"{path}.{field}", "缺少必填字段")


def _text(value, path, errors, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()):
        _error(errors, "INVALID_TYPE", path, "必须为字符串" if empty else "必须为非空字符串")
        return False
    return len(value) <= 1000


def _strings(value, path, errors):
    if not isinstance(value, list):
        _error(errors, "INVALID_TYPE", path, "必须为字符串数组")
        return []
    # 保留原索引，不能在过滤错误元素后重新编号。
    return [item if _text(item, f"{path}[{i}]", errors) else ""
            for i, item in enumerate(value)]


def _amount(value, path, errors):
    if not isinstance(value, str):
        _error(errors, "INVALID_TYPE", path, "金额必须为十进制字符串")
        return None
    if not AMOUNT.fullmatch(value):
        _error(errors, "INVALID_AMOUNT", path, "金额必须为有限非负、至多两位小数的 ASCII 十进制字符串")
        return None
    if len(value) > 1000:
        return None
    return Decimal(value)


def _days(value, path, errors):
    if type(value) is not int or value < 0:
        _error(errors, "INVALID_TYPE", path, "天数必须为非负 JSON 整数，不能为布尔值")
        return None
    return value


def check_budget_range(value, path, errors, mode=UNAVAILABLE):
    """按结构→端点类型/格式/范围→顺序→交互模式检查；不修改输入。"""
    if not isinstance(value, dict) or set(value) - {"min", "max"}:
        _error(errors, "INVALID_BUDGET_RANGE", path, "预算区间须为仅含 min、max 的对象")
        return None
    start = len(errors)
    amounts = []
    for key in ("min", "max"):
        endpoint = path + "." + key
        if key not in value:
            _error(errors, "INVALID_BUDGET_RANGE", endpoint, "预算区间两端均须填写")
            amounts.append(None)
            continue
        if isinstance(value[key], str) and len(value[key]) > 1000:
            _error(errors, "LIMIT_EXCEEDED", endpoint, "字段字符串超过 1000 个 Unicode 码点")
            amounts.append(None)
            continue
        amount = _amount(value[key], endpoint, errors)
        if amount is not None and amount > 10000:
            _error(errors, "LIMIT_EXCEEDED", endpoint, "预算区间端点须在 0 至 10000 之间")
        amounts.append(amount)
    if len(errors) != start:
        return None
    low, high = amounts
    if low > high:
        _error(errors, "INVALID_BUDGET_RANGE", path, "预算区间下限不能超过上限")
        return None
    if mode is not UNAVAILABLE:
        mode_path = path.rsplit(".", 1)[0] + ".budget_mode"
        if not isinstance(mode, str) or mode not in ("slider", "zero", "other"):
            _error(errors, "INVALID_BUDGET_RANGE", mode_path, "预算模式须为 slider、zero 或 other")
            return None
        if mode == "slider" and (high > 1000 or low % 50 or high % 50):
            _error(errors, "INVALID_BUDGET_RANGE", path, "滑条两端须在 0 至 1000 之间，步长为 50 元")
            return None
        if mode == "zero" and (low != 0 or high != 0):
            _error(errors, "INVALID_BUDGET_RANGE", path, "不花钱模式的预算两端均须为 0")
            return None
    return low, high


def _norm(value):
    return unicodedata.normalize("NFKC", value).casefold()


def _tag(value):
    return _norm(value).strip()


def _content_text(value):
    return " ".join(_norm(value).split())


def _request(request, errors):
    if not isinstance(request, dict):
        _error(errors, "INVALID_REQUEST", "request", "请求根节点必须为对象")
        return None
    _limits({k: v for k, v in request.items() if k != "budget_range"}, "request", errors)
    _required(request, ("recipient_relation", "occasion", "budget_amount", "currency", "available_days"), "request", errors)
    for field in ("recipient_relation", "occasion", "currency", "notes"):
        if field in request:
            _text(request[field], "request." + field, errors, empty=field == "notes")
    interval = check_budget_range(request["budget_range"], "request.budget_range", errors) if "budget_range" in request else None
    budget = _amount(request["budget_amount"], "request.budget_amount", errors) if "budget_amount" in request else None
    days = _days(request["available_days"], "request.available_days", errors) if "available_days" in request else None
    # 请求侧范围只在调用点检查：_amount/_days 与候选侧共用，范围约束不得进入共用函数。
    if budget is not None and budget > 10000:
        _error(errors, "LIMIT_EXCEEDED", "request.budget_amount", "预算须在 0 至 10000 之间")
    elif interval is not None and budget is not None and budget != interval[1]:
        _error(errors, "BUDGET_RANGE_MISMATCH", "request.budget_amount", "预算上限须与区间 max 数值一致")
    if days is not None and days > 365:
        _error(errors, "LIMIT_EXCEEDED", "request.available_days", "可用天数须在 0 至 365 天之间")
    if isinstance(request.get("currency"), str) and request["currency"] != "CNY":
        _error(errors, "UNSUPPORTED_CURRENCY", "request.currency", "首版仅支持 CNY，不执行换汇")
    facts = request.get("facts", [])
    fact_ids = set()
    if not isinstance(facts, list):
        _error(errors, "INVALID_TYPE", "request.facts", "事实必须为对象数组")
    else:
        for i, fact in enumerate(facts):
            path = f"request.facts[{i}]"
            if not isinstance(fact, dict):
                _error(errors, "INVALID_TYPE", path, "事实必须为对象")
                continue
            _required(fact, ("id", "text"), path, errors)
            for field in ("id", "text"):
                if field in fact and _text(fact[field], path + "." + field, errors) and field == "id":
                    if fact[field] in fact_ids:
                        _error(errors, "DUPLICATE_ID", path + ".id", "事实 ID 不得重复")
                    fact_ids.add(fact[field])
    forbidden_tags = _strings(request.get("forbidden_tags", []), "request.forbidden_tags", errors)
    forbidden_terms = _strings(request.get("forbidden_terms", []), "request.forbidden_terms", errors)
    for i, tag in enumerate(forbidden_tags):
        if tag and _tag(tag) not in TAGS:
            _error(errors, "UNKNOWN_TAG", f"request.forbidden_tags[{i}]", "未知禁忌标签，请确认禁忌类别")
    if errors:
        return None
    return {"budget": budget, "budget_min": interval[0] if interval is not None else None, "days": days, "fact_ids": fact_ids,
            "forbidden_tags": {_tag(t) for t in forbidden_tags},
            "forbidden_terms": [_norm(t) for t in forbidden_terms], "currency": request["currency"]}


def _candidate(candidate, index, context):
    path = f"candidates[{index}]"
    errors = []
    result = {"id": None, "passed": False, "errors": errors, "warnings": []}
    _limits(candidate, path, errors)
    if not isinstance(candidate, dict):
        _error(errors, "INVALID_TYPE", path, "候选必须为对象")
        return result
    _required(candidate, ("id", "name", "description", "estimated_total", "currency", "estimated_preparation_days", "tags", "reason", "fact_refs", "inferences", "unknowns"), path, errors)
    texts = []
    for field in ("name", "description", "currency", "reason", "presentation"):
        if field in candidate and _text(candidate[field], path + "." + field, errors):
            if field in ("name", "description", "reason", "presentation"):
                texts.append((path + "." + field, candidate[field]))
    if "id" in candidate:
        cid = candidate["id"]
        if not isinstance(cid, str):
            _error(errors, "INVALID_TYPE", path + ".id", "候选 ID 必须为字符串")
        else:
            result["id"] = cid
            if cid not in {"c1", "c2", "c3"}:
                _error(errors, "INVALID_CANDIDATE_ID", path + ".id", "候选 ID 必须为 c1、c2 或 c3，区分大小写")
    total = _amount(candidate["estimated_total"], path + ".estimated_total", errors) if "estimated_total" in candidate else None
    prep = _days(candidate["estimated_preparation_days"], path + ".estimated_preparation_days", errors) if "estimated_preparation_days" in candidate else None
    arrays = {}
    for field in ("tags", "fact_refs", "inferences", "unknowns"):
        arrays[field] = _strings(candidate[field], path + "." + field, errors) if field in candidate else []
    if isinstance(candidate.get("tags"), list) and not candidate["tags"]:
        _error(errors, "INVALID_TYPE", path + ".tags", "候选类别至少需要一个已知标签")
    for j, tag in enumerate(arrays["tags"]):
        if tag and _tag(tag) not in TAGS:
            _error(errors, "UNKNOWN_TAG", f"{path}.tags[{j}]", "未知候选标签，请使用约定类别")
    texts.extend((f"{path}.inferences[{j}]", text) for j, text in enumerate(arrays["inferences"]) if text)
    if context is not None:
        if total is not None and total > context["budget"]:
            _error(errors, "OVER_BUDGET", path + ".estimated_total", "估算总费用超过预算")
        if total is not None and context["budget_min"] is not None and total < context["budget_min"]:
            _error(result["warnings"], "BELOW_BUDGET_RANGE", path + ".estimated_total", "礼物估价低于预算区间下限，仍可选择")
        if prep is not None and prep > context["days"]:
            _error(errors, "PREPARATION_TOO_LONG", path + ".estimated_preparation_days", "估算准备时间超过可用天数")
        if isinstance(candidate.get("currency"), str) and candidate["currency"] != context["currency"]:
            _error(errors, "CURRENCY_MISMATCH", path + ".currency", "候选币种与请求币种不一致，不执行换汇")
        for j, tag in enumerate(arrays["tags"]):
            if tag and _tag(tag) in context["forbidden_tags"]:
                _error(errors, "FORBIDDEN_TAG", f"{path}.tags[{j}]", "候选包含明确禁止的类别")
        for j, ref in enumerate(arrays["fact_refs"]):
            if ref and ref not in context["fact_ids"]:
                _error(errors, "UNKNOWN_FACT_REF", f"{path}.fact_refs[{j}]", "引用的事实 ID 不存在于原始请求")
        for text_path, text in texts:
            if any(term in _norm(text) for term in context["forbidden_terms"]):
                _error(errors, "FORBIDDEN_TERM", text_path, "文本包含明确禁止的字面词")
    return result


def _batch(batch, context, errors):
    if not isinstance(batch, dict):
        _error(errors, "INVALID_TYPE", "candidates", "候选根节点必须为对象")
        return []
    _limits({k: v for k, v in batch.items() if k != "candidates"}, "", errors)
    if "candidates" not in batch:
        _error(errors, "MISSING_FIELD", "candidates", "缺少候选数组")
        return []
    candidates = batch["candidates"]
    if not isinstance(candidates, list):
        _error(errors, "INVALID_TYPE", "candidates", "候选必须为数组")
        return []
    if len(candidates) != 3:
        _error(errors, "INVALID_CANDIDATE_COUNT", "candidates", "必须恰好提供三个候选")
    results = [_candidate(c, i, context) for i, c in enumerate(candidates)]
    seen = set()
    contents = {}
    for i, (candidate, result) in enumerate(zip(candidates, results)):
        cid = result["id"]
        if isinstance(cid, str):
            if cid in seen:
                _error(errors, "DUPLICATE_ID", f"candidates[{i}].id", "候选 ID 不得重复")
            seen.add(cid)
        if isinstance(candidate, dict) and all(isinstance(candidate.get(f), str) and candidate[f].strip() and len(candidate[f]) <= 1000 for f in ("name", "description")):
            key = tuple(_content_text(candidate[f]) for f in ("name", "description"))
            contents.setdefault(key, []).append(i)
    for indices in contents.values():
        ids = {results[i]["id"] for i in indices if results[i]["id"] is not None}
        if len(ids) > 1:
            for i in indices:
                _error(results[i]["errors"], "DUPLICATE_CANDIDATE_CONTENT", f"candidates[{i}]", "不同候选的名称和描述标准化后重复")
    for result in results:
        result["passed"] = context is not None and not result["errors"]
    return results


def validate(request_json: str, candidates_json: str) -> dict:
    """纯函数公开接口；优先级为解析异常、请求错误、候选错误、通过。"""
    result = {"status": "failed", "all_passed": False, "errors": [],
              "candidate_results": [], "business_data_verification": "not_verified"}
    try:
        request_errors, batch_errors = [], []
        request = _parse(request_json, "request_json", request_errors)
        batch = _parse(candidates_json, "candidates_json", batch_errors)
        context = _request(request, request_errors) if request is not UNAVAILABLE else None
        if batch is not UNAVAILABLE:
            result["candidate_results"] = _batch(batch, context, batch_errors)
        result["errors"] = request_errors + batch_errors
        if any(e["code"] == "INVALID_JSON" for e in result["errors"]):
            result["status"] = "error"
            for candidate in result["candidate_results"]:
                candidate["passed"] = False
        elif request_errors:
            result["status"] = "needs_input"
        elif not batch_errors and len(result["candidate_results"]) == 3 and all(c["passed"] for c in result["candidate_results"]):
            result["status"] = "passed"
            result["all_passed"] = True
    except Exception:
        result = {"status": "error", "all_passed": False,
                  "errors": [{"code": "INTERNAL_ERROR", "path": "$", "message": "暂时无法完成检查，请稍后重试"}],
                  "candidate_results": [], "business_data_verification": "not_verified"}
    return result
