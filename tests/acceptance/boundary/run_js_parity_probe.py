"""QA-001 独立发现复核：JS 侧 `web/server/checker.mjs` 的请求侧范围校验缺失。

做法：用**同一批输入**分别跑
  A 侧 = Python `validator.rules.validate`
  B 侧 = JS `web/server/checker.mjs` 的 `validate`（经 `js_range_probe.mjs`）
然后逐项对照 status 与错误码。

**不修改 `web/**`**，只调用其公开导出。

运行：
    python tests/acceptance/boundary/run_js_parity_probe.py
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate as py_validate  # noqa: E402

OUT_JSON = ROOT / "docs/test-reports/boundary-001/evidence/js-range-parity.json"
OUT_TXT = ROOT / "docs/test-reports/boundary-001/evidence/js-range-parity.txt"


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def request(overrides):
    base = {
        "recipient_relation": "追求对象", "recipient_relation_id": "pursuit", "occasion": "生日",
        "budget_amount": "200.00", "currency": "CNY", "available_days": 3,
        "facts": [{"id": "f1", "text": "对方喜欢手冲咖啡"}],
        "forbidden_tags": [], "forbidden_terms": [], "notes": "希望低调一些",
        "closeness": "unknown", "preference_inferences": [], "gift_styles": [],
        "hard_exclusions_original": {"tags": [], "terms": [], "unresolved": []},
    }
    base.update(overrides)
    return base


def candidate(cid, name, total, days):
    return {"id": cid, "name": name, "description": f"{name}：虚构方案说明",
            "estimated_total": total, "currency": "CNY", "estimated_preparation_days": days,
            "tags": ["other"], "reason": "匹配用户已确认的偏好与预算上限", "fact_refs": ["f1"],
            "inferences": ["可能偏好实用礼物"], "unknowns": ["实际价格以商家为准"],
            "presentation": "简要呈现"}


def batch():
    return {"candidates": [candidate("c1", "手冲咖啡礼盒", "150.00", 1),
                           candidate("c2", "陶瓷马克杯", "120.00", 2),
                           candidate("c3", "咖啡豆订阅卡", "80.00", 3)]}


def all_errors(result):
    collected = list(result.get("errors") or [])
    for item in result.get("candidate_results") or []:
        collected.extend(item.get("errors") or [])
    return collected


def py_codes(result):
    return sorted({e["code"] for e in all_errors(result)})


def py_codes_at(result, path):
    return sorted({e["code"] for e in all_errors(result) if e["path"] == path})


def main():
    probe = ROOT / "tests/acceptance/boundary/js_range_probe.mjs"
    proc = subprocess.run(["node", str(probe)], capture_output=True, text=True, cwd=str(ROOT),
                          encoding="utf-8")
    if proc.returncode != 0:
        print("node 探针失败：", proc.returncode)
        print(proc.stderr[:2000])
        return 2
    js = json.loads(proc.stdout)

    lines = []
    rows = []
    divergences = []
    for js_row in js["rows"]:
        req = request(js_row["request_overrides"])
        b = batch()
        label = js_row["label"]
        if "20000" in label:
            for c in b["candidates"]:
                c["estimated_total"] = "20000"
        if "prep=0" in label:
            b["candidates"][0]["estimated_preparation_days"] = 0

        py_result = py_validate(dump(req), dump(b))
        py_row = {
            "py_status": py_result["status"],
            "py_codes": py_codes(py_result),
            "py_codes_at_budget_path": py_codes_at(py_result, "request.budget_amount"),
            "py_codes_at_days_path": py_codes_at(py_result, "request.available_days"),
        }
        agree_status = py_row["py_status"] == js_row["js_status"]
        agree_codes = py_row["py_codes"] == js_row["js_codes"]
        diverges = not (agree_status and agree_codes)
        if diverges:
            divergences.append(label)
        rows.append({"label": label, "python": py_row,
                     "js": {k: v for k, v in js_row.items() if k.startswith("js_")},
                     "status_agrees": agree_status, "codes_agree": agree_codes,
                     "diverges": diverges})
        lines.append(f"{label:<34} Python={py_row['py_status']:<12}{str(py_row['py_codes']):<28} "
                     f"JS={js_row['js_status']:<12}{str(js_row['js_codes']):<28} "
                     f"{'一致' if not diverges else '**分歧**'}")

    header = [f"node {js['node']}", f"探针 {js['probe']}", "",
              f"{'用例':<34}{'Python':<40}{'JS':<40}判定", "-" * 120]
    text = "\n".join(header + lines + [
        "", f"分歧用例数：{len(divergences)}/{len(rows)}",
        "分歧清单：" + (json.dumps(divergences, ensure_ascii=False) if divergences else "无"), ""])
    OUT_TXT.parent.mkdir(parents=True, exist_ok=True)
    OUT_TXT.write_text(text, encoding="utf-8")
    OUT_JSON.write_text(json.dumps({"rows": rows, "divergences": divergences,
                                    "node": js["node"]}, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
