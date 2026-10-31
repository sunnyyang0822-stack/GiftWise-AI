# 自动生成，请修改原文件后重新构建；不要在 Dify 手工维护分叉。
# SOURCE: validator/rules.py
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

# SOURCE: workflow/labels.py
"""intake-v1 共享标签；界面与工作流须使用相同 ID，待 PM 审查。"""

# 产品面冻结关系枚举（8 个稳定 ID）：partner 恋人、pursuit 追求对象、friend 朋友、family 家人、
# classmate 同学、mentor 老师/导师、client_partner 客户/合作伙伴、other 其他。
# partner 与 pursuit 并列互斥，不得合并，也不得把追求对象落入 other。
# colleague（同事）仅技术回归：产品场景已完全移出，界面/导航/演示/验收不得出现；
# 保留该机器值以免破坏 46 项本地探针与 tests/ 的同事回归夹具。
RELATIONS = {"friend": "朋友", "colleague": "同事", "partner": "恋人", "pursuit": "追求对象", "family": "家人", "classmate": "同学", "mentor": "老师/导师", "client_partner": "客户/合作伙伴", "other": "其他", "unknown": "关系暂不确定"}
CLOSENESS = {"very_familiar": "非常熟悉", "familiar": "比较熟悉", "limited": "了解不多", "unfamiliar": "几乎不了解", "unknown": "不确定"}
OCCASIONS = {"birthday": "生日", "festival": "节日", "thanks": "感谢", "anniversary": "纪念日", "graduation_promotion": "毕业/升职祝贺", "other": "其他", "unknown": "场合暂不确定"}
INTERESTS = {"design_art": "设计与艺术", "coffee_food": "咖啡与美食", "reading_learning": "阅读与学习", "tech_digital": "科技与数码", "sports_outdoors": "运动与户外", "music_movies": "音乐与电影", "games_anime": "游戏与动漫", "travel_exploration": "旅行与探索", "home_living": "家居与生活", "plants_nature": "植物与自然", "fashion_accessories": "时尚与配饰", "experiences_activities": "体验与活动"}
GIFT_STYLES = {"design": "有设计感", "practical": "实用型", "personalized": "个性化定制", "surprising": "有趣且能带来惊喜", "memorable": "有纪念意义", "experiential": "体验型", "understated": "精致但不张扬"}
EXCLUSIONS = {"alcohol": "酒类", "food": "食品", "fragrance": "香氛", "jewelry": "珠宝首饰", "plant": "植物", "other": "其他类别"}

# SOURCE: workflow/intake.py
"""三步输入的纯适配，不调用模型，不推断预算、天数或事实。"""

import json





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

    fields = {"recipient_relation", "recipient_relation_custom", "closeness", "occasion", "occasion_custom", "budget_amount", "currency", "deadline_days", "interests", "interest_confidence", "gift_styles", "hard_exclusions", "additional_context", "contract_version", "budget_mode", "budget_range", "dislikes", "previous_gifts"}
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
        err("INVALID_TYPE", "intake.dislikes", "需要避免的内容须为字符串，可为空")
    elif len(dislikes) > 1000:
        err("LIMIT_EXCEEDED", "intake.dislikes", "需要避免的内容最多 1000 个 Unicode 码点")
    elif not dislikes.strip():
        dislikes = ""
    previous_gifts = data.get("previous_gifts", "")
    if not isinstance(previous_gifts, str):
        err("INVALID_TYPE", "intake.previous_gifts", "以前送过什么须为字符串，可为空")
    elif len(previous_gifts) > 1000:
        err("LIMIT_EXCEEDED", "intake.previous_gifts", "送礼历史最多 1000 个 Unicode 码点")
    elif not previous_gifts.strip():
        previous_gifts = ""

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
    # 旧版未提供时仍省略派生字段，避免旧快照被重新解释；读取默认空字符串。
    if "previous_gifts" in data or revised:
        request["previous_gifts"] = previous_gifts
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

# SOURCE: workflow/runtime.py
"""可在本地及构建后的 Code 节点运行；模型调用由 Dify 节点负责。"""

import json





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


_dispatch = main
def main(request_json: str, candidates_json: str, repair_count: int) -> dict:
    output = _dispatch("check", dump({"request_json": request_json, "candidates_json": candidates_json, "repair_count": repair_count}))
    value = json.loads(output["envelope_json"])
    output["validation_json"] = dump(value.get("validation", {}))
    output["preserved_candidates_json"] = dump(preserved_candidates(value)) if "validation" in value else "{}"
    return output
