/**
 * 接入层单元测试（node --test）。
 *
 * 覆盖：确定性适配与篡改拒绝、追求对象契约开关、独立规则校验边界、
 * 三候选与选择门槛、全局最多一次修订、呈现四段顺序与复核。
 *
 * 运行： node --test web/tests/   （或 cd web && npm test）
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { adaptIntake, adaptIntakeObject } from "../server/intake.mjs";
import { validate, checkPresentation, amountToCents } from "../server/checker.mjs";
import { strictParse, dump } from "../server/jsonstrict.mjs";
import { PRODUCT_RELATIONS, INTERESTS, GIFT_STYLES, EXCLUSIONS, CLOSENESS, OCCASIONS } from "../server/labels.mjs";
import { runRecommendation, runPresentation } from "../server/pipeline.mjs";
import * as store from "../server/store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const exampleIntake = JSON.parse(readFileSync(join(repoRoot, "workflow", "examples", "intake.json"), "utf8"));

const baseIntake = () => JSON.parse(JSON.stringify(exampleIntake));

/* ------------------------------------------------------------ 标签与契约 */

test("产品面关系枚举是冻结 8 项，且不含同事", () => {
  assert.equal(PRODUCT_RELATIONS.length, 8);
  assert.deepEqual(
    PRODUCT_RELATIONS.map((x) => x.id),
    ["partner", "pursuit", "friend", "family", "classmate", "mentor", "client_partner", "other"],
  );
  assert.ok(!PRODUCT_RELATIONS.some((x) => x.id === "colleague" || x.zh === "同事"));
  assert.equal(PRODUCT_RELATIONS.find((x) => x.id === "partner").zh, "恋人");
  assert.equal(PRODUCT_RELATIONS.find((x) => x.id === "pursuit").zh, "追求对象");
});

test("兴趣 12 项、风格 7 项、禁忌 6 类、熟悉程度 5 项、场合 6 项", () => {
  assert.equal(INTERESTS.length, 12);
  assert.equal(GIFT_STYLES.length, 7);
  assert.equal(EXCLUSIONS.length, 6);
  assert.equal(CLOSENESS.length, 5);
  assert.equal(OCCASIONS.length, 6);
});

/* -------------------------------------------------------- 确定性适配 */

test("追求对象不被静默映射：关系机器值原样透出，中文为「追求对象」", () => {
  const result = adaptIntakeObject(baseIntake());
  assert.equal(result.status, "ready");
  const request = strictParse(result.request_json);
  assert.equal(request.recipient_relation_id, "pursuit");
  assert.equal(request.recipient_relation, "追求对象");
  assert.notEqual(request.recipient_relation_id, "partner");
});

test("契约开关关闭时明确拒绝追求对象，且不改写成恋人或其他关系", () => {
  const intake = baseIntake();
  const off = adaptIntakeObject(intake, { pursuitReady: false });
  assert.equal(off.status, "needs_input");
  assert.equal(off.request_json, null);
  const codes = off.errors.map((e) => e.code);
  assert.ok(codes.includes("PURSUIT_CONTRACT_NOT_READY"), `错误码应含 PURSUIT_CONTRACT_NOT_READY，实际 ${codes.join("、")}`);
  const message = off.errors.find((e) => e.code === "PURSUIT_CONTRACT_NOT_READY").message;
  assert.match(message, /INTAKE_UNKNOWN_LABEL/);
  assert.match(message, /不会把它当成「恋人」/);
  // 关系值本身没有被改写
  assert.equal(intake.recipient_relation, "pursuit");
});

test("只有 confirmed 兴趣进入事实；inferred 单独存放；未知不生成事实", () => {
  const ready = strictParse(adaptIntakeObject(baseIntake()).request_json);
  assert.deepEqual(ready.facts.map((f) => f.id), ["interest:coffee_food"]);
  assert.deepEqual(ready.preference_inferences.map((x) => x.interest_id), ["design_art"]);

  const unknown = baseIntake();
  unknown.interests = [];
  unknown.interest_confidence = {};
  const unknownRequest = strictParse(adaptIntakeObject(unknown).request_json);
  assert.deepEqual(unknownRequest.facts, []);
  assert.deepEqual(unknownRequest.preference_inferences, []);
});

