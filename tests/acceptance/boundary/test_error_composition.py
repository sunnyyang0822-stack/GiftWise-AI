"""QA-001 求值顺序、错误组合与解析器边界（深水区结论固化）。

本文件把 `probe_deep_edges.py` 的探索性发现固化为可复跑断言，覆盖**范围校验之外**的相邻行为：

- **错误组合**：多个范围/类型/币种错误是否都上报（不去重、不吞掉）。
- **优先级**：JSON 数字型金额越界 → 只报 `INVALID_TYPE`（**范围被正确跳过**，不得混入 `LIMIT_EXCEEDED`）；
  字段缺失 → 只报 `MISSING_FIELD`。
- **>1000 码点**：`_amount` 对合法格式但超长的金额**静默返回 None**，因此范围检查被跳过；
  该输入由**长度规则**兜住（同码、同路径）。断言这一点，确认**没有漏过**。
- **解析器边界**：超长整数字面量、重复键、`null` 根——断言契约级不变量，
  且**任何输入都不得产出 `INTERNAL_ERROR`**。

刻意**不断言**解释器相关阈值本身（4301 位）：那是 CPython `int_max_str_digits` 的产物，
会随 Python 版本变化（本地实测：关闭该上限后同一请求从 `INVALID_JSON` 变为 `LIMIT_EXCEEDED`）。
这里只断言**跨版本都成立的不变量**。

运行： python -m unittest discover -s tests/acceptance/boundary -v
"""

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402

# 命名占位符模板；末尾必须闭合外层对象（历史上我因漏闭合导致整组误报 INVALID_JSON）。
TMPL = (
    '{"recipient_relation":"\u670b\u53cb","recipient_relation_id":"friend",'
    '"occasion":"\u751f\u65e5","budget_amount":%(b)s,"currency":%(c)s,"available_days":%(d)s,'
    '"facts":[{"id":"f1","text":"x"}],"forbidden_tags":[],"forbidden_terms":[],"notes":"",'
    '"closeness":"unknown","preference_inferences":[],"gift_styles":[],'
    '"hard_exclusions_original":{"tags":[],"terms":[],"unresolved":[]}}'
)
DROP_BUDGET = TMPL.replace('"budget_amount":%(b)s,', "")
DROP_DAYS = TMPL.replace(',"available_days":%(d)s', "")


def raw(b='"200.00"', d="3", c='"CNY"'):
    """用原始 JSON 文本构造请求，以便精确注入 JSON 数字/布尔/指数/超长字面量。"""
    return TMPL % {"b": b, "d": d, "c": c}


def _cand(i, name, total_literal, days_literal):
    return ('{"id":"%s","name":"%s","description":"虚构方案说明","estimated_total":%s,'
            '"currency":"CNY","estimated_preparation_days":%s,"tags":["other"],'
            '"reason":"匹配用户已确认的偏好与预算上限","fact_refs":["f1"],'
            '"inferences":["可能偏好实用礼物"],"unknowns":["实际价格以商家为准"],'
            '"presentation":"简要呈现"}' % (i, name, total_literal, days_literal))


def cand(total='"150.00"', days="1"):
    body = ",".join([_cand("c1", "手冲咖啡礼盒", total, days),
                     _cand("c2", "陶瓷马克杯", '"120.00"', "2"),
                     _cand("c3", "咖啡豆订阅卡", '"80.00"', "3")])
    return '{"candidates":[' + body + "]}"


def all_errors(result):
    collected = list(result.get("errors") or [])
    for item in result.get("candidate_results") or []:
        collected.extend(item.get("errors") or [])
    return collected


def pairs(result):
    """(code, path) 列表，含候选级。"""
    return [(e["code"], e["path"]) for e in all_errors(result)]


def codes_at(result, path):
    return [e["code"] for e in all_errors(result) if e["path"] == path]


def run(request_json, candidates_json=None):
    return validate(request_json, candidates_json if candidates_json is not None else cand())


class DeepEdgeMixin:
    def assert_no_internal_error(self, result, label):
        self.assertNotIn("INTERNAL_ERROR", [e["code"] for e in all_errors(result)],
                         f"{label}：任何输入都不得产出 INTERNAL_ERROR，实际={pairs(result)}")

    def assert_status(self, result, expected, label):
        self.assertEqual(expected, result["status"], f"{label}：实际={pairs(result)}")


