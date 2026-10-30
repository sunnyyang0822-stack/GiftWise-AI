"""现场演示的零模型调用验证。

直接调用与 Dify 节点完全相同的三个专用入口（同一份生成代码、同一入口函数）：
  intake_node.main(intake_json)                        -> N1
  check_node.main(request_json, candidates_json, 0)    -> N3
  report_node.main(state_json)                         -> N7

  A) 评委指定禁忌词「巧克力」+ 含该词的候选 → 期望 FORBIDDEN_TERM，且该候选不可选
  B) 同一请求 + 不含该词的候选              → 期望全通过，三项可选，selected=null

不访问网络、不调用任何模型。0 Token。
"""
import importlib.util
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
sys.path.insert(0, str(ROOT))
GEN = ROOT / "workflow/generated"


def entry(name):
    """加载生成节点，返回其最后定义的 main（即 Dify 实际调用的入口）。"""
    spec = importlib.util.spec_from_file_location("gen_" + name, GEN / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.main


def main():
    intake_entry = entry("intake_node")
    check_entry = entry("check_node")
    report_entry = entry("report_node")

    intake = json.loads((ROOT / "workflow/examples/demo-intake-judge-forbidden-term.json").read_text(encoding="utf-8"))
    violating = json.loads((ROOT / "workflow/examples/demo-candidates-violating.json").read_text(encoding="utf-8"))
    clean = json.loads((ROOT / "workflow/examples/demo-candidates-clean.json").read_text(encoding="utf-8"))

    # --- N1 ---
    n1 = intake_entry(json.dumps(intake, ensure_ascii=False))
    request_json = n1["request_json"]
    request = json.loads(request_json)
    print("=" * 78)
    print("N1 用户输入与确定性适配  (intake_node.main)")
    print("  status             =", n1["status"])
    print("  errors_json        =", n1["errors_json"])
    print("  recipient_relation =", request.get("recipient_relation"), "/ id =", request.get("recipient_relation_id"))
    print("  forbidden_terms    =", json.dumps(request.get("forbidden_terms"), ensure_ascii=False), "  <- 评委指定的禁忌词")
    print("  forbidden_tags     =", json.dumps(request.get("forbidden_tags"), ensure_ascii=False))
    print("  budget/currency    =", request.get("budget_amount"), request.get("currency"), "/ available_days =", request.get("available_days"))
    print("  facts              =", json.dumps(request.get("facts"), ensure_ascii=False))

    results = {}
    for label, cand, note in (
        ("B 合规候选（对照组）", clean, "三个候选文本都不含「巧克力」"),
        ("A 违规候选（演示组）", violating, "c2 的 description 含「巧克力」"),
    ):
        ck = check_entry(request_json, json.dumps(cand, ensure_ascii=False), 0)
        validation = json.loads(ck["validation_json"])
        rp = report_entry(ck["envelope_json"])
        envelope = json.loads(rp["envelope_json"])
        print("=" * 78)
        print(label, "——", note)
        print("  N3 status =", ck["status"], " all_passed =", ck["all_passed"],
              " repairable =", ck["repairable"], " repair_count =", ck["repair_count"])
        for c in validation["candidate_results"]:
            codes = [e["code"] for e in c["errors"]]
            print("     %-3s passed=%-5s errors=%s" % (c["id"], c["passed"], json.dumps(codes, ensure_ascii=False)))
        for e in validation["errors"]:
            print("     batch error:", e["code"], "-", e["message"])
        for c in validation["candidate_results"]:
            for e in c["errors"]:
                print("     ->", c["id"], e["code"], "@", e["path"])
        print("  N7 status =", rp["status"], " all_passed =", rp["all_passed"])
        print("  selectable =", json.dumps(envelope.get("selectable_candidate_ids"), ensure_ascii=False),
              " selected =", envelope.get("selected_candidate_id"))
        print("  report_text 首行 =", (rp.get("report_text") or "").splitlines()[0])
        if ck["repairable"]:
            print("  注意：N3 repairable=True —— 真实工作流此时会先做一次 N5 修订（需 1 次模型调用）；")
            print("        本脚本不调用模型，故直接展示 N3 判定对应的「未修订报告」N7a，不代表修订后的结果。")
        results[label] = {
            "check_status": ck["status"], "all_passed": ck["all_passed"], "repairable": ck["repairable"],
            "per_candidate": {c["id"]: {"passed": c["passed"],
                                        "errors": [{"code": e["code"], "path": e["path"]} for e in c["errors"]]}
                              for c in validation["candidate_results"]},
            "selectable": envelope.get("selectable_candidate_ids"),
            "selected": envelope.get("selected_candidate_id"),
            "report_text": rp.get("report_text"),
        }

    a = results["A 违规候选（演示组）"]
    b = results["B 合规候选（对照组）"]
    ok = (a["per_candidate"]["c2"]["errors"][0]["code"] == "FORBIDDEN_TERM"
          and a["per_candidate"]["c1"]["passed"] and a["per_candidate"]["c3"]["passed"]
          and a["selected"] is None and b["all_passed"] is True and b["selected"] is None)
    out = ROOT / "workflow/evidence/WF-003-2026-10-30/demo-local-verify-output.json"
    out.write_text(json.dumps({
        "_note": "零模型调用：直接调用 workflow/generated/ 下与 Dify 节点相同的入口函数。0 Token。"
                 "本脚本只跑到 N3 判定与 N7a 报告；真实工作流在 repairable=true 时会先执行一次 N5 修订（需模型调用），"
                 "故此处不能代替「修订后通过」的证据，后者见 dify-real-run-summary.json。",
        "intake": intake, "n1_request": request, "results": results,
        "assertion_passed": bool(ok)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("=" * 78)
    print("断言（违规项被 FORBIDDEN_TERM 拒绝 / 合规项通过 / 两者 selected 均为 null）：",
          "通过" if ok else "未通过")
    print("已写入", out.relative_to(ROOT))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
