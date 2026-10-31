"""只校验/导出 QA 夹具，不导入或执行任何被测实现。"""
import ast
from decimal import Decimal
import json
from pathlib import Path
import sys

from fixtures import rule_cases

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def main():
    cases = rule_cases()
    assert len({c["id"] for c in cases}) == len(cases)
    by_id = {c["id"]: c for c in cases}
    assert by_id["R02-zero-free"]["status"] == "passed"
    assert by_id["R03-zero-paid"]["code"] == "OVER_BUDGET"
    assert by_id["R-zero-plus-366-still-reject"]["status"] == "needs_input"
    assert by_id["R09-below-min-selectable"]["warning"] is True
    for case in cases:
        assert len(case["candidates"]["candidates"]) == 3
        if case["status"] == "passed":
            req = case["request"]
            assert 0 <= req["available_days"] <= 365
            for candidate in case["candidates"]["candidates"]:
                assert Decimal(candidate["estimated_total"]) <= Decimal(req["budget_amount"])
            if "budget_range" in req:
                assert Decimal(req["budget_range"]["max"]) == Decimal(req["budget_amount"])
        if case["id"].startswith("R-legacy-"):
            assert "budget_range" not in case["request"]
    for source in HERE.glob("*.py"):
        ast.parse(source.read_text(encoding="utf-8"), filename=str(source))
    rendered = json.dumps(cases, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    target = HERE / "rules.json"
    if "--check" in sys.argv:
        assert target.read_text(encoding="utf-8") == rendered, "导出夹具与源码不一致"
    else:
        target.write_text(rendered, encoding="utf-8")
    print(f"QA夹具自检通过：{len(cases)}组；零元/区间/旧标量独立断言通过；Python语法通过。")
    print("本命令未调用被测实现，不代表产品验收通过。")


if __name__ == "__main__":
    main()
