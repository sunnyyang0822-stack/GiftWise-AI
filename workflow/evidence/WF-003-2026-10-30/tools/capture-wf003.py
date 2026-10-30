import json, sys, datetime
from pathlib import Path
import os as _os
_ROOT_PROBE = Path(__file__).resolve().parent
while not (_ROOT_PROBE / "workflow" / "verify_local.py").exists():
    if _ROOT_PROBE.parent == _ROOT_PROBE:
        raise RuntimeError("找不到仓库根目录（未找到 workflow/verify_local.py）")
    _ROOT_PROBE = _ROOT_PROBE.parent
ROOT = _ROOT_PROBE
_SELF = Path(__file__).resolve().parent
INPUTS = Path(_os.environ["WF003_INPUTS"]) if _os.environ.get("WF003_INPUTS") else _SELF / "inputs"
BUILD = _SELF / "build"
OUTDIR = _SELF / "outputs"
# ↑ 本文件是 workflow/tools/<同名>.py 的可入库副本，由 workflow/tools/gen-includable-tools.py 生成。
sys.path.insert(0, str(ROOT))
from workflow.intake import adapt_intake, dump
from workflow.runtime import check, report
from workflow.build_code_node import build

OUT = ROOT / "workflow/evidence/local-2026-10-30"
OUT.mkdir(parents=True, exist_ok=True)
ts = lambda: datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec="seconds")
log = []
def emit(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log.append((name, ts()))

for fn, label in (("intake.json", "pursuit-main"), ("intake-colleague.json", "colleague-regression")):
    raw = (ROOT / "workflow/examples" / fn).read_text(encoding="utf-8")
    res = adapt_intake(raw)
    emit(f"intake-{label}.json", {"captured_at": ts(), "command": "python workflow/tools/capture-wf003.py",
                                  "input_file": f"workflow/examples/{fn}", "input": json.loads(raw), "adapt_intake": res})
    print(f"--- {fn} @ {ts()} ---")
    print("status =", res["status"], "| errors =", json.dumps(res["errors"], ensure_ascii=False))
    print("request_json =", res["request_json"])

# 校验 + 报告：追求对象主场景
raw = (ROOT / "workflow/examples/intake.json").read_text(encoding="utf-8")
request_json = adapt_intake(raw)["request_json"]
candidates = (ROOT / "workflow/examples/candidates.json").read_text(encoding="utf-8")
state = check(request_json, candidates, 0)
rep = report(state)
emit("check-and-report-pursuit.json", {"captured_at": ts(), "check": state, "report": rep})
print("--- check/report pursuit @", ts(), "---")
print("all_passed =", state["validation"]["all_passed"], "| repairable =", state["repairable"], "| repair_count =", state["repair_count"])
print("selectable =", rep["selectable_candidate_ids"], "| selected_candidate_id =", rep["selected_candidate_id"])
print("report_text =\n" + rep["report_text"])

# 生成物清单
code, manifest = build()
emit("manifest.json", {"captured_at": ts(), "manifest": manifest})
print("--- manifest @", ts(), "---")
print(json.dumps(manifest, ensure_ascii=False, indent=2))
print("--- files ---")
for f in sorted(OUT.glob("*.json")):
    print(f.name, f.stat().st_size)
print("--- log ---")
print(json.dumps(log, ensure_ascii=False))
