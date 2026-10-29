"""独立契约断言：只调用公开 validate，不导入开发自测或内部规则。"""

import copy
from contextlib import ExitStack
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch
import urllib.request


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from validator import validate


CASES = json.loads(Path(__file__).with_name("cases.json").read_text(encoding="utf-8"))["cases"]
OBSERVATIONS = {}
REVIEW = ROOT / "docs/pm-reviews/val-001-rereview-2026-10-29.md"
EXPECTED_HASHES = dict(re.findall(r"- `([^`]+)`：`([0-9a-f]{64})`", REVIEW.read_text(encoding="utf-8")))


def call_public(case):
    with ExitStack() as stack:
        if case["mode"] == "deny_io":
            for target in ("builtins.open", "socket.socket", "socket.create_connection",
                           "subprocess.run", "urllib.request.urlopen", "os.getenv"):
                stack.enter_context(patch(target, side_effect=AssertionError("离线校验不得访问外部资源")))
        elif case["mode"] == "fault":
            stack.enter_context(patch("json.loads", side_effect=RuntimeError("模拟故障哨兵不可泄露")))
        return validate(case["request_arg"], case["candidates_arg"])


class Acceptance(unittest.TestCase):
    def test_review_manifest_has_four_files(self):
        self.assertEqual({"validator/__init__.py", "validator/rules.py", "tests/test_validator.py", "tests/test_cases.json"}, set(EXPECTED_HASHES))

    def test_fixed_snapshots_only_change_failed_candidate_amount(self):
        cases = {c["id"]: c for c in CASES}
        before = cases["offline_snapshot_before"]
        for name in ("offline_snapshot_success_after", "offline_snapshot_failure_after"):
            after = cases[name]
            self.assertEqual(before["request_arg"], after["request_arg"])
            batch_a, batch_b = json.loads(before["candidates_arg"]), json.loads(after["candidates_arg"])
            self.assertEqual(batch_a["candidates"][1:], batch_b["candidates"][1:])
            batch_a["candidates"][0].pop("estimated_total")
            batch_b["candidates"][0].pop("estimated_total")
            self.assertEqual(batch_a, batch_b)


def hash_test(name, expected):
    def test(self):
        actual = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
        OBSERVATIONS[self.id()] = {"file": name, "expected_sha256": expected, "actual_sha256": actual}
        self.assertEqual(expected, actual)
    return test


def case_test(case):
    def test(self):
        before = copy.deepcopy(case)
        output = call_public(case)
        OBSERVATIONS[self.id()] = {"case": copy.deepcopy(case), "actual": copy.deepcopy(output)}
        self.assertEqual(before, case, "输入被改变")
        frozen = copy.deepcopy(output)
        self.assertEqual(frozen, call_public(case), "相同输入结果不确定")
        self.assertEqual(frozen, output, "后续调用改变了先前响应")
        self.assertEqual(output, json.loads(json.dumps(output, allow_nan=False)), "响应不是严格 JSON 数据")
        self.assertTrue({"status", "all_passed", "errors", "candidate_results", "business_data_verification"} <= output.keys())
        self.assertEqual("not_verified", output["business_data_verification"])
        self.assertEqual(case["expected"]["status"], output["status"])
        self.assertIs(case["expected"]["all_passed"], output["all_passed"])
        candidates = output["candidate_results"]
        self.assertIsInstance(candidates, list)
        all_errors = list(output["errors"])
        for candidate in candidates:
            self.assertTrue({"id", "passed", "errors", "warnings"} <= candidate.keys())
            self.assertIs(type(candidate["passed"]), bool)
            self.assertIsInstance(candidate["warnings"], list)
            all_errors.extend(candidate["errors"])
        for error in all_errors:
            self.assertEqual({"code", "path", "message"}, error.keys())
            self.assertTrue(all(isinstance(v, str) and v for v in error.values()))
            self.assertRegex(error["message"], "[\u4e00-\u9fff]")
        for expected in case["expected"]["errors"]:
            location = expected["location"]
            actual_errors = output["errors"] if location == "top" else candidates[location]["errors"]
            matching = [e for e in actual_errors if e["code"] == expected["code"] and e["path"] == expected["path"]]
            self.assertTrue(matching, f"缺少错误 {expected}，实际 {actual_errors}")
            if "message" in expected:
                self.assertIn(expected["message"], [e["message"] for e in matching])
        if "candidate_passed" in case["expected"]:
            self.assertEqual(case["expected"]["candidate_passed"], [c["passed"] for c in candidates])
        if output["status"] in ("needs_input", "error"):
            self.assertFalse(any(c["passed"] for c in candidates), "错误请求或解析失败不能伪造候选通过")
        if output["all_passed"]:
            self.assertEqual("passed", output["status"])
            self.assertEqual([], all_errors)
            self.assertEqual({"c1", "c2", "c3"}, {c["id"] for c in candidates})
            self.assertEqual(3, len(candidates))
            self.assertTrue(all(c["passed"] for c in candidates))
        for code in case["expected"].get("absent_codes", []):
            self.assertNotIn(code, [e["code"] for e in all_errors])
        if case["mode"] != "fault":
            self.assertNotIn("INTERNAL_ERROR", [e["code"] for e in all_errors])
        self.assertNotIn("模拟故障哨兵不可泄露", json.dumps(output, ensure_ascii=False))
    return test


for i, (name, expected) in enumerate(EXPECTED_HASHES.items()):
    setattr(Acceptance, f"test_hash_{i}", hash_test(name, expected))
for i, case in enumerate(CASES):
    setattr(Acceptance, f"test_case_{i:03d}_{case['id']}", case_test(case))


if __name__ == "__main__":
    unittest.main()