class ErrorComposition(DeepEdgeMixin, unittest.TestCase):
    """多个错误并存时是否都上报（不去重、不互相吞掉）。"""

    def test_two_range_errors_are_both_reported(self):
        result = run(raw('"10000.01"', "366"))
        self.assert_status(result, "needs_input", "预算与天数同时越界")
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "request.budget_amount"))
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "request.available_days"))
        self.assertEqual(2, len([c for c in pairs(result) if c[0] == "LIMIT_EXCEEDED"]),
                         "两个范围错误应各自上报，不得合并或去重")
        self.assertFalse(result["all_passed"])

    def test_range_and_type_errors_coexist(self):
        result = run(raw('"10000.01"', "-1"))
        self.assertEqual(["INVALID_TYPE"], codes_at(result, "request.available_days"))
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "request.budget_amount"))
        self.assert_status(result, "needs_input", "范围 + 类型")

    def test_range_and_currency_errors_coexist(self):
        result = run(raw('"10000.01"', "3", '"USD"'))
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "request.budget_amount"))
        self.assertEqual(["UNSUPPORTED_CURRENCY"], codes_at(result, "request.currency"))
        self.assert_status(result, "needs_input", "范围 + 币种")

    def test_three_distinct_errors_all_reported(self):
        result = run(raw('"10000.01"', "-1", '"USD"'))
        found = {c for c, _ in pairs(result)}
        self.assertEqual({"INVALID_TYPE", "LIMIT_EXCEEDED", "UNSUPPORTED_CURRENCY"}, found,
                         f"三类错误应全部上报，实际={pairs(result)}")
        self.assert_status(result, "needs_input", "三错并存")


class TypeAndPresenceBeatRange(DeepEdgeMixin, unittest.TestCase):
    """优先级：类型错误/字段缺失**优先**，且不得混入范围错误。"""

    def test_json_number_out_of_range_budget_reports_type_only(self):
        """JSON 数字 `20000` 数值上越界，但类型错优先 → 只报 INVALID_TYPE。"""
        result = run(raw("20000"))
        self.assertEqual(["INVALID_TYPE"], codes_at(result, "request.budget_amount"))
        self.assertNotIn("LIMIT_EXCEEDED", [c for c, _ in pairs(result)],
                         "`_amount` 已返回 None，范围检查必须被跳过，不得混入 LIMIT_EXCEEDED")
        self.assert_status(result, "needs_input", "JSON 数字型越界预算")

    def test_json_number_zero_budget_reports_type_only(self):
        result = run(raw("0"))
        self.assertEqual(["INVALID_TYPE"], codes_at(result, "request.budget_amount"))
        self.assertNotIn("LIMIT_EXCEEDED", [c for c, _ in pairs(result)])
        self.assert_status(result, "needs_input", "JSON 数字型零预算")

    def test_missing_budget_reports_missing_field_only(self):
        result = run(DROP_BUDGET % {"d": "3", "c": '"CNY"'})
        self.assertEqual(["MISSING_FIELD"], codes_at(result, "request.budget_amount"))
        self.assertNotIn("LIMIT_EXCEEDED", [c for c, _ in pairs(result)],
                         "字段缺失应只报 MISSING_FIELD，不得同时报范围错误")
        self.assert_status(result, "needs_input", "预算字段缺失")

    def test_missing_days_reports_missing_field_only(self):
        result = run(DROP_DAYS % {"b": '"200.00"', "c": '"CNY"'})
        self.assertEqual(["MISSING_FIELD"], codes_at(result, "request.available_days"))
        self.assertNotIn("LIMIT_EXCEEDED", [c for c, _ in pairs(result)])
        self.assert_status(result, "needs_input", "天数字段缺失")

    def test_float_bool_and_infinity_days_are_invalid_type(self):
        for literal, label in (("0.0", "JSON float 0.0"), ("1e400", "JSON 1e400 → inf"),
                               ("true", "JSON true")):
            with self.subTest(literal=literal):
                result = run(raw(d=literal))
                self.assertEqual(["INVALID_TYPE"], codes_at(result, "request.available_days"),
                                 f"{label} 应为 INVALID_TYPE")
                self.assert_status(result, "needs_input", label)


class OverLongAmountIsStillRejected(DeepEdgeMixin, unittest.TestCase):
    """>1000 码点的**合法格式**金额：范围检查被跳过，但必须由长度规则兜住（同码同路径）。"""

    def test_1000_code_points_hits_the_range_rule(self):
        """恰好 1000 码点仍在长度规则之内，故由**范围**规则拒绝。"""
        result = run(raw('"' + "1" * 1000 + '"'))
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "request.budget_amount"))
        message = [e["message"] for e in all_errors(result)
                   if e["path"] == "request.budget_amount"][0]
        self.assertIn("预算", message, f"1000 码点应由范围规则拒绝，实际消息={message!r}")
        self.assert_status(result, "needs_input", "1000 码点金额")

    def test_1001_code_points_is_still_rejected_by_the_length_rule(self):
        """1001 码点：`_amount` 静默返回 None → 范围检查跳过 → 由长度规则拒绝。

        关键断言：**码与路径与范围规则相同**，因此不存在"越界值漏过"。
        但消息来自长度规则（这是我特意记录的归因差异，供错误码溯源时不被误导）。
        """
        result = run(raw('"' + "1" * 1001 + '"'))
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "request.budget_amount"),
                         ">1000 码点必须仍被拒绝，且路径不变")
        self.assertNotIn("OVER_BUDGET", [c for c, _ in pairs(result)],
                         "不得因格式解析失败而放行到候选比较")
        message = [e["message"] for e in all_errors(result)
                   if e["path"] == "request.budget_amount"][0]
        self.assertIn("1000", message,
                      f"该输入应由长度规则拒绝（消息含 1000），实际={message!r}")
        self.assert_status(result, "needs_input", "1001 码点金额")

    def test_candidate_over_long_amount_is_rejected_by_length_rule(self):
        result = run(raw(), cand(total='"' + "1" * 1001 + '"'))
        self.assertEqual(["LIMIT_EXCEEDED"], codes_at(result, "candidates[0].estimated_total"))
        self.assertNotIn("OVER_BUDGET", [c for c, _ in pairs(result)],
                         "超长候选金额应由长度规则拒绝，不得进入 OVER_BUDGET 比较")
        self.assertFalse(result["all_passed"])

    def test_candidate_astronomically_large_amount_reports_only_over_budget(self):
        """999 码点（长度合规）的巨大候选金额：**只能**是 OVER_BUDGET，绝不能是 LIMIT_EXCEEDED。"""
        result = run(raw('"10000"'), cand(total='"' + "9" * 999 + '"'))
        self.assertEqual(["OVER_BUDGET"], codes_at(result, "candidates[0].estimated_total"))
        self.assertNotIn("LIMIT_EXCEEDED", [c for c, _ in pairs(result)],
                         "候选侧不受请求侧范围约束：不得出现 LIMIT_EXCEEDED")
        self.assert_status(result, "failed", "巨大候选金额")


