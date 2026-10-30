"""QA-001 独立边界套件：请求侧数值范围 [1,10000] / [0,365] 及其"不下沉到候选侧"。

依据：`docs/validator-contract-decisions.md` §5（2026-10-30 修订：请求预算 [1,10000] 含端点）、
§6（可用天数 [0,365] 含端点，保留 0）。两者均复用 `LIMIT_EXCEEDED`、请求侧 `needs_input`。

**本文件不复用规则线的 `tests/test_cases.json`**：夹具全部在此自建（虚构人物、虚构礼物），
只调用公开函数 `validator.rules.validate`，不读也不改 `validator/**`。

断言三要素：**错误码 + 字段路径 + status**。

运行：
    python -m unittest discover -s tests/acceptance/boundary -v
"""

import json
import sys
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# ----------------------------------------------------------------- 自建夹具

def my_request(**overrides):
    """一个自建的、契约内合法的请求（虚构人物）。"""
    request = {
        "recipient_relation": "追求对象",          # 冻结中文显示文本
        "recipient_relation_id": "pursuit",       # 服务端产出的机器值
        "occasion": "生日",
        "budget_amount": "200.00",
        "currency": "CNY",
        "available_days": 3,
        "facts": [{"id": "f1", "text": "对方喜欢手冲咖啡"}],
        "forbidden_tags": [],
        "forbidden_terms": [],
        "notes": "希望低调一些",
        "closeness": "unknown",
        "preference_inferences": [],
        "gift_styles": [],
        "hard_exclusions_original": {"tags": [], "terms": [], "unresolved": []},
    }
    request.update(overrides)
    return request


def my_candidate(cid, name, total, prepared_days, **overrides):
    candidate = {
        "id": cid,
        "name": name,
        "description": f"{name}：虚构方案说明，含包装与贺卡设想",
        "estimated_total": total,
        "currency": "CNY",
        "estimated_preparation_days": prepared_days,
        "tags": ["other"],
        "reason": "匹配用户已确认的偏好与预算上限",
        "fact_refs": ["f1"],
        "inferences": ["可能偏好实用礼物"],
        "unknowns": ["实际价格以商家为准"],
        "presentation": "简要呈现",
    }
    candidate.update(overrides)
    return candidate


def my_batch():
    """三个名称/描述互不相同的自建候选，默认全部通过。"""
    return {"candidates": [
        my_candidate("c1", "手冲咖啡礼盒", "150.00", 1),
        my_candidate("c2", "陶瓷马克杯", "120.00", 2),
        my_candidate("c3", "咖啡豆订阅卡", "80.00", 3),
    ]}


# ----------------------------------------------------------------- 断言助手

def all_errors(result):
    """顶层错误 + 候选级错误（候选级错误不在顶层 `errors` 里，必须一起收集）。"""
    collected = list(result.get("errors") or [])
    for candidate in result.get("candidate_results") or []:
        collected.extend(candidate.get("errors") or [])
    return collected


def codes_at(result, path):
    return sorted({e["code"] for e in all_errors(result) if e["path"] == path})


def all_codes(result):
    return sorted({e["code"] for e in all_errors(result)})


class BoundaryAssertMixin:
    def run_validate(self, request, batch):
        return validate(dump(request), dump(batch))

    def assert_code_at(self, result, code, path, msg=""):
        found = codes_at(result, path)
        self.assertIn(code, found, f"{msg} 期望 {path} 报 {code}，实际该路径的码为 {found}；"
                                  f"全部错误={[(e['code'], e['path']) for e in all_errors(result)]}")

    def assert_no_code_at(self, result, code, path, msg=""):
        found = codes_at(result, path)
        self.assertNotIn(code, found, f"{msg} 不应在 {path} 报 {code}，实际该路径的码为 {found}")

    def assert_no_code_anywhere(self, result, code, msg=""):
        found = all_codes(result)
        self.assertNotIn(code, found, f"{msg} 任何位置都不应出现 {code}，实际={found}；"
                                     f"明细={[(e['code'], e['path']) for e in all_errors(result)]}")

    def assert_status(self, result, status, msg=""):
        self.assertEqual(status, result["status"], f"{msg} 期望 status={status}，实际={result['status']}；"
                                                   f"错误={[(e['code'], e['path']) for e in all_errors(result)]}")


# ================================================================= 预算：范围

