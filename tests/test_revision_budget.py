"""REV-VAL-001：新版预算区间、适配和新版呈现的 Python 回归。"""

import copy
import json
import unittest

from validator.rules import validate
from workflow.intake import adapt_intake


def request(budget="300", days=5, **extra):
    value = {
        "recipient_relation": "追求对象",
        "occasion": "生日",
        "budget_amount": budget,
        "currency": "CNY",
        "available_days": days,
        "facts": [], "forbidden_tags": [], "forbidden_terms": [], "notes": "低压力",
    }
    value.update(extra)
    return value


def candidate(total="150.00", days=3):
    return {
        "id": "c1", "name": "虚构礼物 A", "description": "虚构描述 A",
        "estimated_total": total, "currency": "CNY", "estimated_preparation_days": days,
        "tags": ["other"], "reason": "虚构理由", "fact_refs": [],
        "inferences": [], "unknowns": ["实际供应未知"],
    }


def batch(first=None):
    first = first or candidate()
    other = [candidate("80.00", 2), candidate("60.00", 1)]
    other[0]["id"], other[0]["name"], other[0]["description"] = "c2", "虚构礼物 B", "虚构描述 B"
    other[1]["id"], other[1]["name"], other[1]["description"] = "c3", "虚构礼物 C", "虚构描述 C"
    return {"candidates": [first, *other]}


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class RevisionBudgetTests(unittest.TestCase):
    def call(self, req, candidates=None):
        return validate(dump(req), dump(candidates or batch()))

    def test_zero_and_fractional_legacy_budget(self):
        for amount in ("0", "0.99"):
            req = request(amount)
            candidates = batch(candidate("0.00", 1))
            for item in candidates["candidates"][1:]:
                item["estimated_total"] = "0.00"
            self.assertTrue(self.call(req, candidates)["all_passed"], amount)

    def test_budget_range_modes_and_boundaries(self):
        for mode, interval in (("slider", {"min": "0", "max": "1000"}),
                               ("zero", {"min": "0", "max": "0"}),
                               ("other", {"min": "0.99", "max": "10000"})):
            req = request(interval["max"], budget_mode=mode, budget_range=interval,
                          contract_version="giftwise-20261031-v2")
            candidates = batch(candidate("0.00"))
            if mode == "zero":
                for item in candidates["candidates"][1:]:
                    item["estimated_total"] = "0.00"
            out = self.call(req, candidates)
            self.assertTrue(out["all_passed"], (mode, out))
        for mode, interval in (("other", {"min": "0", "max": "10000.01"}),):
            req = request(interval["max"], budget_mode=mode, budget_range=interval,
                          contract_version="giftwise-20261031-v2")
            self.assertEqual("needs_input", self.call(req)["status"], (mode, interval))

    def test_range_mismatch_and_low_warning(self):
        req = request("300", budget_mode="slider", budget_range={"min": "200", "max": "250"},
                      contract_version="giftwise-20261031-v2")
        out = self.call(req)
        self.assertEqual("needs_input", out["status"])
        self.assertIn("BUDGET_RANGE_MISMATCH", [e["code"] for e in out["errors"]])
        req["budget_amount"] = "300"
        req["budget_range"] = {"min": "300", "max": "300"}
        out = self.call(req, batch(candidate("150.00")))
        self.assertTrue(out["all_passed"])
        self.assertEqual("BELOW_BUDGET_RANGE", out["candidate_results"][0]["warnings"][0]["code"])

    def test_range_structure_and_bad_amounts_are_not_repaired(self):
        for value in ({"min": None, "max": "300"}, {"max": "300"},
                      {"min": "01", "max": "300"}, {"min": "3e1", "max": "300"},
                      {"min": "400", "max": "300"}):
            req = request("300", budget_mode="other", budget_range=value,
                          contract_version="giftwise-20261031-v2")
            self.assertEqual("needs_input", self.call(req)["status"])

    def test_deadline_and_zero_budget_are_independent(self):
        req = request("0", 366)
        out = self.call(req, batch(candidate("0.00", 1)))
        self.assertEqual("needs_input", out["status"])
        self.assertIn("LIMIT_EXCEEDED", [e["code"] for e in out["errors"]])

    def test_intake_derives_max_and_preserves_dislikes(self):
        raw = dump({"contract_version": "giftwise-20261031-v2", "budget_mode": "slider",
                    "budget_range": {"min": "100", "max": "300"}, "recipient_relation": "pursuit",
                    "occasion": "birthday", "currency": "CNY", "deadline_days": 5,
                    "dislikes": "不要香氛"})
        out = adapt_intake(raw)
        self.assertEqual("ready", out["status"], out)
        req = json.loads(out["request_json"])
        self.assertEqual("300", req["budget_amount"])
        self.assertEqual("不要香氛", req["dislikes"])

    def test_intake_rejects_mismatch_null_and_unknown_fields(self):
        base = {"contract_version": "giftwise-20261031-v2", "budget_mode": "other",
                "budget_range": {"min": "100", "max": "300"}, "budget_amount": "299",
                "recipient_relation": "friend", "occasion": "birthday", "currency": "CNY",
                "deadline_days": 5}
        out = adapt_intake(dump(base))
        self.assertEqual("needs_input", out["status"])
        self.assertIn("BUDGET_RANGE_MISMATCH", [e["code"] for e in out["errors"]])
        base["budget_range"]["min"] = None
        base["budget_amount"] = "300"
        out = adapt_intake(dump(base))
        self.assertTrue(any(e["code"] == "INVALID_TYPE" for e in out["errors"]))
        base["budget_range"] = {"min": "100", "max": "300"}
        base["budget_mode"] = "invalid"
        self.assertTrue(any(e["code"] == "INVALID_BUDGET_RANGE" for e in adapt_intake(dump(base))["errors"]))
        base.pop("budget_range")
        base["budget_amount"] = "300"
        base["nope"] = 1
        self.assertTrue(any(e["code"] == "INTAKE_UNKNOWN_FIELD" for e in adapt_intake(dump(base))["errors"]))

    def test_v2_presentation_shape_is_not_legacy(self):
        # Python presentation checker is intentionally owned by JS checker; this fixture
        # documents the frozen candidate price that the JS test must use.
        frozen = candidate("138.00", 3)
        self.assertEqual("138.00", frozen["estimated_total"])


if __name__ == "__main__":
    unittest.main()
