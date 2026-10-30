"""QA-001 穷举式 JS↔Python 分歧矩阵。

**设计要点（避免伪对照）**：用例表**只在 Python 侧生成一次**，同一份 JSON 文本同时送进
Python `validator.rules.validate` 与 JS `web/server/checker.mjs` 的 `validate`，
因此两侧输入逐字节相同。逐一比对 status、all_passed、错误码。

并对每条分歧**分类严重度**：
  - `接受性分歧`（一侧通过、另一侧拒绝）：**高**——用户可见的判定不一致。
  - `码/状态分歧`（两侧都拒绝，但码或 status 不同）：**中**——契约层不一致，判定结论相同。
  - `一致`。

**不修改 `web/**`**，只调用其公开导出。

运行： python tests/acceptance/boundary/run_js_grid_probe.py
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate as py_validate  # noqa: E402

OUT_JSON = ROOT / "docs/test-reports/boundary-001/evidence/js-grid-divergence.json"
OUT_TXT = ROOT / "docs/test-reports/boundary-001/evidence/js-grid-divergence.txt"

REQUEST_TMPL = (
    '{"recipient_relation":"\u670b\u53cb","recipient_relation_id":"friend",'
    '"occasion":"\u751f\u65e5","budget_amount":%(b)s,"currency":"CNY","available_days":%(d)s,'
    '"facts":[{"id":"f1","text":"x"}],"forbidden_tags":[],"forbidden_terms":[],"notes":"",'
    '"closeness":"unknown","preference_inferences":[],"gift_styles":[],'
    '"hard_exclusions_original":{"tags":[],"terms":[],"unresolved":[]}}'
)


def request(b='"200.00"', d="3"):
    return REQUEST_TMPL % {"b": b, "d": d}


def _cand(i, name, total_literal, days_literal):
    return ('{"id":"%s","name":"%s","description":"虚构方案说明","estimated_total":%s,'
            '"currency":"CNY","estimated_preparation_days":%s,"tags":["other"],'
            '"reason":"匹配用户已确认的偏好与预算上限","fact_refs":["f1"],'
            '"inferences":["可能偏好实用礼物"],"unknowns":["实际价格以商家为准"],'
            '"presentation":"简要呈现"}' % (i, name, total_literal, days_literal))


def candidates(total='"150.00"', days="1", all_totals=None, all_days=None):
    """all_totals / all_days 同时覆盖三个候选（用于"隔离"某一条规则）。"""
    totals = [all_totals if all_totals is not None else total, '"120.00"', '"80.00"']
    dayss = [all_days if all_days is not None else days, "2", "3"]
    if all_totals is not None:
        totals = [all_totals] * 3
    if all_days is not None:
        dayss = [all_days] * 3
    body = ",".join([_cand("c1", "手冲咖啡礼盒", totals[0], dayss[0]),
                     _cand("c2", "陶瓷马克杯", totals[1], dayss[1]),
                     _cand("c3", "咖啡豆订阅卡", totals[2], dayss[2])])
    return '{"candidates":[' + body + "]}"


def build_cases():
    cases = []

    def add(label, req, cand=None):
        cases.append({"label": label, "request": req, "candidates": cand or candidates()})

    # ---- 预算：完整范围网格（字符串型，两侧都应按 AMOUNT 规则解析）----
    for literal, note in [
        ('"0"', "下限以下：0"), ('"0.00"', "下限以下：0.00"), ('"0.01"', "下限以下：0.01"),
        ('"0.99"', "下限以下：0.99"), ('"1"', "下限端点"), ('"1.00"', "下限端点：1.00"),
        ('"9999.99"', "上限内"), ('"10000"', "上限端点"), ('"10000.00"', "上限端点：10000.00"),
        ('"10000.01"', "上限以上：10000.01"), ('"10001"', "上限以上：10001"),
        ('"99999"', "远超上限"), ('"100000"', "远超上限"),
        ('"' + "1" * 1000 + '"', "1000 码点（长度合规，数值巨大）"),
        ('"' + "1" * 1001 + '"', "1001 码点（触长度规则）"),
        ('"01.00"', "格式错（数值=1，在范围内）"),
        ('"-1"', "格式错（负数）"),
        ('"1e5"', "格式错（指数）"),
        ('"1,000"', "格式错（千分位，数值=1000）"),
    ]:
        add(f"预算 {literal if len(literal) < 14 else literal[:9] + '…'}（{note}）", request(b=literal))

    # ---- 预算：类型变体（JSON 非字符串）----
    for literal, note in [("20000", "JSON 数字 20000"), ("0", "JSON 数字 0"),
                          ("null", "null"), ("true", "布尔")]:
        add(f"预算 {literal}（{note}）", request(b=literal))

    # ---- 天数：范围 + 安全整数边界 ----
    for literal, note in [
        ("-1", "负数"), ("0", "下限端点 0"), ("1", "范围 1"), ("3", "常规 3"),
        ("365", "上限端点 365"), ("366", "上限以上 366"), ("1000", "远超上限 1000"),
        ("100000", "远超上限 100000"),
        ("9007199254740991", "**最大安全整数** 2^53-1（两侧都能解析）"),
        ("9007199254740992", "2^53（JS 不安全整数 → 解析期拒绝）"),
        ("100000000000000000000", "10^20（JS 不安全整数）"),
        ("0.0", "JSON float"), ("true", "JSON 布尔"), ("null", "null"),
        ("1e400", "JSON → inf"),
    ]:
        add(f"天数 {literal[:20]}（{note}）", request(d=literal))

    # ---- 组合 ----
    add("预算 0 + 天数 366（两个范围错）", request('"0"', "366"))
    add("预算 0 + 天数 -1（范围 + 类型）", request('"0"', "-1"))
    add("预算 10000 + 天数 365（双端点，须通过）", request('"10000"', "365"))
    add("预算 1 + 天数 0（双下限端点）", request('"1"', "0"))

    # ---- 候选侧（反向：JS 是否也把范围错误地下沉到候选）----
    add("候选 estimated_total='0'", request(), candidates(total='"0"'))
    add("候选 estimated_total=20000", request('"10000"'), candidates(total='"20000"'))
    add("候选 estimated_total='9'*999", request('"10000"'), candidates(total='"' + "9" * 999 + '"'))
    add("候选 estimated_total='1'*1001", request(), candidates(total='"' + "1" * 1001 + '"'))
    add("候选 prep=0", request(), candidates(days="0"))
    add("候选 prep=5000", request(), candidates(days="5000"))
    add("候选 prep=9007199254740992（不安全整数）", request(), candidates(days="9007199254740992"))

    # ---- 下限隔离：**三个**候选金额都取 "0.00"，使"候选是否超预算"不再掩盖"预算本身非法" ----
    # 若 JS 侧缺少下限校验，它会认为请求合法、且 0.00 不超任何预算 → 直接 passed。
    for b in ('"0"', '"0.00"', '"0.01"', '"0.99"'):
        add(f"【下限隔离】预算 {b} 且三个候选金额均为 \"0.00\"", request(b=b),
            candidates(all_totals='"0.00"'))
    add("【下限隔离】预算 \"0.99\" 且三个候选金额均为 \"0.00\"（天数 0）",
        request('"0.99"', "0"), candidates(all_totals='"0.00"', all_days="0"))

    # ---- 上界隔离：三个候选金额都取 "0.00"，使上界分歧不受候选超预算干扰 ----
    for b in ('"10000.01"', '"10001"'):
        add(f"【上界隔离】预算 {b} 且三个候选金额均为 \"0.00\"", request(b=b),
            candidates(all_totals='"0.00"'))
    add("【上界隔离】预算 \"10000\" 且三个候选金额均为 \"0.00\"（对照，两侧应一致）",
        request('"10000"'), candidates(all_totals='"0.00"'))

    # ---- 解析层 ----
    add("request 为空串", "")
    add("request = 'null'", "null")
    add("request 根为数组", "[]")
    return cases


def py_collect(result):
    all_errors = list(result.get("errors") or [])
    for item in result.get("candidate_results") or []:
        all_errors.extend(item.get("errors") or [])
    return {
        "status": result["status"],
        "all_passed": result["all_passed"],
        "codes": sorted({e["code"] for e in all_errors}),
        "codes_deep": sorted({f"{e['code']}@{e['path']}" for e in all_errors}),
        "candidate_passed": [c["passed"] for c in (result.get("candidate_results") or [])],
    }


def main():
    cases = build_cases()
    node_probe = ROOT / "tests/acceptance/boundary/js_grid_probe.mjs"
    proc = subprocess.run(["node", str(node_probe)], input=json.dumps({"cases": cases}),
                          capture_output=True, text=True, cwd=str(ROOT), encoding="utf-8")
    if proc.returncode != 0:
        print("node 探针失败 rc=", proc.returncode)
        print(proc.stderr[:3000])
        return 2
    js = json.loads(proc.stdout)
    js_by_label = {r["label"]: r for r in js["results"]}

    rows = []
    accept_div, code_div, agree = [], [], []
    for case in cases:
        label = case["label"]
        py = py_collect(py_validate(case["request"], case["candidates"]))
        jsr = js_by_label[label]
        js_norm = {"status": jsr["status"], "all_passed": jsr["all_passed"],
                   "codes": jsr["codes"], "codes_deep": jsr["codes_deep"],
                   "candidate_passed": jsr["candidate_passed"]}

        # 判定结论：Python 以 status=="passed" 表示全部通过；JS 同义。
        py_pass = py["status"] == "passed"
        js_pass = jsr["status"] == "passed"
        if py_pass != js_pass:
            kind = "接受性分歧"
            accept_div.append(label)
        elif py["status"] != jsr["status"] or py["codes"] != jsr["codes"]:
            kind = "码/状态分歧"
            code_div.append(label)
        else:
            kind = "一致"
            agree.append(label)
        rows.append({"label": label, "kind": kind, "python": py, "js": js_norm})

        if kind != "一致":
            print(f"\n### [{kind}] {label}")
            print(f"    Python: status={py['status']:<12} all_passed={str(py['all_passed']):<6} {py['codes_deep']}")
            print(f"    JS    : status={jsr['status']:<12} all_passed={str(jsr['all_passed']):<6} {jsr['codes_deep']}")

    summary = {
        "node": js["node"], "case_count": len(cases),
        "agree": len(agree), "code_divergence": len(code_div), "accept_divergence": len(accept_div),
        "accept_divergence_labels": accept_div, "code_divergence_labels": code_div,
    }
    lines = [f"node {js['node']}", f"用例总数 {len(cases)}",
             f"一致 {len(agree)} / 码或状态分歧 {len(code_div)} / 接受性分歧 {len(accept_div)}", ""]
    if accept_div:
        lines.append("【高严重度·接受性分歧】（一侧通过、另一侧拒绝）")
        lines += [f"  - {x}" for x in accept_div]
        lines.append("")
    if code_div:
        lines.append("【中严重度·码或状态分歧】（两侧都拒绝，但码/status 不同）")
        lines += [f"  - {x}" for x in code_div]
        lines.append("")
    lines.append("【全部用例明细】")
    for row in rows:
        mark = {"一致": "=", "码/状态分歧": "~", "接受性分歧": "!"}[row["kind"]]
        lines.append(f"{mark} {row['label']}")
        lines.append(f"    py: {row['python']['status']:<12} {row['python']['codes']}")
        lines.append(f"    js: {row['js']['status']:<12} {row['js']['codes']}")

    OUT_TXT.parent.mkdir(parents=True, exist_ok=True)
    OUT_TXT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    OUT_JSON.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print("\n" + "=" * 70)
    print(f"用例总数 {len(cases)}：一致 {len(agree)}，码/状态分歧 {len(code_div)}，**接受性分歧 {len(accept_div)}**")
    print("=" * 70)
    print("证据:", OUT_TXT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
