"""JS↔Python 语义比对的参考实现侧（任务号 WEB-WF-001）。

读取 web/tools/gen-parity-fixtures.mjs 产出的固定样例，对**完全相同的 JSON 字符串**
调用仓库里的 Python 参考实现（workflow/intake.py 与 validator/rules.py），
把归一化结果写入 .tmp/web-parity/python-out.json，交给 web/tools/parity-check.mjs 比对。

本文件只读取仓库既有实现，不修改 workflow/、validator/ 下任何文件。
运行： python web/tools/parity-reference.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402
from workflow.intake import adapt_intake  # noqa: E402

WORKDIR = ROOT / ".tmp" / "web-parity"


def norm_errors(errors):
    return [{"code": e.get("code"), "path": e.get("path"), "message": e.get("message")} for e in errors or []]


def main() -> int:
    fixtures = json.loads((WORKDIR / "fixtures.json").read_text(encoding="utf-8"))

    intake_out = []
    for case in fixtures["intake_cases"]:
        result = adapt_intake(case["intake_json"])
        intake_out.append(
            {
                "id": case["id"],
                "status": result["status"],
                "errors": norm_errors(result["errors"]),
                "request_json": result["request_json"],
            }
        )

    validate_out = []
    for batch in list(fixtures["candidate_batches"]) + list(fixtures.get("broken_batches", [])):
        result = validate(batch["request_json"], batch["candidates_json"])
        validate_out.append(
            {
                "id": batch["id"],
                "status": result["status"],
                "all_passed": result["all_passed"],
                "errors": norm_errors(result["errors"]),
                "candidate_results": [
                    {
                        "id": item["id"],
                        "passed": item["passed"],
                        "errors": norm_errors(item["errors"]),
                    }
                    for item in result["candidate_results"]
                ],
                "business_data_verification": result["business_data_verification"],
            }
        )

    payload = {
        "reference": "python: workflow/intake.py + validator/rules.py",
        "python_version": sys.version.split()[0],
        "intake_results": intake_out,
        "validation_results": validate_out,
    }
    out = WORKDIR / "python-out.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"已写出 {out}")
    print(f"  intake 参考结果 {len(intake_out)} 条；校验参考结果 {len(validate_out)} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