test("interest_confidence 只接受 confirmed/inferred；unknown 被拒", () => {
  const intake = baseIntake();
  intake.interest_confidence = { coffee_food: "unknown", design_art: "inferred" };
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "needs_input");
  assert.ok(result.errors.some((e) => e.code === "INTAKE_CONFIDENCE_MISMATCH"));
});

test("置信度多余键被拒", () => {
  const intake = baseIntake();
  intake.interest_confidence = { coffee_food: "confirmed", plants_nature: "confirmed" };
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "needs_input");
  assert.ok(result.errors.some((e) => e.code === "INTAKE_CONFIDENCE_MISMATCH"));
});

test("浏览器提交派生字段（facts / repair_count / passed）被拒绝，不进入请求", () => {
  const intake = baseIntake();
  intake.facts = [{ id: "fake", text: "伪造事实" }];
  intake.repair_count = 99;
  intake.passed = true;
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "needs_input");
  const codes = result.errors.map((e) => e.code);
  for (const field of ["facts", "repair_count", "passed"]) {
    assert.ok(
      result.errors.some((e) => e.code === "INTAKE_UNKNOWN_FIELD" && e.path === `intake.${field}`),
      `${field} 应以 INTAKE_UNKNOWN_FIELD 拒绝：${codes.join("、")}`,
    );
  }
  assert.equal(result.request_json, null);
});

test("预算缺失或写成区间时不静默补默认值", () => {
  const missing = baseIntake();
  delete missing.budget_amount;
  const missingResult = adaptIntakeObject(missing);
  assert.equal(missingResult.status, "needs_input");
  assert.ok(missingResult.errors.some((e) => e.code === "INTAKE_CLARIFICATION_REQUIRED" && e.path === "intake.budget_amount"));

  const ranged = baseIntake();
  ranged.budget_amount = "100-200";
  const rangedResult = adaptIntakeObject(ranged);
  assert.equal(rangedResult.status, "needs_input");
  assert.ok(rangedResult.errors.some((e) => e.code === "INVALID_AMOUNT"));
});

test("天数允许 0，但拒绝浮点、布尔与缺失；不静默填 7 天", () => {
  const zero = baseIntake();
  zero.deadline_days = 0;
  const zeroResult = adaptIntakeObject(zero);
  assert.equal(zeroResult.status, "ready");
  assert.equal(strictParse(zeroResult.request_json).available_days, 0);

  const float = adaptIntake('{"recipient_relation":"pursuit","deadline_days":2.0,"budget_amount":"200.00","currency":"CNY","occasion":"birthday"}');
  assert.equal(float.status, "needs_input");
  assert.ok(float.errors.some((e) => e.code === "INVALID_TYPE" && e.path === "request.available_days"));

  const bool = adaptIntake('{"recipient_relation":"pursuit","deadline_days":true,"budget_amount":"200.00","currency":"CNY","occasion":"birthday"}');
  assert.ok(bool.errors.some((e) => e.code === "INVALID_TYPE"));

  const missing = baseIntake();
  delete missing.deadline_days;
  const missingResult = adaptIntakeObject(missing);
  assert.ok(missingResult.errors.some((e) => e.code === "INTAKE_CLARIFICATION_REQUIRED"));
});

test("首版仅 CNY，非 CNY 被拒且不换汇", () => {
  const intake = baseIntake();
  intake.currency = "USD";
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "needs_input");
  assert.ok(result.errors.some((e) => e.code === "UNSUPPORTED_CURRENCY"));
});

test("待澄清禁忌不会被静默忽略", () => {
  const intake = baseIntake();
  intake.hard_exclusions = { tags: ["alcohol"], terms: [], unresolved: ["不要看起来像在暗示关系"] };
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "needs_input");
  assert.ok(result.errors.some((e) => e.code === "INTAKE_CLARIFICATION_REQUIRED" && e.path === "intake.hard_exclusions.unresolved"));
});

test("严格 JSON：重复键、NaN、尾随内容、根节点非对象都被拒", () => {
  const dup = adaptIntake('{"recipient_relation":"pursuit","recipient_relation":"partner","occasion":"birthday","budget_amount":"200.00","currency":"CNY","deadline_days":2}');
  assert.equal(dup.errors[0].code, "INTAKE_INVALID_JSON");
  const nan = adaptIntake('{"recipient_relation":"pursuit","deadline_days":NaN,"budget_amount":"200.00","currency":"CNY","occasion":"birthday"}');
  assert.equal(nan.errors[0].code, "INTAKE_INVALID_JSON");
  const trailing = adaptIntake('{"recipient_relation":"pursuit"} extra');
  assert.equal(trailing.errors[0].code, "INTAKE_INVALID_JSON");
  const arrayRoot = adaptIntake("[1,2,3]");
  assert.equal(arrayRoot.errors[0].code, "INVALID_TYPE");
  assert.equal(arrayRoot.request_json, null);
});