class RequestBudgetRange(BoundaryAssertMixin, unittest.TestCase):
    """请求预算 [1, 10000] 含端点（§5 2026-10-30 修订）。"""

    def test_zero_and_zero_decimals_are_rejected(self):
        for value in ("0", "0.0", "0.00"):
            with self.subTest(budget=value):
                result = self.run_validate(my_request(budget_amount=value), my_batch())
                self.assert_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount", f"budget={value}")
                self.assert_status(result, "needs_input", f"budget={value}")

    def test_lower_bound_is_inclusive(self):
        for value in ("1", "1.00"):
            with self.subTest(budget=value):
                result = self.run_validate(my_request(budget_amount=value), my_batch())
                self.assert_no_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount", f"budget={value}")

    def test_upper_bound_is_inclusive(self):
        for value in ("10000", "10000.00"):
            with self.subTest(budget=value):
                result = self.run_validate(my_request(budget_amount=value), my_batch())
                self.assert_no_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount", f"budget={value}")

    def test_just_above_upper_bound_is_rejected(self):
        for value in ("10000.01", "10001"):
            with self.subTest(budget=value):
                result = self.run_validate(my_request(budget_amount=value), my_batch())
                self.assert_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount", f"budget={value}")
                self.assert_status(result, "needs_input", f"budget={value}")


# ================================================================= 格式优先于范围

class FormatTakesPriorityOverRange(BoundaryAssertMixin, unittest.TestCase):
    """格式错误必须是 `INVALID_AMOUNT`，**不能**因数值越界而报 `LIMIT_EXCEEDED`。

    这几个用例是精心挑选的判别器：其中 `01.00`（=1）、`1,000`（=1000）在数值上**落在范围内**，
    若实现先做数值比较再做格式校验，就会放过它们；`1e5`、`-1`、`10000.001` 则同时越界。
    只有"先格式、后范围"才会统一得到 `INVALID_AMOUNT`。
    """

    FORMAT_CASES = ["-1", "-0", "1e5", "10000.001", "00", "01.00", " 200", "1,000"]

    def test_format_errors_are_invalid_amount_not_limit_exceeded(self):
        for value in self.FORMAT_CASES:
            with self.subTest(budget=value):
                result = self.run_validate(my_request(budget_amount=value), my_batch())
                self.assert_code_at(result, "INVALID_AMOUNT", "request.budget_amount", f"budget={value!r}")
                self.assert_no_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount", f"budget={value!r}")
                self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", f"budget={value!r}")


# ================================================================= 天数

class RequestDaysRange(BoundaryAssertMixin, unittest.TestCase):
    """可用天数必须是 [0,365] 的非负 JSON 整数（§6）。"""

    def test_negative_and_non_integer_are_invalid_type(self):
        for value in (-1, True, 1.0, "3", None):
            with self.subTest(days=value):
                result = self.run_validate(my_request(available_days=value), my_batch())
                self.assert_code_at(result, "INVALID_TYPE", "request.available_days", f"days={value!r}")

    def test_zero_one_and_365_pass(self):
        for value in (0, 1, 365):
            with self.subTest(days=value):
                result = self.run_validate(my_request(available_days=value), my_batch())
                self.assert_no_code_at(result, "LIMIT_EXCEEDED", "request.available_days", f"days={value}")
                self.assert_no_code_at(result, "INVALID_TYPE", "request.available_days", f"days={value}")

    def test_366_and_astronomically_large_are_limit_exceeded(self):
        for value in (366, 10 ** 20):
            with self.subTest(days=value):
                result = self.run_validate(my_request(available_days=value), my_batch())
                self.assert_code_at(result, "LIMIT_EXCEEDED", "request.available_days", f"days={value}")
                self.assert_status(result, "needs_input", f"days={value}")


# ================================================================= 反向断言：范围不得下沉到候选侧

