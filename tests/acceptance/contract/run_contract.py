"""QA-001 契约专项：10 个关系 ID 全量 + 边界值 + **错误码全量对账**。

独立立场：只调用公开接口 `workflow.intake.adapt_intake` 与 `validator.rules.validate`，
不导入规则线的 `tests/test_cases.json`，不修改 `validator/**`、`workflow/**`。

用法（生成证据与报告）：
    python tests/acceptance/contract/run_contract.py
"""

import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate          # noqa: E402
from workflow.intake import adapt_intake      # noqa: E402
from workflow import labels as labels_mod     # noqa: E402

OUT_DIR = ROOT / "docs/test-reports/contract-001"

RELATION_IDS = ["partner", "pursuit", "friend", "family", "classmate", "mentor",
                "client_partner", "other", "colleague", "unknown"]

BASE = {
    "recipient_relation": "pursuit",
    "closeness": "familiar",
    "occasion": "birthday",
    "budget_amount": "200.00",
    "currency": "CNY",
    "deadline_days": 2,
    "interests": ["coffee_food", "design_art"],
    "interest_confidence": {"coffee_food": "confirmed", "design_art": "inferred"},
    "gift_styles": ["practical"],
    "hard_exclusions": {"tags": ["alcohol"], "terms": ["酒"], "unresolved": []},
    "additional_context": "希望低调",
}


