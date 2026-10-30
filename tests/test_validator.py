"""公开接口开发自测；独立验收由 tests/acceptance 另行执行。"""

import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from validator import validate


DATA = json.loads(Path(__file__).with_name("test_cases.json").read_text(encoding="utf-8"))
CASES = {case["id"]: case for case in DATA["cases"]}


def run_case(case):
    request = case.get("request_raw", json.dumps(case["request"], ensure_ascii=False))
    candidates = case.get("candidate_raw", json.dumps(case["candidate_batch"], ensure_ascii=False))
    request = case.get("request_argument", request)
    candidates = case.get("candidate_argument", candidates)
    before = (request, candidates, copy.deepcopy(case))
    output = validate(request, candidates)
    return output, before, (request, candidates, case)


def errors(output):
    return output["errors"] + [e for cr in output["candidate_results"] for e in cr["errors"]]


class ValidatorTests(unittest.TestCase):
    def test_offline_fixed_revision_snapshots(self):
        before = CASES["T07_T08_before"]
        success = CASES["T07_T08_success_after"]
        failure = CASES["T07_T08_failure_after"]
        self.assertFalse(run_case(before)[0]["all_passed"])
        self.assertTrue(run_case(success)[0]["all_passed"])
        self.assertFalse(run_case(failure)[0]["all_passed"])
        for after in (success, failure):
            self.assertEqual(before["request"], after["request"])
            self.assertEqual(before["candidate_batch"]["candidates"][1:], after["candidate_batch"]["candidates"][1:])

    def test_partial_failure_is_not_all_passed(self):
        output = run_case(CASES["T02_amount_200.01"])[0]
        self.assertEqual([False, True, True], [c["passed"] for c in output["candidate_results"]])
        self.assertEqual([], output["errors"])

    def test_decimal_boundary_ignores_context_rounding(self):
        # 请求预算上界为 10000，越界预算会先被 LIMIT_EXCEEDED 拦下并抑制候选侧上下文，
        # 因此改为在上界处验证十进制比较不按浮点取整。
        case = copy.deepcopy(CASES["T01_normal"])
        case["request"]["budget_amount"] = "10000"
        case["candidate_batch"]["candidates"][0]["estimated_total"] = "10000.00"
        self.assertTrue(run_case(case)[0]["candidate_results"][0]["passed"])
        case["candidate_batch"]["candidates"][0]["estimated_total"] = "10000.01"
        self.assertIn("OVER_BUDGET", [e["code"] for e in errors(run_case(case)[0])])

    def test_deep_json_and_non_string_arguments_controlled(self):
        good = CASES["T01_normal"]
        req = json.dumps(good["request"])
        batch = json.dumps(good["candidate_batch"])
        for bad in (None, 1, False, [], {}, '[' * 2000 + '0' + ']' * 2000):
            for args in ((bad, batch), (req, bad)):
                output = validate(*args)
                self.assertFalse(output["all_passed"])
                self.assertNotIn("INTERNAL_ERROR", [e["code"] for e in errors(output)])
                json.dumps(output, allow_nan=False)

    def test_fact_attribution_is_not_semantic_verification(self):
        case = copy.deepcopy(CASES["T01_normal"])
        case["candidate_batch"]["candidates"][0]["reason"] = "这是模型文字，不代表代码验证过语义"
        self.assertTrue(run_case(case)[0]["all_passed"])

    def test_duplicate_content_marks_every_participant(self):
        output = run_case(CASES["CONTRACT_duplicate_normalized"])[0]
        self.assertEqual([False, False, True], [c["passed"] for c in output["candidate_results"]])
        for i in (0, 1):
            self.assertIn(f"candidates[{i}]", [e["path"] for e in output["candidate_results"][i]["errors"]])

    def test_candidates_do_not_use_general_array_limit(self):
        case = copy.deepcopy(CASES["T01_normal"])
        case["candidate_batch"]["candidates"] *= 7
        es = errors(run_case(case)[0])
        self.assertIn("INVALID_CANDIDATE_COUNT", [e["code"] for e in es])
        self.assertFalse(any(e["code"] == "LIMIT_EXCEEDED" and e["path"] == "candidates" for e in es))

    def test_utf8_invalid_parameters(self):
        case = CASES["T01_normal"]
        request, candidates = json.dumps(case["request"]), json.dumps(case["candidate_batch"])
        for args in (("\ud800", candidates), (request, "\udfff")):
            output = validate(*args)
            self.assertEqual("error", output["status"])
            self.assertIn("INVALID_JSON", [e["code"] for e in errors(output)])
            json.dumps(output, allow_nan=False)

    def test_controlled_internal_exception_does_not_expose_details(self):
        with patch("validator.rules._pairs", side_effect=RuntimeError("敏感模拟异常详情")):
            output = run_case(CASES["T01_normal"])[0]
        self.assertEqual("error", output["status"])
        self.assertEqual(["INTERNAL_ERROR"], [e["code"] for e in errors(output)])
        self.assertNotIn("敏感模拟异常详情", json.dumps(output, ensure_ascii=False))
        self.assertFalse(output["all_passed"])


def fixture_test(case):
    def test(self):
        output, before, after = run_case(copy.deepcopy(case))
        self.assertEqual(before, after, "输入必须保持不变")
        self.assertEqual(output, run_case(copy.deepcopy(case))[0], "输出必须确定")
        self.assertEqual(case["expected"]["status"], output["status"])
        self.assertEqual(case["expected"]["all_passed"], output["all_passed"])
        if "candidate_passed" in case["expected"]:
            self.assertEqual(case["expected"]["candidate_passed"],
                             [candidate["passed"] for candidate in output["candidate_results"]])
        self.assertEqual("not_verified", output["business_data_verification"])
        self.assertEqual(output, json.loads(json.dumps(output, ensure_ascii=False, allow_nan=False)))
        es = errors(output)
        self.assertNotIn("INTERNAL_ERROR", [e["code"] for e in es])
        for e in es:
            self.assertEqual({"code", "path", "message"}, set(e))
            self.assertTrue(all(isinstance(v, str) and v for v in e.values()))
            self.assertTrue(any('\u4e00' <= ch <= '\u9fff' for ch in e["message"]))
        expected = case["expected"]
        if "code" in expected:
            matches = [e for e in es if e["code"] == expected["code"]]
            self.assertTrue(matches, es)
            if "path" in expected:
                self.assertIn(expected["path"], [e["path"] for e in matches])
                matches = [e for e in matches if e["path"] == expected["path"]]
            if "message" in expected:
                self.assertIn(expected["message"], [e["message"] for e in matches])
        self.assertNotIn("待 PM 确认", json.dumps(output, ensure_ascii=False))
        if output["all_passed"]:
            self.assertEqual(3, len(output["candidate_results"]))
            self.assertTrue(all(c["passed"] for c in output["candidate_results"]))
    return test


for index, case in enumerate(DATA["cases"]):
    setattr(ValidatorTests, f"test_fixture_{index:03d}_{case['id']}", fixture_test(case))


if __name__ == "__main__":
    unittest.main()