class CandidateSideMustRemainUnconstrained(BoundaryAssertMixin, unittest.TestCase):
    """**最重要的一组**：请求侧范围不得下沉到与候选侧共用的 `_amount`/`_days`。

    若实现把 `1 <= x <= 10000` 写进 `_amount`，候选估算 `0` 会被误拒；
    若把 `x <= 365` 写进 `_days`，候选 `0` 天准备会被误拒、大估算会混入 `LIMIT_EXCEEDED`。
    """

    def test_candidate_zero_total_still_passes(self):
        batch = my_batch()
        batch["candidates"][0]["estimated_total"] = "0"
        result = self.run_validate(my_request(budget_amount="200.00"), batch)
        self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "候选 estimated_total='0'")
        self.assert_no_code_anywhere(result, "OVER_BUDGET", "候选 estimated_total='0'")
        self.assert_status(result, "passed", "候选 estimated_total='0' 必须仍全部通过")

    def test_candidate_zero_preparation_days_still_passes(self):
        batch = my_batch()
        batch["candidates"][0]["estimated_preparation_days"] = 0
        result = self.run_validate(my_request(available_days=3), batch)
        self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "候选准备 0 天")
        self.assert_no_code_anywhere(result, "PREPARATION_TOO_LONG", "候选准备 0 天")
        self.assert_status(result, "passed", "候选准备 0 天必须仍全部通过")

    def test_huge_candidate_total_yields_only_over_budget(self):
        for total in ("20000", "999999", "10000.01"):
            with self.subTest(total=total):
                batch = my_batch()
                for candidate in batch["candidates"]:
                    candidate["estimated_total"] = total
                result = self.run_validate(my_request(budget_amount="10000"), batch)
                self.assert_code_at(result, "OVER_BUDGET", "candidates[0].estimated_total", f"total={total}")
                self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", f"候选估算 {total} 不得触发范围码")
                self.assert_status(result, "failed", f"total={total}")

    def test_huge_candidate_preparation_days_yields_only_preparation_too_long(self):
        batch = my_batch()
        for candidate in batch["candidates"]:
            candidate["estimated_preparation_days"] = 5000
        result = self.run_validate(my_request(available_days="365" and 365), batch)
        self.assert_code_at(result, "PREPARATION_TOO_LONG", "candidates[0].estimated_preparation_days")
        self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "候选准备 5000 天不得触发范围码")
        self.assert_status(result, "failed")

    def test_candidate_amount_format_rules_still_apply(self):
        """格式规则两侧同一套：候选也仍拒绝全角与前导零，但报 INVALID_AMOUNT。"""
        for value in ("２００", "01.00", "-1"):
            with self.subTest(total=value):
                batch = my_batch()
                batch["candidates"][0]["estimated_total"] = value
                result = self.run_validate(my_request(), batch)
                self.assert_code_at(result, "INVALID_AMOUNT", "candidates[0].estimated_total", f"total={value!r}")


# ================================================================= 边界语义

class BoundarySemantics(BoundaryAssertMixin, unittest.TestCase):
    """范围端点处的业务比较语义：比较用 `>`，端点相等即通过。"""

    def test_budget_one_with_candidate_over_one_yuan_is_over_budget(self):
        batch = my_batch()
        batch["candidates"][0]["estimated_total"] = "1.01"
        result = self.run_validate(my_request(budget_amount="1"), batch)
        self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "budget=1 本身在范围内")
        self.assert_code_at(result, "OVER_BUDGET", "candidates[0].estimated_total", "1.01 > 1")
        self.assert_status(result, "failed")

    def test_candidate_exactly_at_budget_one_passes(self):
        batch = my_batch()
        for candidate in batch["candidates"]:
            candidate["estimated_total"] = "1"
        result = self.run_validate(my_request(budget_amount="1"), batch)
        self.assert_status(result, "passed", "候选等于预算上限（比较用 >，不是 >=）")

    def test_days_zero_with_positive_preparation_is_too_long(self):
        batch = my_batch()
        for candidate in batch["candidates"]:
            candidate["estimated_preparation_days"] = 1
        result = self.run_validate(my_request(available_days=0), batch)
        self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "days=0 本身在范围内")
        self.assert_code_at(result, "PREPARATION_TOO_LONG", "candidates[0].estimated_preparation_days", "1 > 0")
        self.assert_status(result, "failed")

    def test_days_zero_with_zero_preparation_passes(self):
        batch = my_batch()
        for candidate in batch["candidates"]:
            candidate["estimated_preparation_days"] = 0
        result = self.run_validate(my_request(available_days=0), batch)
        self.assert_status(result, "passed", "days=0 配 0 天准备必须通过")

    def test_days_365_with_366_preparation_is_too_long(self):
        batch = my_batch()
        for candidate in batch["candidates"]:
            candidate["estimated_preparation_days"] = 366
        result = self.run_validate(my_request(available_days=365), batch)
        self.assert_no_code_anywhere(result, "LIMIT_EXCEEDED", "days=365 在范围内，不得报范围码")
        self.assert_code_at(result, "PREPARATION_TOO_LONG", "candidates[0].estimated_preparation_days")


# ================================================================= 组合：请求与候选同时越界

class RequestErrorDominates(BoundaryAssertMixin, unittest.TestCase):
    """请求侧有错时整体为 `needs_input`（§1 优先级：请求字段错误高于候选错误）。"""

    def test_request_range_error_and_candidate_error_together(self):
        batch = my_batch()
        batch["candidates"][0]["estimated_total"] = "99999"
        result = self.run_validate(my_request(budget_amount="0"), batch)
        self.assert_code_at(result, "LIMIT_EXCEEDED", "request.budget_amount")
        self.assert_status(result, "needs_input", "请求侧错误优先级更高")
        self.assertFalse(result["all_passed"], "有错误时 all_passed 必须为 false")


if __name__ == "__main__":
    unittest.main(verbosity=2)
