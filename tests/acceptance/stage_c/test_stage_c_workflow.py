"""QA-001 阶段 C：工作流层独立验收（探针／契约／校验／修订／持续失败／记录方案）。

独立性声明：
- 只调用公开接口：`workflow.intake.adapt_intake`、`workflow.runtime.check/recheck/report`、
  `workflow.generated/*_node.py` 的入口函数、`workflow.sandbox_probe.main`、`validator.validate`。
- **不导入** `tests/test_validator.py`、`tests/test_cases.json`（规则开发 Agent 自测夹具）。
- 使用本目录自建的 `cases.json` 冻结夹具，不读取其他线的例子文件作为输入。
- 全流程 `model_calls = 0`：不调用任何模型、网络或部署服务。
- C5-02 的期望口径来自生成器 `workflow/build_code_node.py`：`manifest.json` 只存摘要且该摘要 EOL 敏感，
  无法只靠摘要做换行无关比较（见 `normalize_eol`／`rebuild_generated_artifacts` 注释）。

运行：
    python -m unittest discover -s tests/acceptance/stage_c -v
或生成完整证据：
    python tests/acceptance/stage_c/run_stage_c.py
"""

import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from validator.rules import validate  # noqa: E402
from workflow import runtime  # noqa: E402
from workflow.intake import adapt_intake  # noqa: E402
from workflow.sandbox_probe import main as sandbox_probe  # noqa: E402

CASES = json.loads((Path(__file__).with_name("cases.json")).read_text(encoding="utf-8"))
EVIDENCE_PATH = ROOT / "docs" / "test-reports" / "stage-c" / "evidence" / "dify-run-evidence.json"
CONTRACT = ROOT / "docs" / "intake-contract.md"

OBSERVATIONS = {}


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def codes(result):
    return sorted({e.get("code") for e in (result.get("errors") or [])})