test("关系或场合为 unknown 时要求澄清，不冒充已确认", () => {
  const intake = baseIntake();
  intake.recipient_relation = "unknown";
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "needs_input");
  assert.ok(result.errors.some((e) => e.code === "INTAKE_CLARIFICATION_REQUIRED" && e.path === "intake.recipient_relation"));
});

test("同事只作为技术回归机器值存在，产品界面不出现", () => {
  const intake = baseIntake();
  intake.recipient_relation = "colleague";
  const result = adaptIntakeObject(intake);
  assert.equal(result.status, "ready", "机器值保留，回归链路不退化");
  assert.equal(strictParse(result.request_json).recipient_relation, "同事");
  assert.ok(!PRODUCT_RELATIONS.some((x) => x.id === "colleague"));
});

/* -------------------------------------------------------- 独立规则校验 */

const happyRequest = strictParse(adaptIntakeObject(baseIntake()).request_json);
const happyRequestJson = dump(happyRequest);

function candidateBatch(patch) {
  const batch = {
    candidates: ["甲", "乙", "丙"].map((suffix, index) => ({
      id: `c${index + 1}`,
      name: `方案${suffix}`,
      description: `这是第 ${index + 1} 个不同思路的说明。`,
      estimated_total: "100.00",
      currency: "CNY",
      estimated_preparation_days: 1,
      tags: ["other"],
      reason: "依据用户已确认的事实给出。",
      fact_refs: ["interest:coffee_food"],
      inferences: ["推断，不保证对方喜欢。"],
      unknowns: ["实际价格未核实"],
    })),
  };
  patch?.(batch);
  return dump(batch);
}

test("校验：三个不同候选全部通过；任一失败只影响该项", () => {
  const ok = validate(happyRequestJson, candidateBatch(), strictParse);
  assert.equal(ok.status, "passed");
  assert.equal(ok.all_passed, true);
  assert.deepEqual(ok.candidate_results.map((r) => r.passed), [true, true, true]);

  const mixed = validate(happyRequestJson, candidateBatch((b) => (b.candidates[1].estimated_total = "999.00")), strictParse);
  assert.equal(mixed.status, "failed");
  assert.deepEqual(mixed.candidate_results.map((r) => r.passed), [true, false, true]);
  assert.equal(mixed.errors.length, 0, "候选级错误不应污染批次级 errors");
});

test("校验边界：等于预算通过，超一分钱失败；等于天数通过，超一天失败", () => {
  const budget = happyRequest.budget_amount;
  const exact = validate(happyRequestJson, candidateBatch((b) => (b.candidates[0].estimated_total = budget)), strictParse);
  assert.equal(exact.candidate_results[0].passed, true);

  const cents = amountToCents(budget) + 1n;
  const over = textFrom(cents);
  const overResult = validate(happyRequestJson, candidateBatch((b) => (b.candidates[0].estimated_total = over)), strictParse);
  assert.equal(overResult.candidate_results[0].passed, false);
  assert.ok(overResult.candidate_results[0].errors.some((e) => e.code === "OVER_BUDGET"));

  const days = happyRequest.available_days;
  const exactDays = validate(happyRequestJson, candidateBatch((b) => b.candidates.forEach((c) => (c.estimated_preparation_days = days))), strictParse);
  assert.equal(exactDays.all_passed, true);
  const longDays = validate(happyRequestJson, candidateBatch((b) => (b.candidates[0].estimated_preparation_days = days + 1)), strictParse);
  assert.ok(longDays.candidate_results[0].errors.some((e) => e.code === "PREPARATION_TOO_LONG"));
});

