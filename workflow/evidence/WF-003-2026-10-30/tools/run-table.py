"""把 run-parsed.json 压成可核对的对照表（含校验错误码与分支路径）。"""
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


_TITLES = [n["data"]["title"] for n in json.loads((TMP / "graph.json").read_text(encoding="utf-8"))["nodes"]]


def T(prefix):
    """按 graph.json 里的真实节点标题取全名（兼容占位期与真实 LLM 期的不同标题）。"""
    for title in _TITLES:
        if title.startswith(prefix):
            return title
    return prefix


def load():
    return json.loads((TMP / "run-demo-parsed.json").read_text(encoding="utf-8"))


def outs(rec, node_title):
    for ev in rec["events"]:
        if ev["event"] == "node_finished" and ev["node"] == node_title:
            return ev
    return None


def codes(validation):
    out = []
    for e in validation.get("errors", []):
        out.append(e["code"])
    for r in validation.get("candidate_results", []):
        for e in r["errors"]:
            out.append(e["code"])
    return sorted(set(out))


def main():
    rows = []
    for rec in load():
        n3 = outs(rec, "N3 Code 首次校验")
        n4 = outs(rec, "N4 校验结果分支")
        n5 = outs(rec, T("N5 "))
        n6 = outs(rec, "N6 Code 再校验")
        n7a = outs(rec, "N7a 未修订报告")
        n7b = outs(rec, "N7b 修订后报告")
        enda = outs(rec, "End A 未修订输出")
        endb = outs(rec, "End B 修订后输出")
        n3v = json.loads(n3["outputs"]["validation_json"]) if n3 else {}
        path = "N3"
        if n4:
            path += " -> N4[" + str(n4["outputs"]["selected_case_id"]) + "]"
        if n5:
            path += " -> N5"
        if n6:
            path += " -> N6"
        if n7a:
            path += " -> N7a"
        if n7b:
            path += " -> N7b"
        if enda:
            path += " -> EndA"
        if endb:
            path += " -> EndB"
        row = {
            "case": rec["label"],
            "at": rec["startedAtLocal"],
            "http": rec["httpStatus"],
            "elapsedMs": rec["elapsedMs"],
            "path": path,
            "N1_status": (outs(rec, "N1 用户输入与确定性适配") or {}).get("outputs", {}).get("status"),
            "N2_status": (outs(rec, T("N2 ")) or {}).get("outputs", {}).get("status"),
            "N2_model_called": (outs(rec, T("N2 ")) or {}).get("outputs", {}).get("model_called"),
            # 真实 LLM 节点的 outputs 是 text/reasoning_content/usage/finish_reason，
            # 没有占位期 Code 节点的 status/model_called，故上面两行对真实运行恒为 null；
            # 真实运行请看下面三行。
            "N2_elapsed_s": (outs(rec, T("N2 ")) or {}).get("elapsed"),
            "N2_text_chars": len(((outs(rec, T("N2 ")) or {}).get("outputs") or {}).get("text") or ""),
            "N2_total_tokens": (((outs(rec, T("N2 ")) or {}).get("outputs") or {}).get("usage") or {}).get("total_tokens"),
            "N3_validation_status": n3v.get("status"),
            "N3_all_passed": n3v.get("all_passed"),
            "N3_codes": codes(n3v),
            "N3_repairable": n3["outputs"]["repairable"] if n3 else None,
            "N3_repair_count": n3["outputs"]["repair_count"] if n3 else None,
            "N3_preserved": sorted(json.loads(n3["outputs"]["preserved_candidates_json"]).keys()) if n3 else None,
            "N4_case": n4["outputs"]["selected_case_id"] if n4 else None,
            "N5_ran": bool(n5),
            "N6_all_passed": n6["outputs"]["all_passed"] if n6 else None,
            "N6_repairable": n6["outputs"]["repairable"] if n6 else None,
            "N6_repair_count": n6["outputs"]["repair_count"] if n6 else None,
            "workflow_status": (rec.get("workflow") or {}).get("status"),
            "wf_outputs": {k: (rec.get("workflow") or {}).get("outputs", {}).get(k)
                           for k in ("status", "all_passed", "repair_count")} if rec.get("workflow") else None,
            "wf_selected_candidate_id": json.loads((rec.get("workflow") or {}).get("outputs", {}).get("report_json") or "{}").get("selected_candidate_id") if rec.get("workflow") and (rec["workflow"].get("outputs") or {}).get("report_json") else None,
            "wf_selectable": json.loads((rec.get("workflow") or {}).get("outputs", {}).get("report_json") or "{}").get("selectable_candidate_ids") if rec.get("workflow") and (rec["workflow"].get("outputs") or {}).get("report_json") else None,
            "wf_total_tokens": (rec.get("workflow") or {}).get("total_tokens"),
            "wf_error": (rec.get("workflow") or {}).get("error"),
        }
        rows.append(row)
    OUTDIR.mkdir(parents=True, exist_ok=True)
    (OUTDIR / "run-table.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    keys = ["case", "http", "elapsedMs", "path", "N1_status", "N2_status", "N2_model_called",
            "N2_elapsed_s", "N2_text_chars", "N2_total_tokens",
            "N3_validation_status", "N3_all_passed", "N3_codes", "N3_repairable", "N3_preserved",
            "N4_case", "N6_all_passed", "N6_repairable", "N6_repair_count",
            "workflow_status", "wf_outputs", "wf_selectable", "wf_selected_candidate_id",
            "wf_total_tokens", "wf_error"]
    for r in rows:
        print("=" * 90)
        for k in keys:
            print(f"  {k:26} = {json.dumps(r[k], ensure_ascii=False)}")


if __name__ == "__main__":
    main()
