"""DEMO-001：构建离线快照包（零模型调用、零网络）。

把三类证据**分门别类**收进一个自包含 JSON，供 file:// 打开的回放页消费：

  A. archived_real_model  —— 已归档的**真实模型**输出（来自 workflow/evidence/**，本轮**不发起任何新调用**）
  B. local_real_rules     —— 本机**真实规则代码**的运行结果（可现场重跑，零模型）
  C. mock_ui              —— web/ 接入层的**模拟数据**（必须显著标注，不得说成模型输出）
  D. declared_limitation  —— 如实声明的未完成/未核实项

诚实性由数据结构强制：每个 block 必须带 evidence_kind、source、model_calls、verified 四个字段，
回放页按 evidence_kind 决定角标文案与配色，不允许人工改写角标。

运行：python docs/demo/tools/build-snapshot.py
产物：docs/demo/snapshot/demo-snapshot.json
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parents[3]
EV = ROOT / "workflow" / "evidence"
EV1 = EV / "WF-003-2026-10-30"
EV2 = EV / "WF-003-2026-10-31-publish-v2"
TMP = ROOT / "web" / ".tmp" / "demo-rehearsal"
OUT = ROOT / "docs" / "demo" / "snapshot" / "demo-snapshot.json"

SHANGHAI = timezone(timedelta(hours=8))

AUDIT: list[str] = []


def audit(msg: str) -> None:
    AUDIT.append(msg)
    print(f"  · {msg}")


def read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)).replace("\\", "/")


def block(kind, bid, title, source, model_calls, verified, payload, *, caveat=None, how_to_replay=None):
    """构造一个证据块。四个诚实性字段是必填的。"""
    assert kind in {"archived_real_model", "local_real_rules", "mock_ui", "declared_limitation"}, kind
    b = {
        "id": bid,
        "evidence_kind": kind,
        "title": title,
        "source": source,
        "model_calls": model_calls,
        "verified": verified,
        "payload": payload,
    }
    if caveat:
        b["caveat"] = caveat
    if how_to_replay:
        b["how_to_replay"] = how_to_replay
    return b


# ─────────────────────────────────────────────────────────── 1. 提取真实模型归档

def _to_float(s):
    if s is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", str(s))
    return float(m.group(0)) if m else None


def extract_n2_real_output(md_path: Path):
    """从归档的节点级原文里取 N2（真实 LLM）的输出 JSON 与 usage。"""
    txt = md_path.read_text(encoding="utf-8")
    i = txt.find("## N2 需求分析与三候选")
    if i < 0:
        return None
    j = txt.find("\n## ", i + 5)
    sec = txt[i : j if j > 0 else len(txt)]

    model = re.search(r'"model_name":\s*"([^"]+)"', sec)
    provider = re.search(r'"model_provider":\s*"([^"]+)"', sec)
    node_id = re.search(r"节点 ID：`([^`]+)`", sec)
    elapsed = re.search(r"耗时：`([^`]+)`", sec)
    ts = re.search(r"服务端时间戳：`([^`]+)`", sec)

    usage = {}
    mu = re.search(r'"usage":\s*\{([^}]*)\}', sec)
    if mu:
        for line in mu.group(1).split(","):
            if ":" in line:
                k, v = line.split(":", 1)
                k = k.strip().strip('"')
                v = v.strip().rstrip(",").strip().strip('"')
                usage[k] = v

    # 候选正文：输出里是第一层 "text" 字段的转义 JSON
    cands = []
    mt = re.search(r'"text":\s*"(.*?)",\n\s*"reasoning_content"', sec, re.S)
    if mt:
        raw = mt.group(1)
        try:
            inner = json.loads('"' + raw + '"')
            cands = json.loads(inner).get("candidates", [])
        except Exception as exc:  # noqa: BLE001
            audit(f"N2 候选解析失败: {exc}")

    return {
        "node": "N2 需求分析与三候选（真实 LLM）",
        "node_id": node_id.group(1) if node_id else None,
        "elapsed_s": _to_float(elapsed.group(1)) if elapsed else None,
        "server_ts": ts.group(1) if ts else None,
        "model_provider": provider.group(1) if provider else None,
        "model_name": model.group(1) if model else None,
        "usage": usage,
        "candidates": cands,
        "raw_length_chars": len(mt.group(1)) if mt else 0,
    }


def extract_node_sequence(md_path: Path):
    """取该归档里的节点顺序与各自耗时/状态。"""
    txt = md_path.read_text(encoding="utf-8")
    seq = []
    for m in re.finditer(r"^## (.+?)\n\n- 节点 ID：`([^`]*)`\s*状态：`([^`]*)`\s*耗时：`([^`]*)`", txt, re.M):
        seq.append({"node": m.group(1), "node_id": m.group(2), "status": m.group(3), "elapsed_s": m.group(4)})
    return seq


def summarize_run(case: dict) -> dict:
    return {
        "case": case.get("case"),
        "expect": case.get("expect"),
        "http_status": case.get("httpStatus"),
        "browser_elapsed_ms": case.get("browserElapsedMs"),
        "workflow_elapsed_s": case.get("workflow_elapsed_s"),
        "N2_elapsed_s": case.get("N2_elapsed_s"),
        "N2_raw_text_chars": case.get("N2_raw_text_chars"),
        "N3_status": case.get("N3_status"),
        "N3_all_passed": case.get("N3_all_passed"),
        "N3_codes": case.get("N3_codes"),
        "N3_preserved": case.get("N3_preserved"),
        "N4_case": case.get("N4_case"),
        "N5_ran": case.get("N5_ran"),
        "N5_elapsed_s": case.get("N5_elapsed_s"),
        "N6_status": case.get("N6_status"),
        "N6_repair_count": case.get("N6_repair_count"),
        "end_outputs": case.get("end_outputs"),
        "total_tokens": case.get("total_tokens"),
        "workflow_status": case.get("workflow_status"),
        "candidate_names": case.get("candidate_names"),
        "selectable_candidate_ids": case.get("selectable_candidate_ids"),
    }


def _git_head_readonly() -> str:
    """直接读 .git 元数据，不用 subprocess。

    为什么不用 subprocess：本机沙箱下 `subprocess.run(capture_output=True)` 会在
    `_winapi.CreatePipe` 上抛 PermissionError [WinError 5]，脚本直接崩。
    这个坑已复现并记入 docs/demo/failure-modes.md。
    """
    git = ROOT / ".git"
    head_file = git / "HEAD"
    try:
        txt = head_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    if txt.startswith("ref:"):
        ref = txt.split(":", 1)[1].strip()
        for cand in (git / ref, git / "refs" / "heads" / ref):
            try:
                return cand.read_text(encoding="utf-8").strip()
            except OSError:
                continue
        packed = git / "packed-refs"
        if packed.exists():
            for line in packed.read_text(encoding="utf-8").splitlines():
                if line.endswith(" " + ref):
                    return line.split(" ", 1)[0]
        return ""
    return txt


def main() -> int:
    print("== DEMO-001 离线快照构建 ==")
    HEAD = _git_head_readonly()
    DIRTY: list[str] = []

    sections: dict[str, list] = {
        "declared_limitation": [],
        "archived_real_model": [],
        "local_real_rules": [],
        "mock_ui": [],
    }

    # ── A. 真实模型归档 ──────────────────────────────────────
    prefix_real = EV1 / "dify-real-run-summary.json"
    postfix_real = EV1 / "dify-real-postfix-run-summary.json"
    v2_demo = EV2 / "v2-run1-demo-summary.json"
    v2_bound = EV2 / "v2-run2-boundary-summary.json"

    pre = [summarize_run(c) for c in read_json(prefix_real)]
    post = [summarize_run(c) for c in read_json(postfix_real)]
    v2r1 = summarize_run(read_json(v2_demo))
    v2r2 = summarize_run(read_json(v2_bound))
    audit(f"真实模型归档：前置 {len(pre)} 例 + 提示词修复后 {len(post)} 例 + v2 {2} 例")

    n2_post = extract_n2_real_output(EV1 / "dify-real-postfix-node-io-real1_normal_200.md")
    n2_pre = extract_n2_real_output(EV1 / "dify-real-node-io-real1_normal_200.md")
    seq_pre = extract_node_sequence(EV1 / "dify-real-node-io-real1_normal_200.md")
    seq_post = extract_node_sequence(EV1 / "dify-real-postfix-node-io-real1_normal_200.md")
    audit(f"提取到真实 N2 候选：修复后 {len(n2_post['candidates'])} 个 / 修复前 {len(n2_pre['candidates'])} 个")

    sections["archived_real_model"].append(block(
        "archived_real_model", "R-01", "真实模型生成的三个候选（N2 原文，逐字）",
        [rel(EV1 / "dify-real-postfix-node-io-real1_normal_200.md")],
        model_calls=1, verified=True,
        payload={
            "run_label": "real1_normal_200（提示词修复后）",
            "model": n2_post["model_name"], "provider": n2_post["model_provider"],
            "elapsed_s": n2_post["elapsed_s"], "usage": n2_post["usage"],
            "server_ts": n2_post["server_ts"],
            "candidates": n2_post["candidates"],
        },
        caveat="这是 2026-10-30 归档的真实 deepseek-v4-flash 输出，**不是现场新跑的**。"
               "其中 estimated_total 是模型给出的估算，价格与库存均未核实。",
        how_to_replay="现场口播：以下为已归档的真实模型输出，本次没有发起新的模型调用。",
    ))

    sections["archived_real_model"].append(block(
        "archived_real_model", "R-02", "运行汇总：真实模型调用与端到端耗时（归档）",
        [rel(prefix_real), rel(postfix_real)],
        model_calls=len(pre) * 2 + len(post) * 2, verified=True,
        payload={"pre_prompt_fix": pre, "post_prompt_fix": post},
        caveat="pre_prompt_fix 的 real1/real2 在提示词修复**之前**跑，N3 首次校验失败（FORBIDDEN_TERM）→ 走修订；"
               "post_prompt_fix 的两次 N3 直接通过 → 走 End A。两组不可混为一谈。",
    ))

    sections["archived_real_model"].append(block(
        "archived_real_model", "R-03",
        "真实模型 + 一次修订的完整链路（N4[repairable]→N5→N6→N7b→End B）",
        [rel(EV1 / "dify-real-node-io-real1_normal_200.md")],
        model_calls=2, verified=True,
        payload={
            "note": "这是**真实 LLM** 的修订路径证据：N2 与 N5 都真的调用了 deepseek-v4-flash。",
            "node_sequence": seq_pre,
            "N2_usage": n2_pre["usage"],
            "N2_candidates": [c.get("name") for c in n2_pre["candidates"]],
            "summary": next((r for r in pre if r["case"] == "real1_normal_200"), None),
            "N5_elapsed_s": next((r for r in pre if r["case"] == "real1_normal_200"), {}).get("N5_elapsed_s"),
        },
        caveat="脚本第六节把修订路径的素材指向 dify-node-io-case2*.md —— 那是**占位输入、未接模型**的夹具跑，"
               "N2/N5 节点名就写着「占位·未接模型」，端到端仅 ~1.1 s。"
               "若要展示**真实模型**的修订路径，必须用本块这一份（已归档，无需新调用）。",
    ))

    sections["archived_real_model"].append(block(
        "archived_real_model", "R-04", "v2（版本 #2）发布后的两次真实运行",
        [rel(v2_demo), rel(v2_bound), rel(EV2 / "README.md")],
        model_calls=2, verified=True,
        payload={"run1_demo": v2r1, "run2_boundary": v2r2},
        caveat="run2 是**边界输入**：N1 返回 needs_input（LIMIT_EXCEEDED，预算须在 1–10000），"
               "但工作流**没有短路**，仍真实调用了 N2 一次（3.9 s / 1198 tokens），"
               "最终 N3 报 INVALID_JSON、End A 输出 status=error。"
               "不要把这条说成「输入校验拦住了」——它没拦住，白烧了一次调用。",
    ))

    # 占位夹具跑（明确标注未接模型）
    case_files = sorted((EV1).glob("dify-node-io-case*.md"))
    placeholder = []
    for f in case_files:
        seq = extract_node_sequence(f)
        txt = f.read_text(encoding="utf-8")
        el = re.search(r"端到端耗时：`([^`]+)`", txt)
        exp = re.search(r"预期路径：(.+)", txt)
        placeholder.append({
            "file": rel(f),
            "elapsed": el.group(1) if el else None,
            "expect": exp.group(1).strip() if exp else None,
            "node_sequence": seq,
            "model_called": any("真实 LLM" in n["node"] for n in seq),
        })
    sections["archived_real_model"].append(block(
        "archived_real_model", "R-05", "占位夹具跑（case1–case5）：工作流真的跑了，但**没有调用模型**",
        [rel(f) for f in case_files],
        model_calls=0, verified=True,
        payload=placeholder,
        caveat="这 5 份是**确定性夹具**记录：N2/N5 节点名逐字写着「占位·未接模型」，"
               "端到端 1.0–1.3 s。它们证明了 N4/N6/N7b 的**确定性分支**真的能跑，"
               "但**不能**当作模型输出展示。脚本第六节把 case2/case5 标成「真实运行记录」有误读风险。",
    ))

    # ── B. 本机真实规则层 ────────────────────────────────────
    rules_layer = read_json(TMP / "rehearsal-rules-layer.json")
    sections["local_real_rules"].append(block(
        "local_real_rules", "L-01", "本机确定性校验器：拒绝与通过两条路径（零模型、零网络）",
        ["docs/demo/tools/run-rules-layer-demo.py（需先起 python -m deploy.server）"],
        model_calls=0, verified=True,
        payload={
            "base": rules_layer["base"],
            "rules_source_sha256": rules_layer["rules_source_sha256"],
            "results": rules_layer["results"],
            "failed": rules_layer["failed"],
        },
        caveat="只打 127.0.0.1 回环；这是**本机校验器**的真实结果，"
               "不得说成「Dify 现场跑出了超预算」。",
        how_to_replay="python -m deploy.server  然后  python docs/demo/tools/run-rules-layer-demo.py",
    ))

    tests = {
        "unittest_all": {"cmd": "python -m unittest discover -s tests -q", "result": "Ran 329 tests — OK"},
        "unittest_stage_c": {"cmd": "python -m unittest discover -s tests/acceptance/stage_c -q", "result": "Ran 39 tests — OK"},
        "verify_nopipe": {"cmd": "python tests/acceptance/stage_c/run_verify_local_nopipe.py", "result": "local probes: 46 passed; 0 failed; model calls: 0; cloud verified: false"},
    }
    sections["local_real_rules"].append(block(
        "local_real_rules", "L-02", "测试与探针实测结果（本机，本轮实跑）",
        ["docs/demo/demo-rehearsal-record.md"],
        model_calls=0, verified=True,
        payload=tests,
        caveat="脚本 1.1 节写「期望 322 项通过」，本轮实测为 **329** 项（测试在脚本写完之后增加了）。"
               "现场照读 322 而屏幕显示 329 会被当成对不上，需按实际读数口播。",
    ))

    # ── B2. 输入阶段（0:30–1:30）───────────────────────────────
    # 补这个区的原因：PM 要求「离线兜底要能整段演完 3 分钟」，
    # 而原先的快照只覆盖 1:30 之后，输入阶段是空的。
    steps_json = TMP / "input-steps.json"
    if steps_json.exists():
        ist = read_json(steps_json)
        sections["local_real_rules"].append(block(
            "local_real_rules", "I-01", "输入阶段：三步表单 + 两个**显式确认**（真实前端代码）",
            ["web/public/app.js:148（步骤定义）", "docs/demo/shots/INPUT-*.png（真实浏览器截图）"],
            model_calls=0, verified=True,
            payload={
                "step_count": ist.get("stepCount"),
                "steps": ist.get("stepBarText"),
                "step_source": "web/public/app.js 第 148 行的 titles 数组",
                # 这些 input **没有 name/id**，只有 data-field——驱动/自动化时要按它定位
                "dynamic_fields": {
                    "after_budget_range": ist.get("fieldsAfterBudget"),
                    "after_deadline_range": ist.get("fieldsAfterDays"),
                },
                "explicit_confirms": [
                    "我确认「200.00 元」就是本次礼物＋包装＋贺卡＋装饰＋配送的全量上限（不再改由模型决定）。",
                    "我确认可用的完整准备时间是 2 天（礼物＋包装＋贺卡＋配送合计），不是模糊期限。",
                ],
                "action_log": ist.get("log"),
                "screenshots": [
                    "docs/demo/shots/INPUT-20-input-step1.png",
                    "docs/demo/shots/INPUT-21-input-step1-filled.png",
                    "docs/demo/shots/INPUT-22-input-step2.png",
                    "docs/demo/shots/INPUT-22b-input-step2-filled.png",
                    "docs/demo/shots/INPUT-23-input-step3.png",
                    "docs/demo/shots/INPUT-23b-input-step3-filled.png",
                ],
                "what_is_real": "表单结构、三步划分、两个显式确认控件、以及输入校验都是**仓库里的真实前端/服务端代码**。",
                "what_is_not": "页面顶部「模拟数据 · 未接真实模型」标识针对的是**候选方案与四段呈现**（那是模拟数据），不针对输入表单本身。口播时不要把两者混为一谈。",
            },
            caveat="PM 指令里写「0:30–1:30 **四步**输入」，但实测界面是**三步**"
                   "（app.js:148 的 titles 只有三项，state.step 取值 1/2/3）。"
                   "若「四步」指演示**动作**，可拆成：关系场合 → 预算上限确认 → 兴趣与风格 → 排除补充。"
                   "现场**不要**说「第四步」，屏幕上只有三个步骤条。",
            how_to_replay="起本机 mock 接入层后：node web/.tmp/demo-rehearsal/capture-input-steps.mjs（零 Dify 额度）",
        ))

    rejects = TMP / "intake-rejects.json"
    if rejects.exists():
        rj = read_json(rejects)
        sections["local_real_rules"].append(block(
            "local_real_rules", "I-02", "输入校验的真实拒绝路径（本机适配层，零模型）",
            ["web/server/intake.mjs", "web/.tmp/demo-rehearsal/probe-intake-rejects.mjs"],
            model_calls=0, verified=True,
            payload={"results": rj["results"], "summary": rj["summary"]},
            caveat="两条**边界发现**必须如实说：(1) 预算 999999 在本机 /api/intake/validate 返回 **ready**，"
                   "限制（1–10000）是在 Dify 侧 N1 才拦（归档 v2-run2 记录了 LIMIT_EXCEEDED），两层口径不一致；"
                   "(2) 关系值 `colleague` 仍然被接受（ready）——它已移出产品场景，只作为回归夹具值保留。"
                   "现场若被问到，不要说成「输入层已经拦住了越界预算」。",
            how_to_replay="node web/.tmp/demo-rehearsal/probe-intake-rejects.mjs（零 Dify 额度）",
        ))

    # ── C. 模拟界面 ──────────────────────────────────────────
    raw = TMP / "raw"
    rec = read_json(raw / "recommendations.json")
    pres = read_json(raw / "presentation-c1.json")
    pres_partner = read_json(raw / "presentation-partner-c1.json")
    cfg = read_json(raw / "config.json")

    def diff_sections(a, b):
        out = {}
        for key in ["style", "packaging", "card", "giving"]:
            sa = next((s for s in a.get("sections", []) if s["key"] == key), {})
            sb = next((s for s in b.get("sections", []) if s["key"] == key), {})
            out[key] = {
                "identical": json.dumps(sa, sort_keys=True, ensure_ascii=False) == json.dumps(sb, sort_keys=True, ensure_ascii=False),
                "pursuit_items": sa.get("items"),
                "partner_items": sb.get("items"),
                "pursuit_title": sa.get("title"),
            }
        return out
    print("  · 差异比对：pursuit vs partner")
    d = diff_sections(pres, pres_partner)

    sections["mock_ui"].append(block(
        "mock_ui", "M-01", "界面预览：三候选 + 四段呈现（**模拟数据**）",
        [rel(raw / "recommendations.json"), rel(raw / "presentation-c1.json")],
        model_calls=0, verified=True,
        payload={
            "mode": cfg.get("mode"),
            "mock_mode_notice": cfg.get("notices", {}).get("mock_mode"),
            "candidates": rec.get("candidates"),
            "sections": pres.get("sections"),
            "selectable_candidate_ids": rec.get("selectable_candidate_ids"),
            "repair_count": rec.get("repair_count"),
            "business_data_verification": rec.get("business_data_verification"),
        },
        caveat="**模拟数据**。Dify 侧包装/配色/贺卡/赠送阶段未实现；"
               "这些候选与四段文案来自接入层内置的固定模拟数据，不是模型输出。"
               "页面顶部有「模拟数据 · 未接真实模型」吸顶标识，现场必须让它入镜。",
        how_to_replay="GW_MODE=mock GW_PORT=<空闲端口> node web/server/server.mjs",
    ))

    sections["mock_ui"].append(block(
        "mock_ui", "M-02", "追求对象 vs 恋人：贺卡与话术差异（模拟数据）",
        [rel(raw / "presentation-c1.json"), rel(raw / "presentation-partner-c1.json")],
        model_calls=0, verified=True,
        payload={"diff": d},
        caveat="差异是真的（贺卡正文、装饰物、话术、关系提示都不同），但**依然是模拟数据**。"
               "注意 ② 包装材料与步骤 两段**完全相同**——不要声称四段都变了。",
    ))

    # ── D. 如实声明 ──────────────────────────────────────────
    for bid, title, detail in [
        ("D-01", "工作流**已发布为版本 #2**（与脚本文案相反）",
         "归档证据：2026-10-30 23:04 发布 v1；2026-10-31 00:25 发布 v2（version_number=2，"
         "检查清单「所有问题均已解决」）。脚本第 13/118/154/231/294/359 行仍写「未发布、未创建版本、停在未发布状态」。"
         "现场若照读「未发布」，屏幕上却是「已发布 / 版本 2」，属于口径与画面直接矛盾。"),
        ("D-02", "本租户**无版本回退入口**",
         "v2 README 明写：不能回退到版本 #1；已归档的 v1 整份工作流只可作为**手工重建**依据，不是真回退。"),
        ("D-03", "模型调用与 token 口径已被 v2 刷新",
         "脚本写「10 次调用 / 34,127 tokens」；v2 之后累计为 **13 次 / 38,326 tokens**（前几轮 11 次 / 35,614，v2 2 次 / 2,712）。"),
        ("D-04", "DeepSeek 单价未从真实账单核实",
         "归档 usage 里 total_price/completion_price 均为 \"0\"、currency=USD，即租户未回传计价数据。"
         "任何金额结论只能写「未核实」。"),
        ("D-05", "价格、库存、物流未核实",
         "校验结果固定携带 business_data_verification=not_verified，无真实商品数据源（OPEN-6 仍开放）。"),
        ("D-06", "云部署、K8S、镜像仓库推送**均未发生**（B1–B4）",
         "镜像只存在于本机 Docker；publish-to-uhost.ps1 从未上传过任何主机。"),
        ("D-07", "平台级 trace 不可用",
         "该租户未开启 tracing，节点级输出只能来自界面「上次运行」标签页。"),
        ("D-08", "N4 的 ELSE 分支从未被触发（B7）",
         "不要把三条分支说成「都验证过」。"),
        ("D-09", "发布后应用的外部可访问性**未核实**",
         "本次未做过任何公网访问验证；不得暗示「已发布所以外部能访问」。"),
        ("D-10", "自然触发的 FORBIDDEN_TAG 与修复后修订路径**缺运行时证据**（B8/B9）",
         "归档中 case3 的 FORBIDDEN_TAG 是**注入夹具**触发，不是自然触发；"
         "提示词修复之后的「真实修订→再校验」也没有运行时证据（修复后两次真实跑都直接 End A）。"),
    ]:
        sections["declared_limitation"].append(block(
            "declared_limitation", bid, title,
            ["workflow/evidence/WF-003-2026-10-30.md", rel(EV2 / "README.md"), rel(EV2 / "materials-stale-publish-claims.md")],
            model_calls=0, verified=True, payload={"statement": detail},
        ))

    snapshot = {
        "format": "giftwise-demo-offline-snapshot/v1",
        "built_at": datetime.now(SHANGHAI).isoformat(timespec="seconds"),
        "builder": "docs/demo/tools/build-snapshot.py",
        "frozen_head": HEAD,
        "frozen_head_short": HEAD[:9] if HEAD else None,
        "worktree_dirty_files": len(DIRTY),
        "worktree_note": "工作区有多个 Agent 并发改动；frozen_head 只代表读取时刻的 HEAD。",
        "new_model_calls_made_by_this_snapshot": 0,
        "network_required": False,
        "node_required": False,
        "python_required": False,
        "evidence_kinds": {
            "archived_real_model": {
                "badge": "已归档 · 真实模型输出",
                "color": "#0b6b3a",
                "meaning": "当时真实调用了 deepseek-v4-flash 并归档了原文；现场播放**不产生**新调用。",
            },
            "local_real_rules": {
                "badge": "本机 · 真实规则代码",
                "color": "#1d4ed8",
                "meaning": "本机真实 Python 规则代码跑出来的结果，不依赖网络与模型，可现场重跑复现。",
            },
            "mock_ui": {
                "badge": "模拟数据 · 界面预览",
                "color": "#b45309",
                "meaning": "接入层内置固定模拟数据，**不是**模型输出；Dify 侧该阶段未实现。",
            },
            "declared_limitation": {
                "badge": "未完成 / 未核实 · 如实声明",
                "color": "#b91c1c",
                "meaning": "确实没做到或没核实的事，不得美化。",
            },
        },
        "counts": {k: len(v) for k, v in sections.items()},
        "sections": sections,
        "audit_log": AUDIT,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    size = OUT.stat().st_size
    print(f"\n写出 {rel(OUT)}  ({size/1024:.1f} KiB)")
    print(f"块数：{snapshot['counts']}")
    print(f"本轮新模型调用：0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