def dump(v):
    return json.dumps(v, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def cand_batch():
    """一个必然通过的三候选批次（与阶段 C 夹具同构，独立书写）。"""
    def c(cid, total, days, name):
        return {"id": cid, "name": name, "description": f"{name}的说明，含包装与贺卡设想",
                "estimated_total": total, "currency": "CNY", "estimated_preparation_days": days,
                "tags": ["other"], "reason": "匹配用户给出的偏好与预算",
                "fact_refs": ["interest:coffee_food"], "inferences": ["可能偏好实用礼物"],
                "unknowns": ["实际价格"], "presentation": "简要呈现"}
    return {"candidates": [c("c1", "150.00", 1, "手冲咖啡套装"),
                           c("c2", "120.00", 2, "设计感保温杯"),
                           c("c3", "80.00", 1, "手写贺卡组合")]}


def request_from(intake_obj):
    """用 intake 适配后的 request 作为 validator 的请求侧输入；失败则退回自建。"""
    res = adapt_intake(dump(intake_obj))
    return json.loads(res["request_json"]) if res["request_json"] else None


# ------------------------------------------------------------------ 场景表

def scenarios():
    s = []

    def add(cid, layer, desc, *, intake=None, raw_intake=None, req=None, cand=None,
            expect_codes=(), expect_status=None, note=""):
        s.append({"id": cid, "layer": layer, "desc": desc, "intake": intake,
                  "raw_intake": raw_intake, "req": req, "cand": cand,
                  "expect_codes": list(expect_codes), "expect_status": expect_status, "note": note})

    # --- 关系 ID 全量（10 个）---
    for rid in RELATION_IDS:
        obj = dict(BASE, recipient_relation=rid)
        if rid == "unknown":
            add(f"REL-{rid}", "intake", "关系=unknown（界面未确认态）", intake=obj,
                expect_codes=["INTAKE_CLARIFICATION_REQUIRED"], expect_status="needs_input")
        else:
            add(f"REL-{rid}", "intake", f"关系={rid}", intake=obj,
                expect_status="ready", note="colleague 仅技术回归" if rid == "colleague" else "")
    add("REL-MISSING", "intake", "缺 relation 字段", intake={k: v for k, v in BASE.items() if k != "recipient_relation"},
        expect_codes=["INTAKE_CLARIFICATION_REQUIRED"], expect_status="needs_input")
    add("REL-NULL", "intake", "relation=null", intake=dict(BASE, recipient_relation=None),
        expect_codes=["INTAKE_CLARIFICATION_REQUIRED"], expect_status="needs_input")
    add("REL-UNDECLARED", "intake", "relation=未声明值 'boss'", intake=dict(BASE, recipient_relation="boss"),
        expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")
    add("REL-DISPLAY-TEXT", "intake", "前端误传中文显示文本 '追求对象'", intake=dict(BASE, recipient_relation="追求对象"),
        expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")
    add("REL-UPPER", "intake", "relation='PURSUIT'（大小写敏感）", intake=dict(BASE, recipient_relation="PURSUIT"),
        expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")

    # --- 预算边界 ---
    for tag, amt, codes in [
        # ⚠️ 2026-10-31 更新（**过时断言修正，非为通过而改**）：
        # `validator-contract-decisions.md` §5（2026-10-30 修订）新增请求侧预算范围 [1,10000]（含端点），
        # 故 `"0"`/`"0.00"` 由 `ready` 变为 `needs_input` + `LIMIT_EXCEEDED`，400 位数字串同理。
        # 依据见该文件 §5；本套件的其余断言不受影响。候选侧范围**未**下沉（见 G-2 反向断言）。
        ("ZERO", "0", ("LIMIT_EXCEEDED",)), ("ZERO-DEC", "0.00", ("LIMIT_EXCEEDED",)),
        ("NEG", "-1", ("INVALID_AMOUNT",)),
        ("NEG-ZERO", "-0", ("INVALID_AMOUNT",)), ("OK", "200.00", ()),
        ("CENT-OVER", "200.01", ()), ("EXP", "1e3", ("INVALID_AMOUNT",)),
        ("FULLWIDTH", "２００", ("INVALID_AMOUNT",)), ("COMMA", "1,000.00", ("INVALID_AMOUNT",)),
        ("SPACES", " 200.00 ", ("INVALID_AMOUNT",)), ("LEAD-DOT", ".5", ("INVALID_AMOUNT",)),
        ("TRAIL-DOT", "1.", ("INVALID_AMOUNT",)), ("3-DEC", "0.001", ("INVALID_AMOUNT",)),
        ("HUGE", "9" * 400, ("LIMIT_EXCEEDED",)),
        ("INT-TYPE", 200, ("INVALID_TYPE", "INVALID_AMOUNT")),
        ("EMPTY", "", ("INVALID_AMOUNT",)),
    ]:
        note = ""
        if tag == "HUGE":
            note = ("⚠️ 已更新（2026-10-31）：`validator-contract-decisions.md` §5 新增请求侧预算范围 "
                    "[1,10000]（含端点），故 400 位数字串由 `ready` 变为 `LIMIT_EXCEEDED`；"
                    "本报告顶部的作废声明记录了该取代关系")
        add(f"BUD-{tag}", "intake", f"budget_amount={amt if not isinstance(amt, str) or len(amt) < 30 else amt[:12] + '…'}",
            intake=dict(BASE, budget_amount=amt), expect_codes=codes,
            expect_status="ready" if not codes else "needs_input", note=note)

    # --- 期限边界 ---
    # ⚠️ 2026-10-31 更新（**过时断言修正**）：§6 新增请求侧可用天数范围 [0,365]（含端点，保留 0），
    # 故 `100000` 由 `ready` 变为 `needs_input` + `LIMIT_EXCEEDED`。`-1` 仍为 `INVALID_TYPE`。
    for tag, days, codes in [("ZERO", 0, ()), ("ONE", 1, ()), ("TWO", 2, ()), ("Y365", 365, ()),
                             ("NEG", -1, ("INVALID_TYPE",)),
                             ("HUGE", 100000, ("LIMIT_EXCEEDED",))]:
        note = ""
        if tag == "HUGE":
            note = ("⚠️ 已更新（2026-10-31）：`validator-contract-decisions.md` §6 新增可用天数范围 "
                    "[0,365]（含端点），故 `100000` 变为 `LIMIT_EXCEEDED`；**天数 0 仍保留**")
        if tag == "NEG":
            note = "契约 :154 记为 INVALID_TYPE，独立复现一致"
        add(f"DL-{tag}", "intake", f"deadline_days={days}", intake=dict(BASE, deadline_days=days),
            expect_codes=codes, expect_status="ready" if not codes else "needs_input", note=note)

    # --- 币种 ---
    add("CUR-CNY", "intake", "currency=CNY", intake=dict(BASE, currency="CNY"), expect_status="ready")
    add("CUR-LOWER", "intake", "currency='cny'（大小写敏感）", intake=dict(BASE, currency="cny"),
        expect_codes=["UNSUPPORTED_CURRENCY"], expect_status="needs_input")
    add("CUR-USD", "intake", "currency='USD' 不换汇", intake=dict(BASE, currency="USD"),
        expect_codes=["UNSUPPORTED_CURRENCY"], expect_status="needs_input")

    # --- 兴趣与可信度 ---
    add("INT-EMPTY", "intake", "interests=[] 且 confidence={}（偏好未知，应可继续）",
        intake=dict(BASE, interests=[], interest_confidence={}), expect_status="ready")
    add("INT-UNKNOWN-ID", "intake", "interests=['unknown']", intake=dict(BASE, interests=["unknown"]),
        expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")
    add("CONF-UNKNOWN", "intake", "confidence=unknown", intake=dict(BASE, interest_confidence={"coffee_food": "unknown", "design_art": "inferred"}),
        expect_codes=["INTAKE_CONFIDENCE_MISMATCH"], expect_status="needs_input")
    add("CONF-EXTRA-KEY", "intake", "confidence 含未选兴趣的键", intake=dict(BASE, interest_confidence={"coffee_food": "confirmed", "design_art": "inferred", "travel_exploration": "inferred"}),
        expect_codes=["INTAKE_CONFIDENCE_MISMATCH"], expect_status="needs_input")
    add("CONF-WRONG-TYPE", "intake", "confidence 非对象", intake=dict(BASE, interest_confidence="confirmed"),
        expect_codes=["INVALID_TYPE"], expect_status="needs_input")
    add("INT-NOT-ARRAY", "intake", "interests 非数组", intake=dict(BASE, interests="coffee_food"),
        expect_codes=["INVALID_TYPE"], expect_status="needs_input")
    add("INT-DUP", "intake", "interests 重复", intake=dict(BASE, interests=["coffee_food", "coffee_food"]),
        expect_codes=["DUPLICATE_ID"], expect_status="needs_input")
    add("INT-OVER-20", "intake", "interests 超过 20 项（12 个合法 + 重复凑满 21）",
        intake=dict(BASE, interests=list(labels_mod.INTERESTS) + list(labels_mod.INTERESTS)[:9],
                    interest_confidence={k: "confirmed" for k in labels_mod.INTERESTS}),
        expect_codes=["LIMIT_EXCEEDED"], expect_status="needs_input")
    add("INT-LONG-LABEL", "intake", "interests 含 1001 码点的未知标签",
        intake=dict(BASE, interests=["x" * 1001]), expect_codes=["INTAKE_UNKNOWN_LABEL"],
        expect_status="needs_input")

    # --- 禁忌 ---
    add("EXC-UNRESOLVED", "intake", "hard_exclusions.unresolved 非空",
        intake=dict(BASE, hard_exclusions={"tags": ["alcohol"], "terms": ["酒"], "unresolved": ["不确定的禁忌"]}),
        expect_codes=["INTAKE_CLARIFICATION_REQUIRED"], expect_status="needs_input")
    add("EXC-UNKNOWN-TAG", "intake", "禁忌标签不在 EXCLUSIONS 内",
        intake=dict(BASE, hard_exclusions={"tags": ["weapon"], "terms": [], "unresolved": []}),
        expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")
    add("EXC-UNKNOWN-FIELD", "intake", "hard_exclusions 含未知字段",
        intake=dict(BASE, hard_exclusions={"tags": [], "terms": [], "unresolved": [], "extra": 1}),
        expect_codes=["INTAKE_UNKNOWN_FIELD"], expect_status="needs_input")
    add("EXC-NOT-OBJECT", "intake", "hard_exclusions 非对象",
        intake=dict(BASE, hard_exclusions=["alcohol"]), expect_codes=["INVALID_TYPE"], expect_status="needs_input")
    add("EXC-EMPTY-STRING-TERM", "intake", "terms 含空字符串（须为非空）",
        intake=dict(BASE, hard_exclusions={"tags": [], "terms": [" "], "unresolved": []}),
        expect_codes=["INVALID_TYPE"], expect_status="needs_input")
    add("EXC-TERM-1001", "intake", "terms 单项 1001 码点",
        intake=dict(BASE, hard_exclusions={"tags": [], "terms": ["t" * 1001], "unresolved": []}),
        expect_codes=["LIMIT_EXCEEDED"], expect_status="needs_input")
    add("EXC-TAGS-OVER-20", "intake", "tags 超过 20 项",
        intake=dict(BASE, hard_exclusions={"tags": ["alcohol"] * 21, "terms": [], "unresolved": []}),
        expect_codes=["LIMIT_EXCEEDED"], expect_status="needs_input")

    # --- 顶层结构 ---
    add("TOP-UNKNOWN-FIELD", "intake", "顶层未声明字段",
        intake=dict(BASE, recipient_relation_id="pursuit"),
        expect_codes=["INTAKE_UNKNOWN_FIELD"], expect_status="needs_input")
    add("TOP-ARRAY-ROOT", "intake", "根节点为数组", raw_intake="[]",
        expect_codes=["INVALID_TYPE"], expect_status="needs_input")

    # --- Unicode / 全角 / emoji ---
    add("UNI-CONTEXT-EMOJI", "intake", "additional_context 含 emoji 与全角",
        intake=dict(BASE, additional_context="🎁 ＡＬＣＯＨＯＬ 👩‍💻 零宽\u200b空格"), expect_status="ready")
    add("UNI-CONTEXT-LONG", "intake", "additional_context 1001 码点",
        intake=dict(BASE, additional_context="字" * 1001),
        expect_codes=["LIMIT_EXCEEDED", "INVALID_REQUEST"], expect_status="needs_input")
    add("UNI-TURKISH", "intake", "closeness 用土耳其语 I 混淆",
        intake=dict(BASE, closeness="İstanbul"), expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")

    # --- 原始字节层 ---
    add("RAW-DUP-KEY", "intake", "重复键", raw_intake='{"recipient_relation":"pursuit","recipient_relation":"partner"}',
        expect_codes=["INTAKE_INVALID_JSON"], expect_status="needs_input")
    add("RAW-NAN", "intake", "NaN 字面量", raw_intake='{"recipient_relation":NaN}', expect_codes=["INTAKE_INVALID_JSON"], expect_status="needs_input")
    add("RAW-OVER-32768", "intake", "超过 32768 UTF-8 字节",
        raw_intake='{"additional_context":"' + "a" * 33000 + '"}', expect_codes=["INTAKE_INVALID_JSON"], expect_status="needs_input")
    # 字节上限"恰好等于 / 超一"边界（独立复现契约 :163「等于上限允许」的说法）
    def raw_of_size(n):
        base_len = len(dump({"additional_context": ""}).encode("utf-8"))
        return dump({"additional_context": "a" * (n - base_len)})
    add("RAW-BYTES-EXACT-32768", "intake", "intake 原始字节恰好 32768（等于上限）",
        raw_intake=raw_of_size(32768), expect_codes=["LIMIT_EXCEEDED"], expect_status="needs_input",
        note="等于上限允许解析；此处因备注字段超 1000 码点而 LIMIT_EXCEEDED（不是 INTAKE_INVALID_JSON）")
    add("RAW-BYTES-32769", "intake", "intake 原始字节 32769（超一）",
        raw_intake=raw_of_size(32769), expect_codes=["INTAKE_INVALID_JSON"], expect_status="needs_input",
        note="超一即整体按 INTAKE_INVALID_JSON 拒绝")
    add("RAW-NOT-JSON", "intake", "非 JSON", raw_intake="not-json", expect_codes=["INTAKE_INVALID_JSON"], expect_status="needs_input")

    # --- validator 层：候选侧错误码 ---
    def vadd(cid, desc, mutate, codes, status="failed", req_obj=None):
        req = req_obj if req_obj is not None else request_from(BASE)
        cand = copy.deepcopy(cand_batch())
        if mutate:
            mutate(cand)
        add(cid, "validator", desc, req=req, cand=cand, expect_codes=codes, expect_status=status)

    vadd("V-NORMAL", "三候选全部通过", None, [], status="passed")
    vadd("V-OVER-BUDGET", "候选超预算 200.01",
         lambda c: c["candidates"][0].__setitem__("estimated_total", "200.01"), ["OVER_BUDGET"])
    vadd("V-BUDGET-BOUNDARY", "候选恰好 200.00（边界通过）",
         lambda c: c["candidates"][0].__setitem__("estimated_total", "200.00"), [], status="passed")
    vadd("V-FORBIDDEN-TAG", "候选标签 alcohol",
         lambda c: c["candidates"][0].__setitem__("tags", ["alcohol"]), ["FORBIDDEN_TAG"])
    vadd("V-FORBIDDEN-TERM", "候选描述含字面禁忌词「酒」",
         lambda c: c["candidates"][0].__setitem__("description", "含酒类的礼盒"), ["FORBIDDEN_TERM"])
    vadd("V-UNKNOWN-TAG", "候选标签不在词表",
         lambda c: c["candidates"][0].__setitem__("tags", ["nope"]), ["UNKNOWN_TAG"])
    vadd("V-UNKNOWN-FACT", "候选引用 f99",
         lambda c: c["candidates"][0].__setitem__("fact_refs", ["f99"]), ["UNKNOWN_FACT_REF"])
    vadd("V-PREP-TOO-LONG", "候选准备 9 天",
         lambda c: c["candidates"][0].__setitem__("estimated_preparation_days", 9), ["PREPARATION_TOO_LONG"])
    vadd("V-CUR-MISMATCH", "候选币种 USD",
         lambda c: c["candidates"][0].__setitem__("currency", "USD"), ["CURRENCY_MISMATCH"])
    vadd("V-DUP-ID", "候选 ID 重复",
         lambda c: c["candidates"][1].__setitem__("id", "c1"), ["DUPLICATE_ID"])
    vadd("V-DUP-CONTENT", "两名候选内容重复",
         lambda c: c["candidates"][1].update({"name": c["candidates"][0]["name"],
                                              "description": c["candidates"][0]["description"]}),
         ["DUPLICATE_CANDIDATE_CONTENT"])
    vadd("V-BAD-CAND-ID", "候选 ID 为 c9",
         lambda c: c["candidates"][0].__setitem__("id", "c9"), ["INVALID_CANDIDATE_ID"])
    vadd("V-COUNT-2", "只有两个候选", lambda c: c["candidates"].pop(), ["INVALID_CANDIDATE_COUNT"])
    vadd("V-MISSING-NAME", "候选缺 name",
         lambda c: c["candidates"][0].pop("name"), ["MISSING_FIELD"])
    vadd("V-TYPE-TOTAL", "候选金额为布尔",
         lambda c: c["candidates"][0].__setitem__("estimated_total", True), ["INVALID_TYPE", "INVALID_AMOUNT"])
    vadd("V-AMOUNT-FULLWIDTH", "候选金额全角",
         lambda c: c["candidates"][0].__setitem__("estimated_total", "２００"),
         ["INVALID_AMOUNT"])
    vadd("V-LIMIT-DESC", "候选描述 1001 码点",
         lambda c: c["candidates"][0].__setitem__("description", "长" * 1001), ["LIMIT_EXCEEDED"])
    vadd("V-REQ-NOT-OBJECT", "请求根非对象（直接传数组 JSON 文本）", None, ["INVALID_REQUEST"],
         status="needs_input", req_obj=json.loads("[1,2]"))
    add("V-INVALID-JSON", "validator", "validator：候选 JSON 截断",
        req=request_from(BASE), cand='{"candidates": [', expect_codes=["INVALID_JSON"], expect_status="error")
    add("V-INTERNAL-EMPTY", "validator", "validator：两侧都传空串（探兜底分支）",
        req="", cand="", expect_codes=["INVALID_JSON", "INTERNAL_ERROR"], expect_status=None,
        note="用于探 INTERNAL_ERROR 是否可由输入触达")
    return s


def run_intake(sc):
    if sc["raw_intake"] is not None:
        raw = sc["raw_intake"]
    else:
        raw = dump(sc["intake"])
    res = adapt_intake(raw)
    codes = sorted({e["code"] for e in res["errors"]})
    return {"status": res["status"], "codes": codes, "errors": res["errors"],
            "request_json_released": res["request_json"] is not None}


def run_validator(sc):
    req = sc["req"]
    cand = sc["cand"]
    req_json = req if isinstance(req, str) else dump(req)
    cand_json = cand if isinstance(cand, str) else dump(cand)
    res = validate(req_json, cand_json)
    # 注意：候选级错误码在 candidate_results[i].errors，不在顶层 errors。
    # 只读顶层会把"候选失败"误判成"没有错误码"。
    collected = list(res["errors"])
    for c in res.get("candidate_results") or []:
        collected.extend(c.get("errors") or [])
    codes = sorted({e["code"] for e in collected})
    return {"status": res["status"], "all_passed": res.get("all_passed"), "codes": codes,
            "errors": res["errors"], "candidate_codes": sorted(
                {e["code"] for c in (res.get("candidate_results") or []) for e in (c.get("errors") or [])})}


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "evidence").mkdir(parents=True, exist_ok=True)
    results = []
    for sc in scenarios():
        try:
            got = run_intake(sc) if sc["layer"] == "intake" else run_validator(sc)
            error = None
        except Exception as err:  # 记录而非崩溃
            got = {"status": None, "codes": [], "errors": []}
            error = f"{type(err).__name__}: {err}"
        exp_codes = sc["expect_codes"]
        code_ok = (not exp_codes) or bool(set(exp_codes) & set(got["codes"])) or (
            set(exp_codes) <= set(got["codes"]))
        status_ok = (sc["expect_status"] is None) or got["status"] == sc["expect_status"]
        results.append({**{k: sc[k] for k in ("id", "layer", "desc", "expect_codes", "expect_status", "note")},
                        "expected_codes": exp_codes, "actual": got, "error": error,
                        "code_ok": bool(code_ok), "status_ok": bool(status_ok),
                        "passed": bool(code_ok and status_ok and not error)})

    # ---------------- 错误码全量对账
    sources = {
        "validator/rules.py": (ROOT / "validator/rules.py").read_text(encoding="utf-8"),
        "workflow/intake.py": (ROOT / "workflow/intake.py").read_text(encoding="utf-8"),
        "workflow/runtime.py": (ROOT / "workflow/runtime.py").read_text(encoding="utf-8"),
    }
    import re
    implemented = {}
    for name, text in sources.items():
        implemented[name] = sorted(set(re.findall(r'"([A-Z][A-Z_]{3,})"', text)))

    contract_doc = (ROOT / "docs/intake-contract.md").read_text(encoding="utf-8")
    documented = sorted(set(re.findall(r"^\|\s*`?([A-Z][A-Z_]{3,})`?\s*\|", contract_doc, re.M)))
    spec_doc = (ROOT / "workflow/workflow-spec.md").read_text(encoding="utf-8")
    reserved = sorted(set(re.findall(r"`([A-Z][A-Z_]{3,})`", spec_doc)))

    triggered = sorted({c for r in results for c in r["actual"]["codes"]})
    all_impl = sorted({c for v in implemented.values() for c in v})
    reconciliation = []
    for code in sorted(set(all_impl) | set(documented) | set(reserved)):
        reconciliation.append({
            "code": code,
            "implemented_in": [k for k, v in implemented.items() if code in v],
            "documented_in_contract": code in documented,
            "mentioned_in_workflow_spec": code in reserved,
            "triggered_by_this_suite": code in triggered,
        })

    doc = {
        "suite": "QA-001 契约专项（关系 ID 全量 + 边界值 + 错误码全量对账）",
        "git_head": __import__("subprocess").run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                                 capture_output=True, text=True).stdout.strip(),
        "relation_ids_declared": sorted(labels_mod.RELATIONS),
        "totals": {"cases": len(results), "passed": sum(1 for r in results if r["passed"]),
                   "failed": sum(1 for r in results if not r["passed"])},
        "results": results,
        "error_code_reconciliation": reconciliation,
        "implemented_by_file": implemented,
        "documented_in_contract": documented,
        "reserved_in_workflow_spec": reserved,
        "triggered_by_this_suite": triggered,
    }
    (OUT_DIR / "evidence" / "contract-specials.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"cases={doc['totals']['cases']} passed={doc['totals']['passed']} failed={doc['totals']['failed']}")
    for r in results:
        flag = "PASS" if r["passed"] else "FAIL"
        print(f"  {flag} {r['id']:<22} 状态={r['actual']['status']} 码={r['actual']['codes']}"
              + (f" 期望={r['expected_codes']}" if not r["passed"] else ""))
    print("\n未触达的实现码:", sorted(set(all_impl) - set(triggered)))
    print("证据:", OUT_DIR / "evidence" / "contract-specials.json")
    return 0 if doc["totals"]["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
