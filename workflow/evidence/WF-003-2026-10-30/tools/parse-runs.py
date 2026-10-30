"""解析 Dify 草稿运行 SSE，输出节点级与工作流级原文证据。"""
import json
import sys
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
TMP = INPUTS


def parse_sse(text):
    events = []
    for block in text.split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if not payload:
                    continue
                try:
                    events.append(json.loads(payload))
                except ValueError:
                    events.append({"event": "unparsed", "raw": payload[:200]})
    return events


def title_map():
    graph = json.loads((TMP / "graph.json").read_text(encoding="utf-8"))
    return {n["id"]: n["data"].get("title") for n in graph["nodes"]}


def main():
    src = Path(sys.argv[1])
    step_name = sys.argv[2] if len(sys.argv) > 2 else "run-five-cases"
    out_name = sys.argv[3] if len(sys.argv) > 3 else "run-parsed.json"
    report = []
    for line in src.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        e = json.loads(line)
        if e.get("step") != step_name:
            continue
        titles = title_map()
        for run in e["value"]["runs"]:
            events = parse_sse(run.get("sse") or "")
            rec = {"label": run["label"], "expect": run["expect"], "httpStatus": run["httpStatus"],
                   "contentType": run["contentType"], "elapsedMs": run["elapsedMs"],
                   "startedAtLocal": run["startedAtLocal"], "events": []}
            for ev in events:
                name = ev.get("event")
                d = ev.get("data") or {}
                if name == "node_started":
                    rec["events"].append({"event": name, "node": d.get("title"), "node_id": d.get("node_id"),
                                          "inputs": d.get("inputs"), "created_at": d.get("created_at")})
                elif name == "node_finished":
                    rec["events"].append({"event": name, "node": d.get("title"), "node_id": d.get("node_id"),
                                          "status": d.get("status"), "inputs": d.get("inputs"),
                                          "outputs": d.get("outputs"), "elapsed": d.get("elapsed_time"),
                                          "error": d.get("error"), "created_at": d.get("created_at")})
                elif name == "workflow_finished":
                    rec["workflow"] = {"status": d.get("status"), "outputs": d.get("outputs"),
                                       "elapsed_time": d.get("elapsed_time"), "total_tokens": d.get("total_tokens"),
                                       "error": d.get("error"), "created_at": d.get("created_at")}
                elif name in ("workflow_started", "message", "ping", "text_chunk"):
                    rec.setdefault("other", []).append({"event": name, "created_at": d.get("created_at")})
                else:
                    rec["events"].append({"event": name, "raw": json.dumps(ev, ensure_ascii=False)[:300]})
            report.append(rec)
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / out_name).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for rec in report:
        print("=" * 100)
        print(f"CASE {rec['label']} @ {rec['startedAtLocal']}  http={rec['httpStatus']}  {rec['elapsedMs']}ms")
        print(f"expect: {rec['expect']}")
        for ev in rec["events"]:
            if ev["event"] == "node_started":
                print(f"  [started] {ev['node']} ({ev['node_id']}) inputs={json.dumps(ev.get('inputs'), ensure_ascii=False)[:200]}")
            elif ev["event"] == "node_finished":
                print(f"  [finished] {ev['node']} ({ev['node_id']}) status={ev['status']} {ev.get('elapsed')}s")
                print(f"      inputs = {json.dumps(ev.get('inputs'), ensure_ascii=False)[:400]}")
                print(f"      outputs = {json.dumps(ev.get('outputs'), ensure_ascii=False)[:1400]}")
                if ev.get("error"):
                    print(f"      error = {json.dumps(ev['error'], ensure_ascii=False)[:400]}")
            else:
                print(f"  [{ev['event']}] {json.dumps(ev, ensure_ascii=False)[:300]}")
        wf = rec.get("workflow")
        print("  WORKFLOW FINISHED:", json.dumps(wf, ensure_ascii=False)[:2500] if wf else "（无 workflow_finished 事件）")


if __name__ == "__main__":
    main()