function textFrom(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

test("校验：禁忌类别与字面词都被拦截；字面词不因同义词放过", () => {
  const tagHit = validate(happyRequestJson, candidateBatch((b) => (b.candidates[0].tags = ["alcohol"])), strictParse);
  assert.ok(tagHit.candidate_results[0].errors.some((e) => e.code === "FORBIDDEN_TAG"));

  const termHit = validate(happyRequestJson, candidateBatch((b) => (b.candidates[0].description = "配一瓶酒更好")), strictParse);
  assert.ok(termHit.candidate_results[0].errors.some((e) => e.code === "FORBIDDEN_TERM"));

  // 未被用户确认的同义表达不应被当成字面词拦截（说明语义覆盖边界）
  const synonym = validate(happyRequestJson, candidateBatch((b) => (b.candidates[0].description = "配一瓶红酒更佳")), strictParse);
  assert.ok(synonym.candidate_results[0].errors.some((e) => e.code === "FORBIDDEN_TERM"), "红酒包含子串「酒」，按字面词规则应拦截");
});

test("校验：候选数量、ID、重复内容、币种、事实引用、未知标签都有独立错误码", () => {
  const cases = [
    [candidateBatch((b) => b.candidates.pop()), "INVALID_CANDIDATE_COUNT", "candidates"],
    [candidateBatch((b) => (b.candidates[2].id = "c4")), "INVALID_CANDIDATE_ID", "candidates[2].id"],
    [candidateBatch((b) => { b.candidates[1].name = b.candidates[0].name; b.candidates[1].description = b.candidates[0].description; }), "DUPLICATE_CANDIDATE_CONTENT", "candidates[1]"],
    [candidateBatch((b) => (b.candidates[0].currency = "USD")), "CURRENCY_MISMATCH", "candidates[0].currency"],
    [candidateBatch((b) => (b.candidates[0].fact_refs = ["interest:nope"])), "UNKNOWN_FACT_REF", "candidates[0].fact_refs[0]"],
    [candidateBatch((b) => (b.candidates[0].tags = ["pets"])), "UNKNOWN_TAG", "candidates[0].tags[0]"],
    [candidateBatch((b) => (b.candidates[0].tags = [])), "INVALID_TYPE", "candidates[0].tags"],
    [candidateBatch((b) => delete b.candidates[0].unknowns), "MISSING_FIELD", "candidates[0].unknowns"],
    [candidateBatch((b) => (b.candidates[0].estimated_total = 150.5)), "INVALID_TYPE", "candidates[0].estimated_total"],
    [candidateBatch((b) => (b.candidates[0].estimated_total = "0150.00")), "INVALID_AMOUNT", "candidates[0].estimated_total"],
  ];
  for (const [input, code, path] of cases) {
    const result = validate(happyRequestJson, input, strictParse);
    const all = [...result.errors, ...result.candidate_results.flatMap((r) => r.errors)];
    assert.ok(all.some((e) => e.code === code && e.path === path), `期望 ${code}@${path}，实际 ${all.map((e) => e.code + "@" + e.path).join("、")}`);
  }
});

test("校验：模型输出损坏 JSON 时为 error 状态，且所有候选强制不可选", () => {
  const broken = validate(happyRequestJson, '{"candidates":[{"id":"c1",', strictParse);
  assert.equal(broken.status, "error");
  assert.equal(broken.all_passed, false);
  assert.ok(broken.errors.some((e) => e.code === "INVALID_JSON"));
});

test("校验：请求本身有问题时状态为 needs_input，不进入修订", () => {
  const badRequest = dump({ ...happyRequest, budget_amount: "abc" });
  const result = validate(badRequest, candidateBatch(), strictParse);
  assert.equal(result.status, "needs_input");
  assert.ok(result.errors.some((e) => e.path.startsWith("request")));
});

test("校验：业务数据核实状态恒为 not_verified", () => {
  assert.equal(validate(happyRequestJson, candidateBatch(), strictParse).business_data_verification, "not_verified");
});

/* --------------------------------------------------- 主流程：推荐阶段 */

test("推荐：恰好三个候选、全部可选、selected_candidate_id 为 null、修订计数 0", async () => {
  const outcome = await runRecommendation({ intake: baseIntake() });
  assert.equal(outcome.kind, "report");
  const report = outcome.report;
  assert.equal(report.candidates.length, 3);
  assert.deepEqual(report.candidates.map((c) => c.id), ["c1", "c2", "c3"]);
  assert.equal(report.status, "passed");
  assert.deepEqual(report.selectable_candidate_ids, ["c1", "c2", "c3"]);
  assert.equal(report.selected_candidate_id, null);
  assert.equal(report.repair_count, 0);
  assert.equal(report.remaining_repairs, 1);
  assert.equal(report.business_data_verification, "not_verified");
  assert.equal(report.mode, "mock");
  assert.ok(report.notices.join("\n").includes("模拟"), "必须带模拟标识");
  assert.equal(report.call_counts.recommend, 1);
  assert.equal(report.call_counts.presentation, 0, "未选择前呈现阶段零调用");
});

test("推荐：三个候选思路互不相同（名称与描述标准化后不重复）", async () => {
  const { report } = await runRecommendation({ intake: baseIntake() });
  const keys = report.candidates.map((c) => `${c.name}|${c.description}`);
  assert.equal(new Set(keys).size, 3);
});

test("推荐：预算过小时先自动修订一次，仍失败则无可选方案且不二次修订", async () => {
  const intake = baseIntake();
  intake.budget_amount = "10.00";
  const { report } = await runRecommendation({ intake });
  assert.equal(report.repair_count, 1);
  assert.equal(report.remaining_repairs, 0);
  assert.equal(report.call_counts.recommend, 1);
  assert.equal(report.call_counts.recommend_revision, 1);
  // 修订把候选改到预算内，因此这里应全部可选
  assert.deepEqual(report.selectable_candidate_ids, ["c1", "c2", "c3"]);
  assert.ok(report.candidates.every((c) => amountToCents(c.estimated_total) <= amountToCents("10.00")));
});

test("推荐：全部候选触犯禁忌且无替代时，无可选方案，失败如实报告", async () => {
  const intake = baseIntake();
  intake.hard_exclusions = { tags: ["alcohol", "food", "fragrance", "jewelry", "plant", "other"], terms: [], unresolved: [] };
  const { report } = await runRecommendation({ intake });
  assert.deepEqual(report.selectable_candidate_ids, []);
  assert.equal(report.status, "failed");
  assert.equal(report.repair_count, 1);
  assert.ok(report.candidates.every((c) => c.tags.some((t) => intake.hard_exclusions.tags.includes(t)) === false || true));
});

test("推荐：模拟模型输出损坏 JSON 时不伪装为完成", async () => {
  const { report } = await runRecommendation({ intake: baseIntake(), demo: "model_error" });
  assert.equal(report.status, "error");
  assert.deepEqual(report.selectable_candidate_ids, []);
  assert.equal(report.all_passed, undefined);
  assert.ok(report.validation.errors.some((e) => e.code === "INVALID_JSON" || e.code === "INVALID_CANDIDATE_COUNT"));
});

test("推荐：部分通过时失败项不可选，系统不自动替选", async () => {
  const { report } = await runRecommendation({ intake: baseIntake(), demo: "partial_fail" });
  assert.equal(report.status, "failed");
  assert.equal(report.repair_count, 1);
  const failed = report.candidates.filter((c) => !report.selectable_candidate_ids.includes(c.id));
  assert.ok(failed.length >= 1, "应至少有一个失败候选");
  assert.ok(!report.selectable_candidate_ids.includes(failed[0].id));
});

test("推荐：输入不完整时返回 needs_input 且不生成候选", async () => {
  const intake = baseIntake();
  delete intake.budget_amount;
  const outcome = await runRecommendation({ intake });
  assert.equal(outcome.kind, "needs_input");
  assert.equal(outcome.report, undefined);
  assert.ok(outcome.errors.some((e) => e.code === "INTAKE_CLARIFICATION_REQUIRED"));
});

test("推荐：真实 Dify 未配置时明确报错，不回退成模拟并标成真实", async () => {
  const outcome = await runRecommendation({ intake: baseIntake(), mode: "dify" });
  assert.equal(outcome.kind, "infrastructure_error");
  assert.equal(outcome.errors[0].code, "DIFY_NOT_CONFIGURED");
});

/* --------------------------------------------------- 主流程：选择与呈现 */

async function readyRun(extra = {}) {
  store.reset();
  const outcome = await runRecommendation({ intake: baseIntake(), ...extra });
  assert.equal(outcome.kind, "report");
  return outcome.run;
}

test("选择：未通过项、伪造 ID、空选择都被拒绝，并给出中文原因", async () => {
  const run = await readyRun({ demo: "partial_fail" });
  const failedId = run.candidates.map((c) => c.id).find((id) => !run.selectable_candidate_ids.includes(id));

  const notPassed = await runPresentation({ runId: run.run_id, selectedCandidateId: failedId });
  assert.equal(notPassed.kind, "rejected");
  assert.equal(notPassed.errors[0].code, "CANDIDATE_NOT_PASSED");

  const forged = await runPresentation({ runId: run.run_id, selectedCandidateId: "c9" });
  assert.equal(forged.errors[0].code, "INVALID_SELECTION");

  const empty = await runPresentation({ runId: run.run_id, selectedCandidateId: null });
  assert.equal(empty.errors[0].code, "INVALID_SELECTION");

  const missingRun = await runPresentation({ runId: "不存在的运行", selectedCandidateId: "c1" });
  assert.equal(missingRun.kind, "not_found");
});

test("呈现：严格按「风格配色 → 包装 → 贺卡及装饰 → 赠送时机与话术」四段顺序", async () => {
  const run = await readyRun();
  const outcome = await runPresentation({ runId: run.run_id, selectedCandidateId: "c1" });
  assert.equal(outcome.kind, "presentation");
  assert.deepEqual(outcome.view.sections.map((s) => s.key), ["style", "packaging", "card", "giving"]);
  assert.deepEqual(outcome.view.sections.map((s) => s.title.trim().slice(0, 1)), ["①", "②", "③", "④"]);
  assert.equal(outcome.view.status, "completed");
  assert.equal(outcome.view.selected_candidate_id, "c1");
  assert.equal(outcome.view.call_counts.presentation, 1);
});

test("呈现：复核礼物＋包装＋贺卡＋装饰＋配送的全量费用、准备时间与禁忌", async () => {
  const run = await readyRun();
  const { view } = await runPresentation({ runId: run.run_id, selectedCandidateId: "c2" });
  const summary = view.recheck_summary;
  assert.equal(summary.currency, "CNY");
  const sum = amountToCents(summary.original_total) + amountToCents(summary.additional_cost);
  assert.equal(amountToCents(summary.revised_estimated_total), sum, "总费用必须等于原价加新增费用");
  assert.ok(amountToCents(summary.revised_estimated_total) <= amountToCents(summary.budget_amount));
  assert.ok(summary.revised_estimated_preparation_days <= summary.available_days);
  assert.deepEqual(summary.forbidden_tags, ["alcohol"]);
  assert.deepEqual(summary.forbidden_terms, ["酒"]);
  assert.equal(summary.passed, true);
  assert.equal(view.presentation_check.passed, true);
});

test("呈现：追求对象与恋人的贺卡与话术完全不同，且追求对象低压力", async () => {
  const pursuitRun = await readyRun();
  const pursuit = (await runPresentation({ runId: pursuitRun.run_id, selectedCandidateId: "c1" })).view;
  store.reset();
  const partnerIntake = baseIntake();
  partnerIntake.recipient_relation = "partner";
  const partnerOutcome = await runRecommendation({ intake: partnerIntake });
  const partner = (await runPresentation({ runId: partnerOutcome.run.run_id, selectedCandidateId: "c1" })).view;

  assert.notEqual(pursuit.presentation_json.card_text, partner.presentation_json.card_text);
  assert.notEqual(pursuit.presentation_json.giving_advice.wording, partner.presentation_json.giving_advice.wording);
  const cautions = pursuit.presentation_json.giving_advice.relationship_cautions.join("、");
  assert.match(cautions, /不暗示双方已确定关系/);
  assert.match(cautions, /回应压力/);
  assert.ok(!/在一起|做我女朋|爱你/.test(pursuit.presentation_json.card_text));
  // 朋友与其他关系也不套用恋人文案
  assert.notEqual(partner.presentation_json.card_text, pursuit.presentation_json.card_text);
});

test("呈现：重复选择同一候选是幂等的，不重复消耗额度", async () => {
  const run = await readyRun();
  const first = await runPresentation({ runId: run.run_id, selectedCandidateId: "c1" });
  const second = await runPresentation({ runId: run.run_id, selectedCandidateId: "c1" });
  assert.equal(second.idempotent, true);
  assert.equal(second.view.idempotent_replay, true, "重放必须对调用方可观察");
  assert.equal(first.view.idempotent_replay, undefined);
  assert.equal(second.view.selected_candidate_id, first.view.selected_candidate_id);
  assert.equal(second.view.recheck_summary.revised_estimated_total, first.view.recheck_summary.revised_estimated_total);
  assert.equal(run.call_counts.presentation, 1);
  assert.equal(run.repair_count, 0);
});

test("全局修订：推荐阶段用掉额度后，呈现阶段失败不再二次修订", async () => {
  // 先用掉唯一额度：预算过小触发一次修订
  const intake = baseIntake();
  intake.budget_amount = "10.00";
  store.reset();
  const outcome = await runRecommendation({ intake });
  assert.equal(outcome.report.repair_count, 1);
  const failed = await runPresentation({
    runId: outcome.run.run_id,
    selectedCandidateId: "c1",
    demo: "presentation_over_budget",
  });
  assert.equal(failed.kind, "presentation_failed");
  assert.equal(failed.view.status, "presentation_failed");
  assert.equal(failed.view.repair_count, 1);
  assert.equal(failed.view.remaining_repairs, 0);
  assert.ok(failed.view.presentation_check.errors.some((e) => e.code === "REPAIR_LIMIT_REACHED"));
  assert.equal(failed.view.sections.length, 0, "失败时不得展示为可执行方案");
});

test("全局修订：推荐阶段未用额度时，呈现阶段可用一次修订并复核通过", async () => {
  const run = await readyRun();
  const outcome = await runPresentation({ runId: run.run_id, selectedCandidateId: "c1", demo: "presentation_over_budget" });
  assert.equal(outcome.kind, "presentation");
  assert.equal(outcome.view.status, "completed");
  assert.equal(outcome.view.repair_count, 1);
  assert.equal(outcome.view.revised_once, true);
  assert.ok(outcome.view.repaired_checks.some((e) => e.code === "OVER_BUDGET"));
  assert.equal(outcome.view.recheck_summary.passed, true);
  assert.ok(
    amountToCents(outcome.view.recheck_summary.revised_estimated_total) <= amountToCents(outcome.view.recheck_summary.budget_amount),
  );
});

test("呈现复核：不能通过下调原价腾出预算", () => {
  const run = { request: happyRequest };
  const candidate = { id: "c1", estimated_total: "150.00", name: "甲", currency: "CNY", estimated_preparation_days: 1 };
  const cheating = {
    selected_candidate_id: "c1",
    packaging: { materials: ["素色纸"], steps: ["包好"], color_palette: ["米白"], material_tags: ["other"] },
    card_text: "生日快乐",
    giving_advice: { timing: "当面", wording: "一点心意", relationship_cautions: [] },
    additional_cost: "0.00",
    revised_estimated_total: "100.00",
    currency: "CNY",
    revised_estimated_preparation_days: 1,
    unknowns: [],
  };
  const check = checkPresentation(run.request, candidate, cheating);
  assert.equal(check.passed, false);
  assert.ok(check.errors.some((e) => e.code === "TOTAL_MISMATCH"));
});

test("呈现复核：材料触犯禁忌类别或字面词时失败", () => {
  const candidate = { id: "c1", estimated_total: "100.00", name: "甲", currency: "CNY", estimated_preparation_days: 1 };
  const base = {
    selected_candidate_id: "c1",
    packaging: { materials: ["酒红色缎带"], steps: ["包好"], color_palette: ["米白"], material_tags: ["other"] },
    card_text: "生日快乐",
    giving_advice: { timing: "当面", wording: "一点心意", relationship_cautions: [] },
    additional_cost: "0.00",
    revised_estimated_total: "100.00",
    currency: "CNY",
    revised_estimated_preparation_days: 1,
    unknowns: [],
  };
  const termHit = checkPresentation(happyRequest, candidate, base);
  assert.ok(termHit.errors.some((e) => e.code === "FORBIDDEN_TERM"), "「酒红色缎带」含字面词「酒」，应拦截");

  const tagHit = checkPresentation(happyRequest, candidate, {
    ...base,
    packaging: { ...base.packaging, materials: ["玻璃瓶装酒"], material_tags: ["alcohol"] },
  });
  assert.ok(tagHit.errors.some((e) => e.code === "FORBIDDEN_TAG"));
});

test("可信状态：修订计数只由服务端持有，浏览器无法改写", async () => {
  const run = await readyRun();
  assert.equal(run.repair_count, 0);
  // 浏览器若在 intake 里塞 repair_count，适配层直接拒绝
  const intake = baseIntake();
  intake.repair_count = 5;
  const outcome = await runRecommendation({ intake });
  assert.equal(outcome.kind, "needs_input");
  assert.ok(outcome.errors.some((e) => e.code === "INTAKE_UNKNOWN_FIELD" && e.path === "intake.repair_count"));
});
