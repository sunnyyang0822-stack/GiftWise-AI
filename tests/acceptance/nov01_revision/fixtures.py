"""QA 自建虚构夹具；期望手工按 PM v2 契约指定，不读取开发夹具或实现输出。"""
from copy import deepcopy

VERSION = "giftwise-20261031-v2"


def request():
    return dict(recipient_relation="追求对象", occasion="感谢", budget_amount="150",
                budget_range={"min": "100", "max": "150"}, currency="CNY",
                available_days=5, facts=[], forbidden_tags=[], forbidden_terms=[])


def candidates(price="138"):
    names = ["虚构便笺", "虚构书签", "虚构手写卡"]
    return {"candidates": [dict(id=f"c{i+1}", name=name,
        description="仅用于离线验收的虚构方向", estimated_total=price,
        currency="CNY", estimated_preparation_days=0, tags=["other"],
        reason="表达感谢，尊重对方选择", fact_refs=[],
        inferences=["可能适合，不能保证喜欢"],
        unknowns=["是否已有同类物品未知；价格库存物流未核实"])
        for i, name in enumerate(names)]}


def rule_cases():
    cases = []

    def add(cid, patch=None, price="138", status="passed", code=None, path=None, warning=False):
        req = request()
        req.update(deepcopy(patch or {}))
        cases.append(dict(id=cid, request=req, candidates=candidates(price),
                          status=status, code=code, path=path, warning=warning))

    add("R01-three-prices-not-summed")  # 138 * 3 > 150，仍分别通过
    add("R02-zero-free", {"budget_amount": "0", "budget_range": {"min": "0", "max": "0"}}, "0")
    add("R03-zero-paid", {"budget_amount": "0", "budget_range": {"min": "0", "max": "0"}}, "0.01", "failed", "OVER_BUDGET", "candidates[0].estimated_total")
    add("R04-fraction", {"budget_amount": "0.99", "budget_range": {"min": "0.99", "max": "0.99"}}, "0.99")
    add("R05-thousand", {"budget_amount": "1000", "budget_range": {"min": "1000", "max": "1000"}}, "1000")
    add("R06-ten-thousand", {"budget_amount": "10000", "budget_range": {"min": "0", "max": "10000"}}, "10000")
    add("R07-min-equal", price="100")
    add("R08-max-equal", price="150")
    add("R09-below-min-selectable", price="99.99", warning=True)
    add("R10-over-max", price="150.01", status="failed", code="OVER_BUDGET", path="candidates[0].estimated_total")
    invalid = [
        ("null", None, "INVALID_BUDGET_RANGE", "request.budget_range"),
        ("missing-min", {"max": "150"}, "INVALID_BUDGET_RANGE", "request.budget_range.min"),
        ("missing-max", {"min": "100"}, "INVALID_BUDGET_RANGE", "request.budget_range.max"),
        ("reversed", {"min": "151", "max": "150"}, "INVALID_BUDGET_RANGE", "request.budget_range"),
        ("null-min", {"min": None, "max": "150"}, "INVALID_TYPE", "request.budget_range.min"),
        ("leading-zero", {"min": "00", "max": "150"}, "INVALID_AMOUNT", "request.budget_range.min"),
        ("exponent", {"min": "1e2", "max": "150"}, "INVALID_AMOUNT", "request.budget_range.min"),
        ("bool", {"min": False, "max": "150"}, "INVALID_TYPE", "request.budget_range.min"),
        ("over-limit", {"min": "0", "max": "10000.01"}, "LIMIT_EXCEEDED", "request.budget_range.max"),
        ("mismatch", {"min": "100", "max": "149"}, "BUDGET_RANGE_MISMATCH", "request.budget_amount"),
    ]
    for suffix, value, code, path in invalid:
        add("R-invalid-" + suffix, {"budget_range": value}, status="needs_input", code=code, path=path)
    for day in [0, 1, 5, 7, 30, 90, 365]:
        add(f"R-days-{day}", {"available_days": day})
    add("R-zero-plus-366-still-reject", {"budget_amount": "0", "budget_range": {"min": "0", "max": "0"}, "available_days": 366}, "0", "needs_input", "LIMIT_EXCEEDED", "request.available_days")
    for price in ["0", "0.99", "150"]:
        add("R-legacy-" + price, price=price)
        del cases[-1]["request"]["budget_range"]
    return cases
