"""集成后执行；第一波只作语法检查，不执行被测业务。"""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from fixtures import rule_cases
from validator import validate


class RevisionRules(unittest.TestCase):
    pass


def build_test(case):
    def run(self):
        actual = validate(json.dumps(case["request"], ensure_ascii=False),
                          json.dumps(case["candidates"], ensure_ascii=False))
        self.assertEqual(actual["status"], case["status"], actual)
        self.assertEqual(actual["all_passed"], case["status"] == "passed", actual)
        self.assertEqual(actual["business_data_verification"], "not_verified")
        errors = actual["errors"] + [e for c in actual["candidate_results"] for e in c["errors"]]
        if case["code"]:
            self.assertIn((case["code"], case["path"]), [(e["code"], e["path"]) for e in errors], actual)
        if case["status"] == "passed":
            self.assertEqual(len(actual["candidate_results"]), 3)
            for candidate in actual["candidate_results"]:
                self.assertTrue(candidate["passed"], candidate)
                warnings = candidate.get("warnings", [])
                self.assertEqual(any(e["code"] == "BELOW_BUDGET_RANGE" for e in warnings), case["warning"], candidate)
                self.assertEqual(candidate["errors"], [])
    return run


for case in rule_cases():
    setattr(RevisionRules, "test_" + case["id"].replace("-", "_").replace(".", "_"), build_test(case))

if __name__ == "__main__":
    unittest.main()