class ParserBoundaries(DeepEdgeMixin, unittest.TestCase):
    """解析器边界：只断言**跨解释器版本稳定**的不变量。"""

    def test_null_root_is_invalid_request(self):
        result = run("null")
        self.assertEqual(["INVALID_REQUEST"], codes_at(result, "request"))
        self.assertNotIn("INVALID_JSON", [c for c, _ in pairs(result)],
                         "`null` 是合法 JSON，应报 INVALID_REQUEST 而非 INVALID_JSON")
        self.assert_status(result, "needs_input", "根节点为 null")

    def test_array_root_is_invalid_request(self):
        result = run("[]")
        self.assertEqual(["INVALID_REQUEST"], codes_at(result, "request"))
        self.assert_status(result, "needs_input", "根节点为数组")

    def test_empty_request_json_is_invalid_json(self):
        result = run("")
        self.assertEqual(["INVALID_JSON"], codes_at(result, "request_json"))
        self.assert_status(result, "error", "空 request_json")

    def test_duplicate_key_is_invalid_json(self):
        duplicated = raw().replace('"budget_amount":"200.00"',
                                   '"budget_amount":"200.00","budget_amount":"0"')
        result = run(duplicated)
        self.assertEqual(["INVALID_JSON"], codes_at(result, "request_json"))
        self.assert_status(result, "error", "重复键")

    def test_extreme_integer_literal_never_yields_internal_error(self):
        """超长整数字面量：**不锁定**具体码（取决于 CPython 的 int 位数上限），
        只锁定契约级不变量——必须被拒绝、必须不是 INTERNAL_ERROR、
        若为解析失败则候选必须全部被置为未通过。
        """
        for digits in (4300, 4301, 5000):
            with self.subTest(digits=digits):
                result = run(raw(d="9" * digits))
                found = {c for c, _ in pairs(result)}
                self.assert_no_internal_error(result, f"{digits} 位整数")
                self.assertIn(result["status"], ("error", "needs_input"),
                              f"{digits} 位整数必须被拒绝，实际={result['status']}")
                self.assertFalse(result["all_passed"], f"{digits} 位整数不得 all_passed")
                self.assertTrue(found <= {"INVALID_JSON", "LIMIT_EXCEEDED"},
                                f"{digits} 位整数只应产出 INVALID_JSON 或 LIMIT_EXCEEDED，实际={found}")
                if result["status"] == "error":
                    self.assertIn("INVALID_JSON", found)
                    for item in result["candidate_results"]:
                        self.assertFalse(item["passed"],
                                         "解析失败时必须强制所有候选 passed=False")

    def test_extreme_integer_in_candidates_is_rejected(self):
        result = run(raw(), cand(days="9" * 5000))
        self.assert_no_internal_error(result, "候选超长整数")
        self.assertIn(result["status"], ("error", "needs_input"))
        self.assertFalse(result["all_passed"])

    def test_no_probe_in_this_file_triggers_internal_error(self):
        """汇总守卫：本文件涉及的全部极端输入都不得产出 INTERNAL_ERROR。"""
        probes = [raw('"0"', "366"), raw('"0"', "-1", '"USD"'), raw("20000"), raw(),
                  raw('"' + "1" * 1001 + '"'), raw(d="9" * 5000), raw(d="1e400"),
                  "null", "[]", "", cand(total='"0"', days="0"),
                  cand(total='"' + "9" * 999 + '"')]
        for i, payload in enumerate(probes):
            request_json = payload if isinstance(payload, str) and payload.startswith("{") or payload in ("null", "[]", "") else payload[0]
            candidates_json = payload[1] if isinstance(payload, tuple) else None
            with self.subTest(i=i):
                self.assert_no_internal_error(run(request_json, candidates_json), f"探针#{i}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