def normalize_eol(raw):
    """哈希／比对前把 CRLF、CR 统一成 LF。

    哈希按 LF 归一化比较，避免 CRLF 检出造成假红（2026-10-31，PM 裁决）：
    同一个文件在仓库里是 LF、Windows 检出后是 CRLF，逐字节摘要必然不同，但内容并没有差别。
    归一化只抹掉换行形态，任何真实内容改动仍会改变摘要并使断言继续 FAIL。
    """
    return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def rebuild_generated_artifacts(recorded_sources):
    """按 manifest 记录的 `sources_sha256` 反推生成时的源码字节形态，再用权威生成器重算生成物。

    哈希按 LF 归一化比较，避免 CRLF 检出造成假红（2026-10-31，PM 裁决）：`artifacts_sha256`
    是生成器在 CRLF 工作区上算出的 EOL 敏感摘要（内容是 mixed EOL），只归一化文件一侧永远对不上；
    而 manifest 只存摘要不存内容，所以改成"真的读两份内容比对"：先在临时目录按记录摘要锁定源码
    字节（LF／CRLF／原样三选一），用 `workflow/build_code_node.py` 重算期望内容与期望摘要，
    再由调用方与磁盘内容在 LF 归一化后逐字节比较。真实差异（源码或生成物改一个字符）仍会 FAIL。
    """
    import contextlib
    import importlib.util
    import io
    import shutil
    import tempfile

    spec = importlib.util.spec_from_file_location(
        "_stage_c_build_code_node", ROOT / "workflow" / "build_code_node.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not recorded_sources or set(recorded_sources) != set(module.SOURCES):
        return None
    tmp = Path(tempfile.mkdtemp(prefix="stage-c-regen-"))
    for name, want in recorded_sources.items():
        source = ROOT / name
        raw = source.read_bytes() if source.is_file() else None
        variants = [] if raw is None else [
            raw, normalize_eol(raw), normalize_eol(raw).replace(b"\n", b"\r\n")]
        matching = [v for v in variants if hashlib.sha256(v).hexdigest() == want]
        if not matching:  # 锁不上记录摘要 ⇒ 源码真实漂移，不放行
            shutil.rmtree(tmp, ignore_errors=True)
            return None
        target = tmp / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(matching[0])
    module.ROOT = tmp
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            module.build()
    except Exception:  # 生成器本身跑不动 ⇒ 不留下临时目录，异常照常抛出
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    generated = tmp / "workflow" / "generated"
    return {"root": tmp, "dir": generated,
            "manifest": json.loads((generated / "manifest.json").read_text(encoding="utf-8"))}


def intake(relation="pursuit", **overrides):
    data = copy.deepcopy(CASES["baseline_intake"])
    data["recipient_relation"] = relation
    data.update(overrides)
    return data


def candidates():
    return copy.deepcopy(CASES["baseline_candidates"])


def gen_node(name):
    namespace = {}
    path = ROOT / "workflow" / "generated" / name
    exec(compile(path.read_text(encoding="utf-8"), name, "exec"), namespace)
    return namespace["main"]


class Recorder(unittest.TestCase):
    """给每个用例记录输入／预期／实际，供 run_stage_c.py 落盘。"""

    GROUP = "未分组"

    def observe(self, case_id, title, given, expected, actual, ok):
        OBSERVATIONS[case_id] = {
            "id": case_id,
            "group": self.GROUP,
            "title": title,
            "input": given,
            "expected": expected,
            "actual": actual,
            "passed": bool(ok),
        }
        self.assertTrue(ok, f"{case_id} {title}: expected={expected!r} actual={actual!r}")


# ---------------------------------------------------------------- C1 探针


class C1SandboxProbe(Recorder):
    GROUP = "C1 沙箱兼容探针"

    def test_c1_01_local_stdlib_probe(self):
        result = sandbox_probe()
        self.observe("C1-01", "本地标准库探针 compatible=true", {}, {"compatible": True},
                     result, result.get("compatible") is True)

    def test_c1_02_dify_real_probe_evidence(self):
        """真机结论只能来自独立浏览器实跑捕获的证据文件，不能引用 PM 数字。"""
        if not EVIDENCE_PATH.exists():
            self.skipTest(f"缺少独立 Dify 证据：{EVIDENCE_PATH}")
        ev = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
        checks = ev.get("checks") or {}
        keys = ["code_node_succeeded", "code_node_error_null", "code_node_output_compatible_true",
                "details_json_all_true", "details_json_declared_string", "zero_tokens", "no_exceptions"]
        actual = {k: checks.get(k) for k in keys}
        self.observe("C1-02", "真实 Dify Code 节点沙箱执行成功（独立捕获）", {"evidence": str(EVIDENCE_PATH.relative_to(ROOT))},
                     {k: True for k in keys}, actual, all(v is True for v in actual.values()))

    def test_c1_03_dify_probe_latency_and_tokens_recorded(self):
        if not EVIDENCE_PATH.exists():
            self.skipTest("缺少独立 Dify 证据")
        ev = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
        run = ((ev.get("run_sse") or {}).get("parsed")) or {}
        code_fin = next((n for n in run.get("nodes", []) if n.get("node_type") == "code"), None)
        actual = {
            "run_id": run.get("workflow_run_id"),
            "code_node_elapsed_time": (code_fin or {}).get("elapsed_time"),
            "workflow_elapsed_time": run.get("workflow_elapsed_time"),
            "total_tokens": run.get("total_tokens"),
        }
        expected = "run_id 非空；elapsed_time 为真实浮点数；total_tokens 必须为 0（无模型调用）"
        ok = bool(actual["run_id"]) and isinstance(actual["code_node_elapsed_time"], (int, float)) \
            and actual["total_tokens"] == 0
        self.observe("C1-03", "记录真实节点耗时与 token（不写零成本）", {}, expected, actual, ok)


# ------------------------------------------------- C2 契约缺口（关系／未知）


class C2ContractGaps(Recorder):
    GROUP = "C2 契约缺口"

    def test_c2_01_pursuit_now_has_machine_value(self):
        from workflow.labels import RELATIONS
        actual = {
            "pursuit_present": "pursuit" in RELATIONS,
            "pursuit_text": RELATIONS.get("pursuit"),
            "partner_text": RELATIONS.get("partner"),
            "colleague_present": "colleague" in RELATIONS,
            "total_ids": len(RELATIONS),
            "labels_sha256": __import__("hashlib").sha256((ROOT / "workflow/labels.py").read_bytes()).hexdigest(),
        }
        expected = "pursuit 存在且为『追求对象』；partner 为『恋人』；colleague 保留（仅技术回归）"
        ok = actual["pursuit_present"] and actual["pursuit_text"] == "追求对象" and actual["partner_text"] == "恋人" and actual["colleague_present"]
        self.observe("C2-01", "『追求对象』已有独立机器值 pursuit", {}, expected, actual, ok)

    def test_c2_02_pursuit_and_partner_are_distinct_and_accepted(self):
        pursuit = adapt_intake(dump(intake("pursuit")))
        partner = adapt_intake(dump(intake("partner")))
        p_req = json.loads(pursuit["request_json"]) if pursuit["request_json"] else None
        q_req = json.loads(partner["request_json"]) if partner["request_json"] else None
        actual = {
            "pursuit_status": pursuit["status"],
            "partner_status": partner["status"],
            "pursuit_relation_text": (p_req or {}).get("recipient_relation"),
            "pursuit_relation_id": (p_req or {}).get("recipient_relation_id"),
            "partner_relation_text": (q_req or {}).get("recipient_relation"),
            "partner_relation_id": (q_req or {}).get("recipient_relation_id"),
        }
        expected = "两者均 ready；中文分别为『追求对象』/『恋人』；机器值 pursuit/partner 且互不相同"
        ok = (actual["pursuit_status"] == "ready" and actual["partner_status"] == "ready"
              and actual["pursuit_relation_text"] == "追求对象" and actual["partner_relation_text"] == "恋人"
              and actual["pursuit_relation_id"] == "pursuit" and actual["partner_relation_id"] == "partner")
        self.observe("C2-02", "pursuit 与 partner 并列互斥且都可通过 intake", {}, expected, actual, ok)

    def test_c2_03_pursuit_was_rejected_before_the_change(self):
        """用**逐字节固定的历史夹具**复现变更前被拒的行为，证明 PM 的 INTAKE_UNKNOWN_LABEL 声明。

        安全说明：不挂 `git show HEAD`——`HEAD` 是会移动的引用，历史基线挂在其上会在他人提交后失效
        （本用例就因此从通过变为失败过）。改为 `fixtures/labels_before_pursuit.py`，
        出处与 sha256 见 `fixtures/PROVENANCE.md`，并断言该夹具哈希未被改动。
        """
        fixture_sha256_recorded = "333ad9761d9278c7421c0cdd1c8d43ebbef7b6a6c164dfc54896ec653520d916"
        fixture = Path(__file__).with_name("fixtures") / "labels_before_pursuit.py"
        raw = fixture.read_bytes()
        # 哈希按 LF 归一化比较，避免 CRLF 检出造成假红（2026-10-31，PM 裁决）：记录值 333ad976…
        # 是仓库字节（LF）的摘要，同一夹具在 Windows 检出后是 CRLF（1546 B），逐字节摘要必然不同。
        # 归一化只抹掉换行形态；夹具真实内容被改动时摘要仍会变化，C2-03 继续 FAIL。
        normalized = normalize_eol(raw)
        fixture_sha256 = hashlib.sha256(normalized).hexdigest()
        namespace: dict = {}
        exec(compile(normalized.decode("utf-8"), str(fixture), "exec"), namespace)
        before_relations = namespace["RELATIONS"]

        import workflow.intake as intake_module
        import workflow.labels as labels_module
        original = intake_module.RELATIONS
        try:
            intake_module.RELATIONS = before_relations
            result = adapt_intake(dump(intake("pursuit")))
        finally:
            intake_module.RELATIONS = original

        # 漂移观察（不影响判定）：当前工作区版本是否已加入 pursuit
        drift = {"current_has_pursuit": "pursuit" in labels_module.RELATIONS,
                 "current_partner_text": labels_module.RELATIONS.get("partner"),
                 "before_partner_text": before_relations.get("partner")}
        actual = {
            "fixture_sha256": fixture_sha256,
            "fixture_sha256_raw": hashlib.sha256(raw).hexdigest(),
            "fixture_sha256_as_recorded": fixture_sha256 == fixture_sha256_recorded,
            "before_relations_has_pursuit": "pursuit" in before_relations,
            "status": result["status"],
            "codes": codes(result),
            "request_json_released": result["request_json"] is not None,
            "drift": drift,
        }
        expected = ("夹具 sha256（按 LF 归一化）与记录一致；固定版本无 pursuit；提交 pursuit 得到 "
                    "needs_input + INTAKE_UNKNOWN_LABEL 且不返回可用请求")
        ok = (actual["fixture_sha256_as_recorded"] and not actual["before_relations_has_pursuit"]
              and actual["status"] == "needs_input" and "INTAKE_UNKNOWN_LABEL" in actual["codes"]
              and actual["request_json_released"] is False)
        self.observe("C2-03", "变更前 pursuit 确实被拒（逐字节固定夹具复现）", {}, expected, actual, ok)

    def test_c2_04_unknown_confidence_rejected(self):
        data = intake("pursuit")
        data["interest_confidence"] = {"coffee_food": "unknown", "design_art": "inferred"}
        result = adapt_intake(dump(data))
        actual = {"status": result["status"], "codes": codes(result), "request_json": result["request_json"]}
        expected = "needs_input + INTAKE_CONFIDENCE_MISMATCH，且不返回可用请求"
        ok = (actual["status"] == "needs_input" and "INTAKE_CONFIDENCE_MISMATCH" in actual["codes"]
              and actual["request_json"] is None)
        self.observe("C2-04", "interest_confidence=unknown 被拒", {}, expected, actual, ok)

    def test_c2_05_extra_confidence_key_rejected(self):
        data = intake("pursuit")
        data["interest_confidence"] = {"coffee_food": "confirmed", "design_art": "inferred", "travel_exploration": "inferred"}
        result = adapt_intake(dump(data))
        actual = {"status": result["status"], "codes": codes(result)}
        expected = "needs_input + INTAKE_CONFIDENCE_MISMATCH（多余键）"
        ok = actual["status"] == "needs_input" and "INTAKE_CONFIDENCE_MISMATCH" in actual["codes"]
        self.observe("C2-05", "可信度多余键被拒", {}, expected, actual, ok)

    def test_c2_06_unknown_interest_label_rejected(self):
        data = intake("pursuit")
        data["interests"] = ["coffee_food", "unknown"]
        data["interest_confidence"] = {"coffee_food": "confirmed"}
        result = adapt_intake(dump(data))
        actual = {"status": result["status"], "codes": codes(result)}
        expected = "needs_input + INTAKE_UNKNOWN_LABEL（不存在 interests 的 unknown 机器值）"
        ok = actual["status"] == "needs_input" and "INTAKE_UNKNOWN_LABEL" in actual["codes"]
        self.observe("C2-06", "interests 中的 unknown 机器值被拒", {}, expected, actual, ok)

    def test_c2_07_frontend_cannot_submit_relation_id(self):
        data = intake("pursuit")
        data["recipient_relation_id"] = "pursuit"
        result = adapt_intake(dump(data))
        actual = {"status": result["status"], "codes": codes(result)}
        expected = "needs_input + INTAKE_UNKNOWN_FIELD（该字段只由服务端产出）"
        ok = actual["status"] == "needs_input" and "INTAKE_UNKNOWN_FIELD" in actual["codes"]
        self.observe("C2-07", "前端提交 recipient_relation_id 被拒", {}, expected, actual, ok)

    def test_c2_08_colleague_kept_for_technical_regression(self):
        result = adapt_intake(dump(intake("colleague")))
        request = json.loads(result["request_json"]) if result["request_json"] else {}
        actual = {"status": result["status"], "relation_text": request.get("recipient_relation"),
                  "relation_id": request.get("recipient_relation_id")}
        expected = "ready；中文『同事』；机器值 colleague（仅技术回归，产品面不得出现）"
        ok = actual["status"] == "ready" and actual["relation_text"] == "同事" and actual["relation_id"] == "colleague"
        self.observe("C2-08", "colleague 仅作技术回归仍可通过", {}, expected, actual, ok)

    def test_c2_09_adding_relation_id_does_not_break_validator(self):
        result = adapt_intake(dump(intake("pursuit")))
        request_json = result["request_json"]
        with_id = validate(request_json, "{}")
        without_id = json.loads(request_json)
        without_id.pop("recipient_relation_id")
        baseline = validate(dump(without_id), "{}")
        actual = {"with_id_status": with_id["status"], "without_id_status": baseline["status"],
                  "with_id_codes": codes(with_id), "without_id_codes": codes(baseline)}
        expected = "两种请求的校验状态与错误码集合一致（validator 对 request 无字段白名单）"
        ok = actual["with_id_status"] == actual["without_id_status"] and actual["with_id_codes"] == actual["without_id_codes"]
        self.observe("C2-09", "新增 recipient_relation_id 不破坏既有校验", {}, expected, actual, ok)

    def test_c2_10_internal_error_documented_in_contract(self):
        text = CONTRACT.read_text(encoding="utf-8")
        table_region = text.split("## 错误及调用边界", 1)[-1]
        actual = {
            "INTERNAL_ERROR_in_contract": "INTERNAL_ERROR" in text,
            "INTERNAL_ERROR_in_error_table": "INTERNAL_ERROR" in table_region.split("## ")[0],
            "has_source_reference": "workflow/intake.py" in table_region,
        }
        expected = "契约错误码表已补入 INTERNAL_ERROR 并标注出处"
        ok = actual["INTERNAL_ERROR_in_error_table"] and actual["has_source_reference"]
        self.observe("C2-10", "INTERNAL_ERROR 已补入契约错误码表", {}, expected, actual, ok)

    def test_c2_11_contract_lists_pursuit_and_marks_colleague(self):
        text = CONTRACT.read_text(encoding="utf-8")
        actual = {
            "pursuit_in_contract": "pursuit" in text,
            "colleague_marked_regression": "仅技术回归" in text,
            "partner_text_lianren": "恋人" in text,
            "old_partner_wording_gone": "partner 伴侣" not in text,
        }
        expected = "契约含 pursuit；colleague 标注『仅技术回归』；partner 中文为『恋人』"
        ok = all(actual.values())
        self.observe("C2-11", "契约文档与冻结关系枚举一致", {}, expected, actual, ok)


# ------------------------------------------------------ C3 校验：正常／超预算／禁忌／损坏


class C3Validation(Recorder):
    GROUP = "C3 候选校验"

    def setUp(self):
        self.request_json = adapt_intake(dump(intake("pursuit")))["request_json"]
        self.ok_batch = candidates()

    def test_c3_01_normal_three_candidates_pass(self):
        result = validate(self.request_json, dump(self.ok_batch))
        actual = {"status": result["status"], "all_passed": result["all_passed"],
                  "passed_ids": [r["id"] for r in result["candidate_results"] if r["passed"]],
                  "error_codes": codes(result), "count": len(result["candidate_results"])}
        expected = "status=passed、all_passed=true、c1/c2/c3 全通过、无错误、恰好三个候选"
        ok = (actual["status"] == "passed" and actual["all_passed"] is True
              and actual["passed_ids"] == ["c1", "c2", "c3"] and actual["error_codes"] == [] and actual["count"] == 3)
        self.observe("C3-01", "正常基线：三项候选全部通过", {"candidates": "cases.json baseline_candidates"},
                     expected, actual, ok)

    def test_c3_02_over_budget_boundary_200_00_passes(self):
        batch = candidates()
        batch["candidates"][0]["estimated_total"] = "200.00"
        result = validate(self.request_json, dump(batch))
        first = next(r for r in result["candidate_results"] if r["id"] == "c1")
        actual = {"boundary_total": "200.00", "c1_passed": first["passed"], "c1_errors": codes(first),
                  "all_passed": result["all_passed"]}
        expected = "预算边界恰好 200.00 应通过"
        ok = actual["c1_passed"] is True and actual["c1_errors"] == []
        self.observe("C3-02", "超预算边界：200.00 通过", {"c1.estimated_total": "200.00"}, expected, actual, ok)

    def test_c3_03_over_budget_by_one_cent_fails(self):
        batch = candidates()
        batch["candidates"][0]["estimated_total"] = "200.01"
        result = validate(self.request_json, dump(batch))
        first = next(r for r in result["candidate_results"] if r["id"] == "c1")
        actual = {"total": "200.01", "c1_passed": first["passed"], "c1_errors": codes(first),
                  "other_passed": sorted(r["id"] for r in result["candidate_results"] if r["passed"])}
        expected = "c1 因 OVER_BUDGET 失败，c2/c3 仍通过（只失败项不可选）"
        ok = (actual["c1_passed"] is False and "OVER_BUDGET" in actual["c1_errors"]
              and actual["other_passed"] == ["c2", "c3"])
        self.observe("C3-03", "超预算 200.01 失败且不牵连其他项", {"c1.estimated_total": "200.01"}, expected, actual, ok)

    def test_c3_04_forbidden_tag_alcohol(self):
        batch = candidates()
        batch["candidates"][0]["tags"] = ["alcohol"]
        result = validate(self.request_json, dump(batch))
        first = next(r for r in result["candidate_results"] if r["id"] == "c1")
        actual = {"c1_passed": first["passed"], "c1_errors": codes(first)}
        expected = "FORBIDDEN_TAG"
        ok = actual["c1_passed"] is False and "FORBIDDEN_TAG" in actual["c1_errors"]
        self.observe("C3-04", "禁忌标签 alcohol 被拦截", {"c1.tags": ["alcohol"]}, expected, actual, ok)

    def test_c3_05_forbidden_term_literal(self):
        batch = candidates()
        batch["candidates"][0]["description"] = "礼盒内含精选酒类饮品一瓶"
        result = validate(self.request_json, dump(batch))
        first = next(r for r in result["candidate_results"] if r["id"] == "c1")
        actual = {"c1_passed": first["passed"], "c1_errors": codes(first)}
        expected = "FORBIDDEN_TERM（字面词『酒』）"
        ok = actual["c1_passed"] is False and "FORBIDDEN_TERM" in actual["c1_errors"]
        self.observe("C3-05", "字面禁忌词『酒』被拦截", {"c1.description": "…酒类饮品…"}, expected, actual, ok)

    def test_c3_06_full_width_variant_still_caught(self):
        """字面禁忌走 NFKC + casefold 归一化（rules.py:107、:157、:207），全角/大小写变体不得绕过。"""
        data = intake("pursuit")
        data["hard_exclusions"] = {"tags": [], "terms": ["alcohol"], "unresolved": []}
        request_json = adapt_intake(dump(data))["request_json"]
        batch = candidates()
        batch["candidates"][0]["description"] = "礼盒内含精选ＡＬＣＯＨＯＬ饮品"
        result = validate(request_json, dump(batch))
        first = next(r for r in result["candidate_results"] if r["id"] == "c1")
        actual = {"c1_passed": first["passed"], "c1_errors": codes(first),
                  "term": "alcohol", "description": "…ＡＬＣＯＨＯＬ…（全角）"}
        expected = "NFKC 归一化后命中 FORBIDDEN_TERM"
        ok = actual["c1_passed"] is False and "FORBIDDEN_TERM" in actual["c1_errors"]
        self.observe("C3-06", "全角变体字面禁忌不被绕过", {"c1.description": "…ＡＬＣＯＨＯＬ…"}, expected, actual, ok)

    def test_c3_07_broken_json_candidates_is_error_and_repairable(self):
        state = runtime.check(self.request_json, '{"candidates":[{"id":"c1",', 0)
        actual = {"status": state["validation"]["status"], "codes": codes(state["validation"]),
                  "repairable": state["repairable"]}
        expected = "status=error、INVALID_JSON、repairable=true（值得一次修订）"
        ok = (actual["status"] == "error" and "INVALID_JSON" in actual["codes"] and actual["repairable"] is True)
        self.observe("C3-07", "候选 JSON 损坏 → 可修订的错误", {"candidates_json": '{"candidates":[{"id":"c1",'}, expected, actual, ok)

    def test_c3_08_missing_budget_with_broken_candidates_not_repairable(self):
        state = runtime.check(dump({"currency": "CNY"}), "bad-json", 0)
        actual = {"repairable": state["repairable"], "validation_status": state["validation"]["status"],
                  "request_codes": codes(state["validation"])}
        expected = "请求本身缺预算 → 不可修订（不拿模型修订掩盖输入问题）"
        ok = actual["repairable"] is False
        self.observe("C3-08", "请求缺必填时损坏候选也不进入修订", {"request": '{"currency":"CNY"}', "candidates": "bad-json"},
                     expected, actual, ok)

    def test_c3_09_currency_mismatch_not_converted(self):
        batch = candidates()
        batch["candidates"][0]["currency"] = "USD"
        result = validate(self.request_json, dump(batch))
        first = next(r for r in result["candidate_results"] if r["id"] == "c1")
        actual = {"c1_passed": first["passed"], "c1_errors": codes(first),
                  "total_unchanged": batch["candidates"][0]["estimated_total"]}
        expected = "CURRENCY_MISMATCH，不做汇率换算、不修改金额"
        ok = actual["c1_passed"] is False and "CURRENCY_MISMATCH" in actual["c1_errors"] and actual["total_unchanged"] == "150.00"
        self.observe("C3-09", "币种不一致拒绝且不换汇", {"c1.currency": "USD"}, expected, actual, ok)


# ------------------------------------------------------------ C4 修订与保护


class C4Repair(Recorder):
    GROUP = "C4 修订与保护"

    def setUp(self):
        self.request_json = adapt_intake(dump(intake("pursuit")))["request_json"]

    def over_budget_batch(self, total="250.00"):
        batch = candidates()
        batch["candidates"][0]["estimated_total"] = total
        return batch

    def test_c4_01_first_check_over_budget_is_repairable(self):
        state = runtime.check(self.request_json, dump(self.over_budget_batch()), 0)
        actual = {"repairable": state["repairable"], "repair_count": state["repair_count"],
                  "preserved": sorted(runtime.preserved_candidates(state))}
        expected = "repairable=true、repair_count=0、保留已通过项 c2/c3"
        ok = actual["repairable"] is True and actual["repair_count"] == 0 and actual["preserved"] == ["c2", "c3"]
        self.observe("C4-01", "首检超预算可进入一次修订", {"c1.estimated_total": "250.00"}, expected, actual, ok)

    def test_c4_02_revision_success_reserves_quota(self):
        state = runtime.recheck(self.request_json, dump(self.over_budget_batch()), dump(candidates()), 0)
        actual = {"all_passed": state["validation"]["all_passed"], "repair_count": state["repair_count"],
                  "workflow_errors": state["workflow_errors"]}
        expected = "复检全部通过、repair_count=1（额度已占用）、无 workflow_errors"
        ok = actual["all_passed"] is True and actual["repair_count"] == 1 and actual["workflow_errors"] == []
        self.observe("C4-02", "一次修订后复检通过并计入额度", {}, expected, actual, ok)

    def test_c4_03_repair_quota_exhausted_after_one(self):
        first = runtime.check(self.request_json, dump(self.over_budget_batch()), 0)
        second = runtime.check(self.request_json, dump(self.over_budget_batch()), 1)
        actual = {"first_repairable": first["repairable"], "second_repairable": second["repairable"]}
        expected = "repair_count=1 时不可再修订（全局最多一次）"
        ok = actual["first_repairable"] is True and actual["second_repairable"] is False
        self.observe("C4-03", "额度用尽后不可再次修订", {"repair_count": [0, 1]}, expected, actual, ok)

    def test_c4_04_persistent_failure_stops_with_no_selectable(self):
        still_bad = self.over_budget_batch("230.00")
        state = runtime.recheck(self.request_json, dump(self.over_budget_batch()), dump(still_bad), 0)
        rep = runtime.report(state)
        actual = {"all_passed": state["validation"]["all_passed"], "repair_count": state["repair_count"],
                  "remaining_repairs": rep["remaining_repairs"], "selectable": rep["selectable_candidate_ids"],
                  "report_status": rep["status"], "mentions_repair_count": "已用自动修订次数：1 / 1" in rep["report_text"]}
        expected = "持续失败：all_passed=false、remaining_repairs=0、仍可选 c2/c3、报告如实说明 1/1"
        ok = (actual["all_passed"] is False and actual["repair_count"] == 1 and actual["remaining_repairs"] == 0
              and actual["selectable"] == ["c2", "c3"] and actual["mentions_repair_count"])
        self.observe("C4-04", "持续失败不伪装通过且额度不重置", {"revised c1": "230.00"}, expected, actual, ok)

    def test_c4_05_total_failure_has_no_selectable(self):
        batch = candidates()
        for cand in batch["candidates"]:
            cand["estimated_total"] = "999.00"
        state = runtime.check(self.request_json, dump(batch), 0)
        rep = runtime.report(state)
        actual = {"selectable": rep["selectable_candidate_ids"], "status": rep["status"],
                  "text_tail": rep["report_text"].strip().splitlines()[-1]}
        expected = "全部失败时无可选方案，中文如实提示人工处理"
        ok = actual["selectable"] == [] and "当前没有可选方案" in actual["text_tail"]
        self.observe("C4-05", "全部失败无可选项", {"all totals": "999.00"}, expected, actual, ok)

    def test_c4_06_passed_candidate_tampering_rejected(self):
        tampered = candidates()
        tampered["candidates"][1]["estimated_total"] = "119.00"  # c2 原本已通过，被改动
        state = runtime.recheck(self.request_json, dump(self.over_budget_batch()), dump(tampered), 0)
        rep = runtime.report(state)
        actual = {"workflow_errors": [e["code"] for e in state["workflow_errors"]],
                  "selectable": rep["selectable_candidate_ids"], "status": rep["status"],
                  "all_passed": rep["all_passed"]}
        expected = "PASSED_CANDIDATE_CHANGED；整次修订拒绝用于选择；selectable 为空"
        ok = ("PASSED_CANDIDATE_CHANGED" in actual["workflow_errors"] and actual["selectable"] == []
              and actual["status"] == "failed" and actual["all_passed"] is False)
        self.observe("C4-06", "修订改动已通过项被保护拒绝", {"c2.estimated_total": "120.00 → 119.00"}, expected, actual, ok)

    def test_c4_07_reordered_keys_are_not_tampering(self):
        reordered = candidates()
        shuffled = {k: reordered["candidates"][1][k] for k in reversed(list(reordered["candidates"][1].keys()))}
        reordered["candidates"][1] = shuffled
        state = runtime.recheck(self.request_json, dump(self.over_budget_batch()), dump(reordered), 0)
        actual = {"workflow_errors": [e["code"] for e in state["workflow_errors"]],
                  "all_passed": state["validation"]["all_passed"]}
        expected = "键序变化不算篡改，无 PASSED_CANDIDATE_CHANGED"
        ok = "PASSED_CANDIDATE_CHANGED" not in actual["workflow_errors"] and actual["all_passed"] is True
        self.observe("C4-07", "JSON 键序重排不误判为篡改", {}, expected, actual, ok)

    def test_c4_08_recheck_blocks_when_not_repairable(self):
        state = runtime.recheck(self.request_json, dump(candidates()), dump(self.over_budget_batch()), 0)
        actual = {"workflow_errors": [e["code"] for e in state["workflow_errors"]],
                  "repairable": state["repairable"]}
        expected = "首检已全通过 → REPAIR_NOT_ALLOWED，不采用新候选"
        ok = "REPAIR_NOT_ALLOWED" in actual["workflow_errors"] and actual["repairable"] is False
        self.observe("C4-08", "无需修订时拒绝未经授权的修订", {}, expected, actual, ok)

    def test_c4_09_report_never_selects_for_user(self):
        state = runtime.recheck(self.request_json, dump(self.over_budget_batch()), dump(candidates()), 0)
        rep = runtime.report(state)
        actual = {"selected_candidate_id": rep["selected_candidate_id"],
                  "selectable": rep["selectable_candidate_ids"],
                  "business_data_verification": rep["business_data_verification"]}
        expected = "selected_candidate_id 保持 null；business_data_verification=not_verified"
        ok = actual["selected_candidate_id"] is None and actual["business_data_verification"] == "not_verified" \
            and actual["selectable"] == ["c1", "c2", "c3"]
        self.observe("C4-09", "报告不替用户选择且标注数据未核实", {}, expected, actual, ok)

    def test_c4_10_forbidden_tag_not_repairable_into_selection(self):
        batch = candidates()
        batch["candidates"][0]["tags"] = ["alcohol"]
        state = runtime.check(self.request_json, dump(batch), 0)
        rep = runtime.report(state)
        actual = {"selectable": rep["selectable_candidate_ids"],
                  "c1_errors": codes(next(r for r in state["validation"]["candidate_results"] if r["id"] == "c1")),
                  "report_marks_c1_unselectable": "c1：简洁杯具与杯垫" in rep["report_text"]}
        expected = "禁忌项不可选，仍可选 c2/c3"
        ok = actual["selectable"] == ["c2", "c3"] and "FORBIDDEN_TAG" in actual["c1_errors"]
        self.observe("C4-10", "禁忌项不可选但其他合格项可选", {"c1.tags": ["alcohol"]}, expected, actual, ok)


# --------------------------------------------------- C5 Dify 生成节点一致性


class C5GeneratedNodes(Recorder):
    GROUP = "C5 生成节点与仓库适配一致"

    def test_c5_01_four_entrypoints_match_repository(self):
        request_json = adapt_intake(dump(intake("pursuit")))["request_json"]
        over = candidates()
        over["candidates"][0]["estimated_total"] = "250.00"
        good = candidates()
        results = {}
        intake_main = gen_node("intake_node.py")
        check_main = gen_node("check_node.py")
        recheck_main = gen_node("recheck_node.py")
        report_main = gen_node("report_node.py")
        results["intake"] = intake_main(dump(intake("pursuit")))["status"]
        results["check"] = check_main(request_json, dump(over), 0)["repairable"]
        recheck = recheck_main(request_json, dump(over), dump(good), 0)
        results["recheck_all_passed"] = recheck["all_passed"]
        results["recheck_repair_count"] = recheck["repair_count"]
        report = report_main(recheck["envelope_json"])
        results["report_all_passed"] = report["all_passed"]
        results["report_selected_is_null"] = json.loads(report["envelope_json"])["selected_candidate_id"] is None
        expected = "intake=ready；check repairable；recheck 通过且 repair_count=1；report 通过且未替选"
        ok = (results["intake"] == "ready" and results["check"] is True and results["recheck_all_passed"] is True
              and results["recheck_repair_count"] == 1 and results["report_all_passed"] is True
              and results["report_selected_is_null"] is True)
        self.observe("C5-01", "四个 Dify 入口节点真实执行并与仓库逻辑一致", {}, expected, results, ok)

    def test_c5_02_manifest_matches_generated_artifacts(self):
        import shutil
        manifest = json.loads((ROOT / "workflow/generated/manifest.json").read_text(encoding="utf-8"))
        artifacts = manifest.get("artifacts_sha256") or {}
        actual = {"format": manifest.get("format"), "entries": {}, "mismatches": []}
        # 哈希按 LF 归一化比较，避免 CRLF 检出造成假红（2026-10-31，PM 裁决）：manifest 的摘要口径
        # 由生成器在与记录源码字节形态一致的前提下重算（regen_sha256 仍与记录值逐位相等），
        # 磁盘内容再与重算内容在 LF 归一化后逐字节比对——比只比摘要更强，真实改动仍然 FAIL。
        regen = rebuild_generated_artifacts(manifest.get("sources_sha256") or {})
        try:
            if regen is None:
                actual["mismatches"].append("manifest:sources_sha256")
            else:
                for name, expected_hash in artifacts.items():
                    path = ROOT / "workflow" / "generated" / name
                    if not path.exists():
                        actual["mismatches"].append(name + ":missing")
                        continue
                    raw = path.read_bytes()
                    regen_path = regen["dir"] / name
                    regen_raw = regen_path.read_bytes() if regen_path.is_file() else None
                    entry = {
                        "expected": expected_hash,
                        "actual": hashlib.sha256(raw).hexdigest(),
                        "actual_lf": hashlib.sha256(normalize_eol(raw)).hexdigest(),
                        "regen_sha256": None if regen_raw is None else hashlib.sha256(regen_raw).hexdigest(),
                        "content_equal_after_lf": (regen_raw is not None
                                                   and normalize_eol(raw) == normalize_eol(regen_raw)),
                    }
                    entry["match"] = (entry["content_equal_after_lf"]
                                      and entry["regen_sha256"] == expected_hash)
                    actual["entries"][name] = entry
                    if not entry["match"]:
                        actual["mismatches"].append(name)
                actual["manifest_hash_consistent"] = (
                    regen["manifest"].get("artifacts_sha256") == artifacts)
            expected = ("manifest.format=python-source-not-dsl；5 个生成物摘要与 manifest 记录一致，"
                        "且与生成器按同一源码字节形态重算的内容在 LF 归一化后逐字节相同")
            ok = (actual["format"] == "python-source-not-dsl" and regen is not None
                  and len(actual["entries"]) == 5 and not actual["mismatches"]
                  and actual.get("manifest_hash_consistent") is True)
            self.observe("C5-02", "生成物与 manifest 哈希一致（无 STALE）", {}, expected, actual, ok)
        finally:
            if regen is not None:
                shutil.rmtree(regen["root"], ignore_errors=True)

    def test_c5_03_node_entrypoint_rejects_empty_inputs(self):
        check_main = gen_node("check_node.py")
        result = check_main("", "", 0)
        envelope = json.loads(result["envelope_json"])
        actual = {"status": result["status"], "all_passed": result["all_passed"],
                  "repairable": result["repairable"], "repair_count": result["repair_count"],
                  "validation_codes": sorted({e["code"] for e in envelope["validation"]["errors"]}),
                  "candidate_results": envelope["validation"]["candidate_results"]}
        expected = "status=error、all_passed=false、repairable=false、无候选结果被放行"
        ok = (actual["status"] == "error" and actual["all_passed"] is False and actual["repairable"] is False
              and actual["candidate_results"] == [] and "INVALID_JSON" in actual["validation_codes"])
        self.observe("C5-03", "节点入口收到空输入时不放行任何候选", {"args": ["", "", 0]}, expected, actual, ok)

    def test_c5_04_dispatch_failure_is_chinese_and_consumes_quota(self):
        """真正的工作流变量损坏路径：Code 节点调度器异常兜底。"""
        namespace = {}
        exec(compile((ROOT / "workflow/generated/code_node.py").read_text(encoding="utf-8"),
                     "code_node.py", "exec"), namespace)
        dispatch = namespace["main"]
        broken = dispatch("check", "{")
        bad_action = dispatch("nope", "{}")
        actual = {
            "broken_payload": {"status": broken["status"], "all_passed": broken["all_passed"],
                               "repairable": broken["repairable"], "repair_count": broken["repair_count"],
                               "envelope": json.loads(broken["envelope_json"])},
            "bad_action": {"status": bad_action["status"], "envelope": json.loads(bad_action["envelope_json"])},
        }
        expected = "WORKFLOW_INPUT_ERROR 中文受控失败、不放行、repair_count 记为 1（不无限重试）"
        ok = all(
            item["status"] == "error"
            and item["envelope"]["errors"][0]["code"] == "WORKFLOW_INPUT_ERROR"
            and "工作流变量无效" in item["envelope"]["errors"][0]["message"]
            for item in (actual["broken_payload"], actual["bad_action"])
        ) and actual["broken_payload"]["repairable"] is False and actual["broken_payload"]["repair_count"] == 1
        self.observe("C5-04", "调度器异常为中文受控失败且不重试", {"payload_json": "{"}, expected, actual, ok)


# ------------------------------------------------------------ C6 记录方案


class C6Metrics(Recorder):
    GROUP = "C6 调用次数／延迟／成本记录方案"

    def test_c6_01_offline_pipeline_records_calls_latency_cost(self):
        """离线全链路记录：真实测量延迟，调用次数如实为 0，成本标未知而非 0。"""
        record = {"mode": "offline-fixed-snapshots-no-model", "model_calls": 0, "cloud_verified": False,
                  "cost": "not_measured", "stages": []}
        t0 = time.monotonic()
        request_json = adapt_intake(dump(intake("pursuit")))["request_json"]
        record["stages"].append({"stage": "intake", "seconds": round(time.monotonic() - t0, 6)})
        t1 = time.monotonic()
        over = candidates()
        over["candidates"][0]["estimated_total"] = "250.00"
        state = runtime.check(request_json, dump(over), 0)
        record["stages"].append({"stage": "check_first", "seconds": round(time.monotonic() - t1, 6)})
        t2 = time.monotonic()
        state = runtime.recheck(request_json, dump(over), dump(candidates()), 0)
        record["stages"].append({"stage": "recheck", "seconds": round(time.monotonic() - t2, 6)})
        t3 = time.monotonic()
        rep = runtime.report(state)
        record["stages"].append({"stage": "report", "seconds": round(time.monotonic() - t3, 6)})
        record["total_seconds"] = round(sum(s["seconds"] for s in record["stages"]), 6)
        record["all_passed"] = rep["all_passed"]
        actual = record
        expected = ("model_calls=0（真实未调用）；每阶段有 monotonic 实测秒数；"
                    "cost 记 not_measured 不填 0；cloud_verified=false")
        ok = (actual["model_calls"] == 0 and all(isinstance(s["seconds"], float) for s in actual["stages"])
              and actual["cost"] == "not_measured" and actual["cloud_verified"] is False and actual["all_passed"] is True)
        self.observe("C6-01", "记录调用次数／延迟／成本（离线真实测量）", {}, expected, actual, ok)

    def test_c6_02_dify_run_record_exists_and_is_traceable(self):
        if not EVIDENCE_PATH.exists():
            self.skipTest("缺少独立 Dify 证据")
        ev = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))
        run = (ev.get("run_sse") or {}).get("parsed") or {}
        actual = {
            "workflow_run_id": run.get("workflow_run_id"),
            "trace_runs_status": ((ev.get("trace_runs") or {}).get("body") or {}).get("status"),
            "node_last_run_http": (ev.get("node_last_run") or {}).get("status"),
            "raw_log_present": (ROOT / "docs/test-reports/stage-c/evidence/qa-runner-log.jsonl").exists(),
        }
        expected = "有可追溯 run id；平台 trace 为 not_collected 需如实记录；节点 last-run 接口 200"
        ok = bool(actual["workflow_run_id"]) and actual["trace_runs_status"] == "not_collected" \
            and actual["node_last_run_http"] == 200 and actual["raw_log_present"] is True
        self.observe("C6-02", "Dify 运行可追溯且 trace 缺口如实记录", {}, expected, actual, ok)


if __name__ == "__main__":
    unittest.main(verbosity=2)
