# -*- coding: utf-8 -*-
"""沙箱证明：给关系枚举加一个 `boss`（职场上司）值，不修改任何生产文件。

对比对象（都按文件路径加载，保证比的是真实文件）：
  A 冻结版  workflow/labels.py         （只读，从仓库路径直接读）
  B 变体版  bossfix/variant/labels.py  （副本 + 一行新增）

证明内容：
  §1 现状取证：冻结版 RELATIONS 的 10 个键逐字列出，并证明"含上司语义的值 = 0 个"
  §2 新值生效：提交 recipient_relation="boss" 由 INTAKE_UNKNOWN_LABEL 变为 ready
  §3 旧值回归：既有 10 个值在冻结版／变体版下 request_json 与 errors 逐字节相同
  §4 哪些分支真的换挡：boss 与 other 的差别，以及"职场分寸"分支是否自动生效
  §5 测试影响：逐条重放会因 11 个值而失败的断言，给出实际值／期望值／应改成什么
  §6 生成物与版本指纹：labels.py 哈希变化 → 5 个生成物必须重建

用法： python bossfix/prove.py
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "bossfix" / "evidence"
EVIDENCE.mkdir(parents=True, exist_ok=True)

ORIG_LABELS = ROOT / "workflow" / "labels.py"
VAR_LABELS = ROOT / "bossfix" / "variant" / "labels.py"
ORIG_MJS = ROOT / "web" / "server" / "labels.mjs"
VAR_MJS = ROOT / "bossfix" / "variant" / "labels.mjs"

LINE = "=" * 78
report = []          # 人类可读报告
result = {}          # 结构化结果


def say(text=""):
    report.append(text)
    print(text)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


# ----------------------------------------------------------------- 载入
orig_labels = load_module("bossfix_orig_labels", ORIG_LABELS)
var_labels = load_module("bossfix_var_labels", VAR_LABELS)

sys.path.insert(0, str(ROOT))
from workflow.intake import adapt_intake  # noqa: E402
from workflow import labels as prod_labels_mod  # noqa: E402

BOSS_KEYS = ("上司", "领导", "老板", "上级", "主管")


def intake_with(relations_table, relation, **overrides):
    """在给定关系表下调用生产 adapt_intake；用完立刻还原，绝不改生产文件。"""
    payload = {
        "recipient_relation": relation,
        "closeness": "familiar",
        "occasion": "birthday",
        "budget_amount": "200.00",
        "currency": "CNY",
        "deadline_days": 2,
        "interests": ["coffee_food"],
        "interest_confidence": {"coffee_food": "confirmed"},
        "gift_styles": ["practical"],
        "hard_exclusions": {"tags": ["alcohol"], "terms": ["酒"], "unresolved": []},
        "additional_context": "希望低调一些",
    }
    payload.update(overrides)
    original = adapt_intake.__globals__["RELATIONS"]
    try:
        adapt_intake.__globals__["RELATIONS"] = relations_table
        return adapt_intake(dump(payload))
    finally:
        adapt_intake.__globals__["RELATIONS"] = original


# ================================================================= §1 现状取证
say(LINE)
say("§1 现状取证：冻结版 workflow/labels.py 的 RELATIONS 逐字清单")
say(LINE)

raw_lines = ORIG_LABELS.read_text(encoding="utf-8").splitlines()
relations_lineno = None
for index, text in enumerate(raw_lines, start=1):
    if text.startswith("RELATIONS = "):
        relations_lineno = index
        break

say(f"文件：workflow/labels.py   RELATIONS 定义行：第 {relations_lineno} 行")
say(f"键数量：{len(orig_labels.RELATIONS)}")
say("")
say("  #  机器值 ID          中文（逐字）")
for i, (key, zh) in enumerate(orig_labels.RELATIONS.items(), start=1):
    say(f"  {i:<2} {key:<18} {zh}")

boss_hits = {
    key: zh for key, zh in orig_labels.RELATIONS.items()
    if any(token in zh for token in BOSS_KEYS)
}
say("")
say(f"含「{'/'.join(BOSS_KEYS)}」任一语义的值 = {boss_hits if boss_hits else '{}  ← 空'}")
say(f"结论：{len(orig_labels.RELATIONS)} 个关系值里，表示「职场上司」的值有 {len(boss_hits)} 个。")

# 注释里对上司是否提及
comment_mentions = [text for text in raw_lines if any(t in text for t in BOSS_KEYS)]
say(f"labels.py 注释／文档串中提及上司语义的行数 = {len(comment_mentions)}")

result["s1_enum_before"] = {
    "file": "workflow/labels.py",
    "relations_lineno": relations_lineno,
    "count": len(orig_labels.RELATIONS),
    "table": dict(orig_labels.RELATIONS),
    "boss_semantic_values": boss_hits,
    "comment_mentions": comment_mentions,
}

# ================================================================= §2 新值生效
say("")
say(LINE)
say("§2 新值生效证明：提交 recipient_relation=\"boss\" 的前后对比")
say(LINE)

before = intake_with(orig_labels.RELATIONS, "boss")
after = intake_with(var_labels.RELATIONS, "boss")


def codes_of(out):
    return sorted(e["code"] for e in out["errors"])


say(f"  冻结版：status={before['status']:<12} codes={codes_of(before)}")
say(f"  变体版：status={after['status']:<12} codes={codes_of(after)}")

after_req = json.loads(after["request_json"]) if after["request_json"] else None
say("")
if after_req:
    say(f"  变体版 request.recipient_relation    = {after_req['recipient_relation']!r}")
    say(f"  变体版 request.recipient_relation_id = {after_req['recipient_relation_id']!r}")
say(f"  变体版英文键已加入 RELATIONS = {'boss' in var_labels.RELATIONS}")
say(f"  变体版 RELATIONS 键数 = {len(var_labels.RELATIONS)}（冻结版 {len(orig_labels.RELATIONS)}）")

turned_on = before["status"] == "needs_input" and after["status"] == "ready"
say("")
say("  生效的代码分支：")
say("    workflow/intake.py:50-57  choice(\"recipient_relation\", RELATIONS)")
say("      → 该值不在 RELATIONS 时发 INTAKE_UNKNOWN_LABEL 并回退；在表内则直接通过。")
say("    workflow/intake.py:120-121 RELATIONS.get() / recipient_relation_id 透出")
say("      → 中文变为「职场上司」，机器值变为 boss（原来是「其他」/other）。")
say("    判定：这是唯一因新值而换挡的 intake 分支。")

result["s2_boss_accepted"] = {
    "frozen": {"status": before["status"], "codes": codes_of(before)},
    "variant": {"status": after["status"], "codes": codes_of(after)},
    "variant_request_recipient_relation": (after_req or {}).get("recipient_relation"),
    "variant_request_recipient_relation_id": (after_req or {}).get("recipient_relation_id"),
    "branch_turned_on": turned_on,
}

# ================================================================= §3 旧值回归
say("")
say(LINE)
say("§3 回归证明：既有 10 个值的行为逐字节不变")
say(LINE)

regression = []
say(f"  {'关系值':<18}{'冻结版':<26}{'变体版':<26}{'一致':<6}")
for key in orig_labels.RELATIONS:
    a = intake_with(orig_labels.RELATIONS, key)
    b = intake_with(var_labels.RELATIONS, key)
    same_status = a["status"] == b["status"]
    same_errors = dump(a["errors"]) == dump(b["errors"])
    same_request = a["request_json"] == b["request_json"]
    same = same_status and same_errors and same_request
    regression.append({
        "relation": key,
        "frozen_status": a["status"],
        "variant_status": b["status"],
        "status_identical": same_status,
        "errors_identical": same_errors,
        "request_json_identical": same_request,
        "identical": same,
    })
    say(f"  {key:<18}{a['status']:<26}{b['status']:<26}{'是' if same else '否':<6}")

changed = [item for item in regression if not item["identical"]]
say("")
say(f"  比对项：status + errors(逐字节) + request_json(逐字节)，共 {len(regression)} 个旧值")
say(f"  发生变化的值：{changed if changed else '无（0 个）'}")
say(f"  回归结论：{'全部 10 个旧值行为一字不变' if not changed else '存在变化，需人工确认'}")

result["s3_regression"] = {
    "compared_values": len(regression),
    "changed": changed,
    "all_identical": not changed,
    "detail": regression,
}

# ================================================================= §4 分支换挡
say("")
say(LINE)
say("§4 「按关系分流的产品逻辑」到底哪一段会因新值换挡")
say(LINE)

boss_req = intake_with(var_labels.RELATIONS, "boss")["request_json"]
other_req = intake_with(var_labels.RELATIONS, "other")["request_json"]
boss_obj = json.loads(boss_req)
other_obj = json.loads(other_req)
diff_keys = [k for k in boss_obj if boss_obj[k] != other_obj.get(k)]

say("  boss 与 other 的 request_json 差异字段（变体版）：")
for key in diff_keys:
    say(f"    {key}: {other_obj.get(key)!r}  →  {boss_obj[key]!r}")
say(f"  差异字段数 = {len(diff_keys)}")

say("")
say("  逐层核对（哪些层真的按关系分流）：")
say("    validator/rules.py    : 不消费关系枚举（只要求 recipient_relation 是非空字符串）。")
say("                            → 规则层无任何规则因新值生效（PM 定性：/validate 是规则门不是契约门）。")
say("    workflow/prompts/*.md : generate.md / repair.md 无逐关系枚举，只有通用「低关系压力」措辞。")
say("                            → 提示词不需要改动，也不会因新值自动换挡。")
say("    web/server/intake.mjs : choice(\"recipient_relation\", RELATIONS_FULL)。")
say("                            → 与 Python 同形的白名单闸门；变体表里加了 boss 才放行。")

web = None
node = subprocess.run(
    ["node", str(ROOT / "bossfix" / "prove_web.mjs")],
    capture_output=True, text=True, cwd=str(ROOT), encoding="utf-8",
)
if node.returncode == 0:
    web = json.loads(node.stdout.strip().splitlines()[-1])
    say("    web/server/mock-model.mjs relationFlavor()：有 8 个键，没有 boss 键。")
    say(f"                            → 把 recipient_relation_id=\"boss\" 渲染呈现时，")
    say(f"                              与 \"other\" 的 presentation_json 完全相同 = "
        f"{web['w4_relation_branching']['boss_equals_other_presentation']}")
    say(f"                              与 \"pursuit\" 是否不同 = "
        f"{web['w4_relation_branching']['boss_differs_from_pursuit']}")
    say(f"                              实际贺卡文案：{web['w4_relation_branching']['boss_card_text']}")
    say(f"                              实际关系提示：{web['w4_relation_branching']['boss_relationship_cautions']}")
    say("                            → 结论：单独加枚举值**不会**让「职场分寸／送礼边界」分支生效；")
    say("                              它只会让 boss 从 other 的中性话术变为「有明确关系名」的中性话术。")
else:
    say(f"    [JS 侧证明未运行] node 退出码={node.returncode} stderr={node.stderr.strip()[:300]}")

result["s4_branching"] = {
    "boss_vs_other_diff_keys": diff_keys,
    "boss_vs_other_diff_count": len(diff_keys),
    "validator_consumes_relation": False,
    "prompts_enumerate_relations": False,
    "web_mock_model_has_boss_flavor": False,
    "web_proof": web,
    "js_proof_ran": web is not None,
}

# ================================================================= §5 测试影响
say("")
say(LINE)
say("§5 测试影响：哪些断言会因 11 个值而失败")
say(LINE)

# --- 5.1 tests/acceptance/boundary/test_cross_layer_gate.py
say("")
say("  【5.1】tests/acceptance/boundary/test_cross_layer_gate.py:155-171")
say("        test_relation_enum_has_exactly_the_frozen_membership")
var_product_ids = {k for k in var_labels.RELATIONS if k not in ("colleague", "unknown")}
frozen8 = {"partner", "pursuit", "friend", "family", "classmate", "mentor", "client_partner", "other"}
a1_expected, a1_actual = frozen8, var_product_ids
a1_pass = a1_expected == a1_actual
a2_expected, a2_actual = 10, len(var_labels.RELATIONS)
a2_pass = a2_expected == a2_actual

say(f"        断言 A（第 163-165 行）assertEqual({{...8 个产品值...}}, product_ids)")
say(f"           期望 = {sorted(a1_expected)}")
say(f"           实际 = {sorted(a1_actual)}")
say(f"           → {'PASS' if a1_pass else 'FAIL'}（多出 {sorted(a1_actual - a1_expected)}）")
say(f"        断言 B（第 168-169 行）assertEqual(10, len(RELATIONS), \"枚举总数应为 10（8 产品 + colleague + unknown）\")")
say(f"           期望 = {a2_expected}   实际 = {a2_actual}   → {'PASS' if a2_pass else 'FAIL'}")
say("        应改成：产品值集合加入 \"boss\"（9 个）；总数断言由 10 改为 11，并把说明改为")
say("                「9 产品 + colleague + unknown」。")

# --- 5.2 tests/acceptance/contract/run_contract.py
say("")
say("  【5.2】tests/acceptance/contract/run_contract.py:89")
say("        add(\"REL-UNDECLARED\", \"intake\", \"relation=未声明值 'boss'\",")
say("            intake=dict(BASE, recipient_relation=\"boss\"),")
say("            expect_codes=[\"INTAKE_UNKNOWN_LABEL\"], expect_status=\"needs_input\")")
boss_variant = intake_with(var_labels.RELATIONS, "boss")
c2_pass = codes_of(boss_variant) == ["INTAKE_UNKNOWN_LABEL"] and boss_variant["status"] == "needs_input"
say(f"           期望 codes = ['INTAKE_UNKNOWN_LABEL']   status = 'needs_input'")
say(f"           实际 codes = {codes_of(boss_variant)}   status = {boss_variant['status']!r}")
say(f"           → {'PASS' if c2_pass else 'FAIL'}：该用例把 boss 当作『未声明值』的字面样本，")
say("             一旦 boss 成为已声明值，它就不再能充当这个样本。")
say("        应改成：把样本值换成仍未被声明的值（例如 \"supervisor\" 或 \"BOSS\"），")
say("                或保留 boss 但把期望改为 status=ready、codes=[]（会与用例标题冲突，不推荐）。")
say("        另注：同文件第 24-25 行 RELATION_IDS 是硬编码的 10 项清单，第 1 行 docstring 写")
say("              「10 个关系 ID 全量」；新值不会让它失败，但『全量』覆盖声明会变成陈旧口径")
say("              （第 356 行 relation_ids_declared 会实际列出 11 个键）。")

# --- 5.3 web/tests/access-layer.test.mjs
say("")
say("  【5.3】web/tests/access-layer.test.mjs:32 与 34-36（原版／变体重放）")
if web:
    for item in web["w3_access_layer_assertions"]["variant"]:
        say(f"        第 {item['line']} 行：{'PASS' if item['pass'] else 'FAIL'}   {item['source']}")
        if not item["pass"]:
            say(f"           期望 = {item['expected']}")
            say(f"           实际 = {item['actual']}")
    say("        应改成：第 32 行 PRODUCT_RELATIONS.length 由 8 改为 9；")
    say("                第 34-36 行 deepEqual 期望数组插入 \"boss\"（放在 \"family\" 之后，与实现同序）。")
else:
    say("        [未运行]")

# --- 5.4 不受影响
say("")
say("  【5.4】不受影响的断言（已核对，不会被 11 个值打破）")
say("        tests/acceptance/stage_c/test_stage_c_workflow.py:133-145 test_c2_01")
say("          total_ids=len(RELATIONS) 与 labels_sha256 只是 observe() 的观察字段；")
say("          判定式 ok= 只检查 pursuit 存在／文案／partner 文案／colleague 存在 → 仍为 True。")
say("        tests/test_validator.py 全部用例：validator 不消费关系枚举 → 无影响。")
say("        tests/acceptance/stage_c/fixtures/labels_before_pursuit.py：")
say("          该夹具 sha256=333ad976… 固定不变，不受影响。")

result["s5_test_impact"] = {
    "breaking": [
        {
            "file": "tests/acceptance/boundary/test_cross_layer_gate.py",
            "lines": "163-165",
            "assertion": 'self.assertEqual({"partner","pursuit","friend","family","classmate","mentor","client_partner","other"}, product_ids, ...)',
            "expected": sorted(a1_expected),
            "actual_with_11_values": sorted(a1_actual),
            "pass": a1_pass,
            "fix": '期望集合加入 "boss"（共 9 个产品值）',
        },
        {
            "file": "tests/acceptance/boundary/test_cross_layer_gate.py",
            "lines": "168-169",
            "assertion": 'self.assertEqual(10, len(RELATIONS), "枚举总数应为 10（8 产品 + colleague + unknown）")',
            "expected": a2_expected,
            "actual_with_11_values": a2_actual,
            "pass": a2_pass,
            "fix": "总数 10 → 11，说明改为「9 产品 + colleague + unknown」",
        },
        {
            "file": "tests/acceptance/contract/run_contract.py",
            "lines": "89-90",
            "assertion": 'add("REL-UNDECLARED", ..., intake=dict(BASE, recipient_relation="boss"), expect_codes=["INTAKE_UNKNOWN_LABEL"], expect_status="needs_input")',
            "expected_codes": ["INTAKE_UNKNOWN_LABEL"],
            "actual_codes_with_11_values": codes_of(boss_variant),
            "expected_status": "needs_input",
            "actual_status_with_11_values": boss_variant["status"],
            "pass": c2_pass,
            "fix": '样本字面值由 "boss" 换为仍未声明的值（建议 "supervisor"）',
        },
        {
            "file": "web/tests/access-layer.test.mjs",
            "lines": "32",
            "assertion": "assert.equal(PRODUCT_RELATIONS.length, 8);",
            "expected": 8,
            "actual_with_11_values": (web or {}).get("w2_variant_product_relations", {}).get("count"),
            "pass": False if web else None,
            "fix": "8 → 9",
        },
        {
            "file": "web/tests/access-layer.test.mjs",
            "lines": "34-36",
            "assertion": "assert.deepEqual(PRODUCT_RELATIONS.map((x) => x.id), [...8 个...]);",
            "expected": ["partner", "pursuit", "friend", "family", "classmate", "mentor", "client_partner", "other"],
            "actual_with_11_values": (web or {}).get("w2_variant_product_relations", {}).get("ids"),
            "pass": False if web else None,
            "fix": '期望数组插入 "boss"（放在 "family" 之后）',
        },
    ],
    "unaffected": [
        "tests/acceptance/stage_c/test_stage_c_workflow.py:133-145（total_ids 仅观察字段，不在 ok 内）",
        "tests/test_validator.py（validator 不消费关系枚举）",
        "tests/acceptance/stage_c/fixtures/labels_before_pursuit.py（固定夹具，sha256 不变）",
    ],
    "is_there_an_assertion_requiring_exactly_10": True,
    "exactly_10_assertion": {
        "file": "tests/acceptance/boundary/test_cross_layer_gate.py",
        "lines": "168-169",
        "verbatim": 'self.assertEqual(10, len(RELATIONS), f"枚举总数应为 10（8 产品 + colleague + unknown），实际={sorted(RELATIONS)}")',
    },
}

# ================================================================= §6 生成物
say("")
say(LINE)
say("§6 版本指纹与生成物：labels.py 哈希变化 → 5 个生成物必须重建")
say(LINE)

orig_hash = hashlib.sha256(ORIG_LABELS.read_bytes()).hexdigest()
var_hash = hashlib.sha256(VAR_LABELS.read_bytes()).hexdigest()
manifest = json.loads((ROOT / "workflow" / "generated" / "manifest.json").read_text(encoding="utf-8"))
manifest_hash = manifest["sources_sha256"]["workflow/labels.py"]

say(f"  冻结版 labels.py sha256 = {orig_hash}")
say(f"  manifest 声明          = {manifest_hash}")
say(f"  两者一致（未漂移）      = {orig_hash == manifest_hash}")
say(f"  变体版 labels.py sha256 = {var_hash}")
say(f"  变体版会令 manifest 的 workflow/labels.py 条目失效 = {var_hash != manifest_hash}")
say("")
say("  受影响生成物（workflow/build_code_node.py 的 SOURCES 内嵌 labels.py 源码）：")
for name in manifest["artifacts_sha256"]:
    say(f"    workflow/generated/{name}")
say("  重建命令：python workflow/build_code_node.py")
say("  未重建的后果：Dify Code 节点内的 RELATIONS 仍是 10 键，云端仍返回")
say("                INTAKE_UNKNOWN_LABEL，而本机为 ready —— 两边行为分叉。")

result["s6_artifacts"] = {
    "frozen_labels_sha256": orig_hash,
    "manifest_declared_labels_sha256": manifest_hash,
    "manifest_matches_frozen": orig_hash == manifest_hash,
    "variant_labels_sha256": var_hash,
    "regenerate_required": [f"workflow/generated/{n}" for n in manifest["artifacts_sha256"]],
    "rebuild_command": "python workflow/build_code_node.py",
}

# ================================================================= §7 契约文档
say("")
say(LINE)
say("§7 需要同步的契约文档与前端（均在我写范围之外，只登记不修改）")
say(LINE)
say("  docs/intake-contract.md:15   「产品面冻结 8 个稳定 ID」→ 应改为 9 个并补 boss")
say("  docs/intake-contract.md:130  「8 个产品 ID … labels.py:RELATIONS 10 键，完全一致」→ 9 / 11 键")
say("  docs/intake-contract.md:141  「9 个可用 ID 全部输出正确中文与 ID 对」→ 10 个")
say("  docs/architecture.md:53      「契约已冻结 8 个关系 ID」→ 9 个")
say("  docs/architecture.md:504     labels.py=e3128d29… 指纹 → 更新为新哈希")
say("  docs/product-flow.md:126     「机器值保留在 8 项枚举内」→ 需 PM 明确口径（见提案 §决策）")
say("  web/server/labels.mjs:5,11   注释「冻结 8 项／8 个稳定 ID」→ 9（已含在补丁内）")
say("  web/public/app.js:218-223   关系卡片由 cfg.labels.relations.map() 动态渲染 → 无需改 app.js")

# ================================================================= 汇总
say("")
say(LINE)
say("汇总")
say(LINE)
say(f"  §1 冻结版关系值        : {len(orig_labels.RELATIONS)} 个，含上司语义的 {len(boss_hits)} 个")
say(f"  §2 boss 通过 intake    : {'是' if turned_on else '否'}（{before['status']} → {after['status']}）")
say(f"  §3 旧值回归            : {len(regression) - len(changed)}/{len(regression)} 逐字节不变")
say(f"  §4 新增专属分支        : 无（boss 落入 other 中性话术）")
say(f"  §5 会失败的断言        : {sum(1 for x in result['s5_test_impact']['breaking'] if x['pass'] is False)} 处（另有 1 处计数断言）")
say(f"  §6 需重建生成物        : {len(result['s6_artifacts']['regenerate_required'])} 个")

result["summary"] = {
    "frozen_relation_count": len(orig_labels.RELATIONS),
    "boss_semantic_count": len(boss_hits),
    "boss_accepted_in_variant": turned_on,
    "regression_all_identical": not changed,
    "new_dedicated_branches": 0,
    "breaking_assertions": sum(1 for x in result["s5_test_impact"]["breaking"] if x["pass"] is False),
    "regenerate_required": len(result["s6_artifacts"]["regenerate_required"]),
}

(EVIDENCE / "prove-run.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
(EVIDENCE / "prove-result.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
say("")
say(f"  证据已写入：{EVIDENCE / 'prove-run.txt'}")
say(f"  结构化结果：{EVIDENCE / 'prove-result.json'}")
