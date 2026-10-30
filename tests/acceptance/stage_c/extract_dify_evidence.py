"""QA-001：把 Dify 浏览器实跑的原始日志规范化为可断言的证据文件。

输入：docs/test-reports/stage-c/evidence/qa-runner-log.jsonl（dify-qa-runner.cjs 逐步骤追加）
输出：docs/test-reports/stage-c/evidence/dify-run-evidence.json

只做机械提取，不修改任何数值；缺失字段如实写 null，不补默认值。
用法：
    python tests/acceptance/stage_c/extract_dify_evidence.py
"""

import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
EVIDENCE = os.path.join(REPO, "docs", "test-reports", "stage-c", "evidence")
LOG = os.path.join(EVIDENCE, "qa-runner-log.jsonl")
OUT = os.path.join(EVIDENCE, "dify-run-evidence.json")
APP_ID = "5abdb13c-a633-4a9c-96c3-dabd44072511"


def load_records():
    records = []
    if not os.path.exists(LOG):
        return records
    with open(LOG, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except ValueError:
                continue
    return records


def find(records, step):
    """返回最后一个匹配 step 的记录。"""
    hits = [r for r in records if r.get("step") == step]
    return hits[-1] if hits else None


def parse_sse(body):
    """解析 Dify 测试运行的 SSE 事件流为结构化节点轨迹。"""
    events = []
    for chunk in body.split("\n\n"):
        data = None
        for line in chunk.split("\n"):
            if line.startswith("data: "):
                data = line[len("data: "):]
        if not data:
            continue
        try:
            events.append(json.loads(data))
        except ValueError:
            continue
    nodes = []
    for ev in events:
        if ev.get("event") == "node_finished":
            d = ev.get("data", {})
            nodes.append({
                "node_id": d.get("node_id"),
                "node_type": d.get("node_type"),
                "title": d.get("title"),
                "status": d.get("status"),
                "error": d.get("error"),
                "elapsed_time": d.get("elapsed_time"),
                "outputs": d.get("outputs"),
                "inputs": d.get("inputs"),
                "process_data": d.get("process_data"),
            })
    started = next((e for e in events if e.get("event") == "workflow_started"), None)
    finished = next((e for e in events if e.get("event") == "workflow_finished"), None)
    return {
        "event_names": [e.get("event") for e in events],
        "workflow_run_id": (started or {}).get("workflow_run_id"),
        "workflow_started_inputs": ((started or {}).get("data") or {}).get("inputs"),
        "workflow_finished_status": ((finished or {}).get("data") or {}).get("status"),
        "workflow_finished_outputs": ((finished or {}).get("data") or {}).get("outputs"),
        "workflow_finished_error": ((finished or {}).get("data") or {}).get("error"),
        "workflow_elapsed_time": ((finished or {}).get("data") or {}).get("elapsed_time"),
        "total_tokens": ((finished or {}).get("data") or {}).get("total_tokens"),
        "total_steps": ((finished or {}).get("data") or {}).get("total_steps"),
        "exceptions_count": ((finished or {}).get("data") or {}).get("exceptions_count"),
        "nodes": nodes,
    }


def main():
    records = load_records()
    if not records:
        print("no runner log at", LOG, file=sys.stderr)
        return 1

    draft_before = find(records, "04-draft-before") or find(records, "03-draft-server-read-BEFORE-RUN")
    draft_after = find(records, "11-draft-after") or find(records, "16-draft-server-read-AFTER-RUN")
    capture = find(records, "08-read-captured-bodies") or find(records, "08-run-and-traces")

    out = {
        "app_id": APP_ID,
        "evidence_source": "独立 QA 浏览器会话（workflow/tools/dify-browser-profile-chrome）；非 PM 数据",
        "raw_log": "docs/test-reports/stage-c/evidence/qa-runner-log.jsonl",
        "dify_version": None,
        "draft_before_run": None,
        "draft_after_run": None,
        "run_sse": None,
        "trace_runs": None,
        "node_last_run": None,
        "traffic": None,
        "notes": [],
    }

    for key, rec in (("draft_before_run", draft_before), ("draft_after_run", draft_after)):
        if not rec:
            continue
        v = rec.get("value") or {}
        out[key] = {
            "httpStatus": v.get("httpStatus"),
            "updatedAt": v.get("updatedAt"),
            "updatedAtLocal": v.get("updatedAtLocal"),
            "toolPublished": v.get("toolPublished"),
            "nodeCount": v.get("nodeCount"),
            "edgeCount": v.get("edgeCount"),
            "hasEndNode": v.get("hasEndNode"),
            "nodeSummary": v.get("nodeSummary"),
            "codeNode": next((n for n in (v.get("nodes") or []) if n.get("type") == "code"), None),
        }

    if capture:
        v = capture.get("value") or {}
        caps = v.get("captures") or v.get("traces") or []
        for c in caps:
            url = c.get("url") or ""
            body = c.get("body") or ""
            if "/workflows/draft/run" in url:
                out["run_sse"] = {"url": url, "status": c.get("status"), "at": c.get("at"), "parsed": parse_sse(body)}
            elif "/trace-runs/" in url:
                try:
                    out["trace_runs"] = {"url": url, "status": c.get("status"), "at": c.get("at"), "body": json.loads(body)}
                except ValueError:
                    out["trace_runs"] = {"url": url, "status": c.get("status"), "body_raw": body}
            elif "/last-run" in url:
                try:
                    out["node_last_run"] = {"url": url, "status": c.get("status"), "at": c.get("at"), "body": json.loads(body)}
                except ValueError:
                    out["node_last_run"] = {"url": url, "status": c.get("status"), "body_raw": body}
            if url and "/console/api/version" in url:
                out["dify_version"] = {"url": url, "status": c.get("status"), "body_raw": body}
        if not out["dify_version"]:
            for r in records:
                val = r.get("value") or {}
                if isinstance(val, dict) and val.get("version"):
                    out["dify_version"] = {"status": val["version"].get("status"), "body_raw": val["version"].get("body")}
                    break

    traffic = find(records, "12-traffic") or find(records, "17-traffic")
    if traffic:
        out["traffic"] = {
            "responses": [{k: r.get(k) for k in ("url", "status", "method", "at")} for r in traffic.get("traffic", [])],
            "runRequests": traffic.get("runRequests"),
        }

    last_run_dom = find(records, "09-last-run-dom") or find(records, "14-last-run-read")
    if last_run_dom:
        panels = ((last_run_dom.get("value") or {}).get("panels")) or []
        out["node_last_run_panel_text"] = panels[0].get("text") if panels else None

    # 机械断言：只根据实际捕获内容得出
    checks = {}
    run = out["run_sse"]["parsed"] if out.get("run_sse") else None
    before = out.get("draft_before_run") or {}
    code_node = before.get("codeNode") or {}
    checks["draft_http_200"] = before.get("httpStatus") == 200
    checks["draft_unpublished"] = before.get("toolPublished") is False
    checks["two_nodes_one_edge"] = before.get("nodeCount") == 2 and before.get("edgeCount") == 1
    checks["no_end_node"] = before.get("hasEndNode") is False
    checks["code_node_variables_empty"] = code_node.get("variables") == []
    checks["code_node_code_453_chars"] = code_node.get("codeLen") == 453
    checks["code_node_first_line_no_indent"] = code_node.get("codeFirstLineRepr") == '"def main():"'
    if run:
        code_fin = next((n for n in run["nodes"] if n["node_type"] == "code"), None)
        checks["workflow_succeeded"] = run["workflow_finished_status"] == "succeeded"
        checks["code_node_succeeded"] = bool(code_fin) and code_fin["status"] == "succeeded"
        checks["code_node_error_null"] = bool(code_fin) and code_fin["error"] is None
        checks["code_node_output_compatible_true"] = bool(code_fin) and (code_fin["outputs"] or {}).get("compatible") is True
        details = (code_fin["outputs"] or {}).get("details_json") if code_fin else None
        try:
            parsed_details = json.loads(details) if isinstance(details, str) else None
        except ValueError:
            parsed_details = None
        checks["details_json_all_true"] = parsed_details == {"json": True, "re_ascii": True, "unicodedata_nfkc": True, "decimal": True}
        checks["details_json_declared_string"] = (code_node.get("outputs") or {}).get("details_json", {}).get("type") == "string"
        checks["zero_tokens"] = run["total_tokens"] == 0
        checks["no_exceptions"] = run["exceptions_count"] == 0
        checks["workflow_level_outputs_empty"] = run["workflow_finished_outputs"] == {}
    else:
        for k in ("workflow_succeeded", "code_node_succeeded", "code_node_error_null", "code_node_output_compatible_true",
                  "details_json_all_true", "details_json_declared_string", "zero_tokens", "no_exceptions",
                  "workflow_level_outputs_empty"):
            checks[k] = None
    checks["trace_not_collected"] = (out.get("trace_runs") or {}).get("body", {}).get("status") == "not_collected"
    checks["version_1_18_0"] = "1.18.0" in (out.get("dify_version") or {}).get("body_raw", "")
    out["checks"] = checks

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print("wrote", OUT)
    for k, v in checks.items():
        print(f"  {k}: {v}")
    failed = [k for k, v in checks.items() if v is not True]
    print("checks not-true:", failed if failed else "none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
