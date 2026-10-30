"""归档真实模型调用证据：SSE 原文、节点 I/O 附录、摘要表。"""
import json
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
import sys
TMP = INPUTS
PARSED = sys.argv[1] if len(sys.argv) > 1 else "run-real-parsed2.json"
RAWOUT = sys.argv[2] if len(sys.argv) > 2 else "c6.out"
PREFIX = sys.argv[3] if len(sys.argv) > 3 else "dify-real"
OUT = _SELF.parent

ORDER = ["用户输入", "N1 用户输入与确定性适配", "N2 需求分析与三候选（真实 LLM）",
         "N3 Code 首次校验", "N4 校验结果分支", "N5 一次修订（真实 LLM）", "N6 Code 再校验",
         "N7a 未修订报告", "N7b 修订后报告", "End A 未修订输出", "End B 修订后输出"]


def node_io_md(rec):
    lines = [f"# 节点级输入输出原文（真实模型调用） · {rec['label']}", "",
             f"- 发起时间（UTC）：`{rec['startedAtLocal']}`",
             f"- HTTP：`{rec['httpStatus']}`　端到端：`{rec['elapsedMs']} ms`",
             f"- 预期：{rec['expect']}", "",
             "> 数据来源：`POST /console/api/apps/5abdb13c-a633-4a9c-96c3-dabd44072511/workflows/draft/run` 的 SSE 原文。",
             "> N2 / N5 为真实 LLM 节点（provider `langgenius/deepseek/deepseek`，model `deepseek-v4-flash`，",
             "> `thinking=false`、`response_format=json_object`、`max_tokens=16384`、`temperature=0.2`）。", ""]
    for title in ORDER:
        fins = [e for e in rec["events"] if e["event"] == "node_finished" and e["node"] == title]
        if not fins:
            continue
        lines += [f"## {title}", ""]
        for f in fins:
            lines.append(f"- 节点 ID：`{f['node_id']}`　状态：`{f['status']}`　耗时：`{f.get('elapsed')} s`　服务端时间戳：`{f.get('created_at')}`")
            lines += ["", "**输入**", "", "```json",
                      json.dumps(f.get("inputs"), ensure_ascii=False, indent=2), "```",
                      "", "**输出**", "", "```json",
                      json.dumps(f.get("outputs"), ensure_ascii=False, indent=2), "```", ""]
            if f.get("error"):
                lines += ["**错误**", "", "```json", json.dumps(f["error"], ensure_ascii=False, indent=2), "```", ""]
    lines += ["## 工作流级输出（workflow_finished）", "", "```json",
              json.dumps(rec.get("workflow"), ensure_ascii=False, indent=2), "```", ""]
    return "\n".join(lines)


def main():
    recs = json.loads((TMP / PARSED).read_text(encoding="utf-8"))
    (OUT / f"{PREFIX}-run-node-events.json").write_text(
        json.dumps(recs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    step = sys.argv[4] if len(sys.argv) > 4 else "run-real"
    raw = [json.loads(l) for l in (TMP / RAWOUT).read_text(encoding="utf-8", errors="replace").splitlines() if l.strip().startswith("{")]
    runs = []
    for e in raw:
        if e.get("step") == step and isinstance(e.get("value"), dict) and e["value"].get("runs"):
            runs.extend(e["value"]["runs"])
    if not runs:
        # 兜底：不静默产出空文件——按 runs 结构匹配，并明确报告实际用的是哪个 step。
        for e in raw:
            if isinstance(e.get("value"), dict) and e["value"].get("runs"):
                runs.extend(e["value"]["runs"])
                print(f"  注意：按 step='{step}' 未命中，已按 runs 结构兜底匹配到 step='{e.get('step')}'")
    if not runs:
        raise SystemExit(f"!! 在 {RAWOUT} 中找不到任何 runs（step='{step}'）：拒绝写出 0 字节证据文件")
    with (OUT / f"{PREFIX}-run-sse-raw.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for r in runs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {PREFIX}-run-sse-raw.jsonl（{len(runs)} 个用例，step={step}）")

    def get(rec, t):
        for ev in rec["events"]:
            if ev["event"] == "node_finished" and ev["node"] == t:
                return ev
        return None

    summary = []
    for rec in recs:
        n2, n3, n5, n6 = (get(rec, x) for x in ("N2 需求分析与三候选（真实 LLM）", "N3 Code 首次校验",
                                                "N5 一次修订（真实 LLM）", "N6 Code 再校验"))
        v3 = json.loads(n3["outputs"]["validation_json"]) if n3 else {}
        env6 = json.loads(n6["outputs"]["envelope_json"]) if n6 else {}
        v6 = env6.get("validation", {})
        wf = rec.get("workflow") or {}
        ow = wf.get("outputs") or {}
        rj = json.loads(ow.get("report_json") or "{}")
        summary.append({
            "case": rec["label"], "expect": rec["expect"], "startedAtUtc": rec["startedAtLocal"],
            "httpStatus": rec["httpStatus"], "browserElapsedMs": rec["elapsedMs"],
            "N2_raw_text_chars": len((n2["outputs"].get("text") or "")) if n2 else None,
            "N2_elapsed_s": n2.get("elapsed") if n2 else None,
            "N3_status": v3.get("status"), "N3_all_passed": v3.get("all_passed"),
            "N3_codes": sorted({e["code"] for e in v3.get("errors", [])} |
                               {e["code"] for c in v3.get("candidate_results", []) for e in c["errors"]}),
            "N3_per_candidate": [{"id": c["id"], "passed": c["passed"],
                                  "errors": [e["code"] for e in c["errors"]]} for c in v3.get("candidate_results", [])],
            "N3_preserved": sorted(json.loads(n3["outputs"]["preserved_candidates_json"]).keys()) if n3 else None,
            "N4_case": (get(rec, "N4 校验结果分支") or {}).get("outputs", {}).get("selected_case_id"),
            "N5_ran": bool(n5), "N5_elapsed_s": n5.get("elapsed") if n5 else None,
            "N5_raw_text_chars": len((n5["outputs"].get("text") or "")) if n5 else None,
            "N6_status": v6.get("status"), "N6_all_passed": v6.get("all_passed"),
            "N6_per_candidate": [{"id": c["id"], "passed": c["passed"],
                                  "errors": [e["code"] for e in c["errors"]]} for c in v6.get("candidate_results", [])],
            "N6_repair_count": env6.get("repair_count"),
            "workflow_status": wf.get("status"), "workflow_elapsed_s": wf.get("elapsed_time"),
            "total_tokens": wf.get("total_tokens"),
            "end_outputs": {k: ow.get(k) for k in ("status", "all_passed", "repair_count")},
            "selectable_candidate_ids": rj.get("selectable_candidate_ids"),
            "selected_candidate_id": rj.get("selected_candidate_id"),
            "candidate_names": [(c.get("id"), c.get("name"), c.get("estimated_total"), c.get("tags"))
                                for c in rj.get("candidates", [])],
        })
        (OUT / f"{PREFIX}-node-io-{rec['label']}.md").write_text(node_io_md(rec), encoding="utf-8")
        print("wrote", f"{PREFIX}-node-io-{rec['label']}.md")

    (OUT / f"{PREFIX}-run-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for s in summary:
        print("=" * 80)
        for k, v in s.items():
            print(f"  {k:26} = {json.dumps(v, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
