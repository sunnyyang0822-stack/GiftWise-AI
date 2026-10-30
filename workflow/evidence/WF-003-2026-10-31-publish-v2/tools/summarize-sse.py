#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 Dify SSE 原始输出解析成 node-events 与 summary（与 WF-003-2026-10-30 归档同格式）。

用法：
    python -X utf8 summarize-sse.py <sse文件> <case 名> [<输出前缀>]

例：
    python -X utf8 tools/summarize-sse.py v2-run1-demo-sse-raw.jsonl demo_forbidden_term_chocolate v2-run1-demo

读的是浏览器运行器抓到的 text/event-stream 原文（`event: ping` / `data: {...}` 交替）。
不调用任何模型，纯离线解析。
"""
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def parse_sse(text: str):
    """返回 (events, other, workflow)。"""
    events, other, workflow = [], [], None
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        body = line[5:].strip()
        if not body or body == "[DONE]":
            continue
        try:
            j = json.loads(body)
        except Exception:
            continue
        ev = j.get("event")
        if ev == "workflow_finished":
            workflow = j.get("data") or {}
            continue
        if ev in ("node_started", "node_finished", "node_failed"):
            d = j.get("data") or {}
            events.append({
                "event": ev,
                "node": d.get("title"),
                "node_id": d.get("node_id"),
                "node_type": d.get("node_type"),
                "inputs": d.get("inputs"),
                "outputs": d.get("outputs"),
                "elapsed": d.get("elapsed_time"),
                "status": d.get("status"),
                "created_at": d.get("created_at"),
                "error": d.get("error"),
            })
        else:
            other.append({"event": ev, "data": j.get("data")})
    return events, other, workflow


def outs(events, title_prefix):
    for e in events:
        if e["event"] == "node_finished" and (e.get("node") or "").startswith(title_prefix):
            return e
    return None


def jload(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    sse_path = Path(sys.argv[1])
    case = sys.argv[2]
    prefix = sys.argv[3] if len(sys.argv) > 3 else sse_path.stem
    text = sse_path.read_text(encoding="utf-8")
    events, other, workflow = parse_sse(text)

    # 节点序列
    seq = [(e["node"], e["elapsed"], e["status"]) for e in events if e["event"] == "node_finished"]

    n1 = outs(events, "N1 ")
    n2 = outs(events, "N2 ")
    n3 = outs(events, "N3 ")
    n4 = outs(events, "N4 ")
    n5 = outs(events, "N5 ")
    n6 = outs(events, "N6 ")
    vj = jload((n3 or {}).get("outputs", {}).get("validation_json") if n3 else None) or {}
    rj = jload((workflow or {}).get("outputs", {}).get("report_json")) or {}

    # 请求侧错误（越界输入的关键证据）
    n1_errors = jload((n1 or {}).get("outputs", {}).get("errors_json") if n1 else None)

    summary = {
        "case": case,
        "httpStatus": 200 if workflow else None,
        "contentType": "text/event-stream; charset=utf-8",
        "nodeSequence": [{"node": a, "elapsed_s": b, "status": c} for a, b, c in seq],
        "N1_status": ((n1 or {}).get("outputs") or {}).get("status"),
        "N1_errors": n1_errors,
        "N2_raw_text_chars": len(((n2 or {}).get("outputs") or {}).get("text") or ""),
        "N2_elapsed_s": (n2 or {}).get("elapsed"),
        "N2_usage": ((n2 or {}).get("outputs") or {}).get("usage"),
        "N2_forbidden_term_hits": (((n2 or {}).get("outputs") or {}).get("text") or "").count("巧克力"),
        "N3_status": vj.get("status"),
        "N3_all_passed": vj.get("all_passed"),
        "N3_codes": [e.get("code") for e in (vj.get("errors") or [])],
        "N3_per_candidate": vj.get("candidate_results"),
        "N3_preserved": sorted((jload((n3 or {}).get("outputs", {}).get("preserved_candidates_json")) or {}).keys()) if n3 else [],
        "N4_case": ((n4 or {}).get("outputs") or {}).get("result"),
        "N5_ran": bool(n5),
        "N5_elapsed_s": (n5 or {}).get("elapsed"),
        "N6_status": (((n6 or {}).get("outputs") or {}).get("validation_json") and jload((n6 or {}).get("outputs", {}).get("validation_json"), ) or {}).get("status") if n6 else None,
        "workflow_status": (workflow or {}).get("status"),
        "workflow_elapsed_s": (workflow or {}).get("elapsed_time"),
        "total_tokens": (workflow or {}).get("total_tokens"),
        "end_outputs": {k: (workflow or {}).get("outputs", {}).get(k) for k in ("status", "all_passed", "repair_count")},
        "selectable_candidate_ids": rj.get("selectable_candidate_ids"),
        "selected_candidate_id": rj.get("selected_candidate_id"),
        "candidate_names": [[c.get("id"), c.get("name"), c.get("estimated_total"), c.get("tags")] for c in (rj.get("candidates") or [])],
        "workflow_errors": rj.get("workflow_errors"),
    }

    node_events = [{
        "label": case, "httpStatus": summary["httpStatus"], "contentType": summary["contentType"],
        "elapsedMs": int(((workflow or {}).get("elapsed_time") or 0) * 1000),
        "startedAtLocal": None, "events": events, "other": other, "workflow": workflow,
    }]

    out_ev = Path(prefix + "-node-events.json")
    out_sm = Path(prefix + "-summary.json")
    out_ev.write_text(json.dumps(node_events, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    out_sm.write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("wrote", out_ev, out_ev.stat().st_size, "bytes")
    print("wrote", out_sm, out_sm.stat().st_size, "bytes")
    print("  节点序列:", " -> ".join(a for a, _, _ in seq))
    print("  N1_errors =", json.dumps(summary["N1_errors"], ensure_ascii=False))
    print("  N3 status =", summary["N3_status"], "| preserved =", summary["N3_preserved"])
    print("  tokens    =", summary["total_tokens"])


if __name__ == "__main__":
    main()
