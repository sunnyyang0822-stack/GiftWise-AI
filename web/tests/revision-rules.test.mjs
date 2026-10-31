import test from "node:test";
import assert from "node:assert/strict";
import { adaptIntakeObject } from "../server/intake.mjs";
import { checkPresentation, validate } from "../server/checker.mjs";
import { strictParse } from "../server/jsonstrict.mjs";
import { budget_slider, budget_modes, DEADLINE_RANGES } from "../server/config.mjs";

const request = (overrides = {}) => ({
  recipient_relation: "追求对象", occasion: "生日", budget_amount: "300", currency: "CNY",
  available_days: 5, facts: [], forbidden_tags: [], forbidden_terms: [], notes: "低压力", ...overrides,
});
const candidate = (id, total = "150.00", days = 3) => ({
  id, name: `礼物 ${id}`, description: `描述 ${id}`, estimated_total: total, currency: "CNY",
  estimated_preparation_days: days, tags: ["other"], reason: "虚构理由", fact_refs: [],
  inferences: [], unknowns: ["实际供应未知"],
});
const batch = (first = candidate("c1")) => ({ candidates: [first, candidate("c2", "80.00", 2), candidate("c3", "60.00", 1)] });
const dump = (v) => JSON.stringify(v);
const check = (r, b) => validate(dump(r), dump(b), strictParse);

test("新版预算配置与六档 deadline 来自集中配置", () => {
  assert.deepEqual(budget_slider, { min: 0, max: 1000, step: 50 });
  assert.deepEqual(budget_modes, ["slider", "zero", "other"]);
  assert.deepEqual(DEADLINE_RANGES.map((x) => x.value), [1, 5, 7, 30, 90, 365]);
});

test("新版规则允许 0.99、零元和区间端点，低于 min 只 warning", () => {
  const zeroBatch = batch(candidate("c1", "0.00"));
  zeroBatch.candidates.slice(1).forEach((item) => { item.estimated_total = "0.00"; });
  const zero = check(request({ budget_amount: "0" }), zeroBatch);
  assert.equal(zero.status, "passed");
  const fractionBatch = batch(candidate("c1", "0.99"));
  fractionBatch.candidates.slice(1).forEach((item) => { item.estimated_total = "0.99"; });
  const fraction = check(request({ budget_amount: "0.99" }), fractionBatch);
  assert.equal(fraction.status, "passed");
  const ranged = check(request({ budget_amount: "300", budget_range: { min: "200", max: "300" }, contract_version: "giftwise-20261031-v2" }), batch(candidate("c1", "150.00")));
  assert.equal(ranged.status, "passed");
  assert.equal(ranged.candidate_results[0].warnings[0].code, "BELOW_BUDGET_RANGE");
});

test("新版规则拒绝范围结构、模式、标量不一致和上限外金额", () => {
  const bad = check(request({ budget_amount: "300", budget_range: { min: null, max: "300" }, budget_mode: "other", contract_version: "giftwise-20261031-v2" }), batch());
  assert.equal(bad.status, "needs_input");
  assert.ok(bad.errors.some((e) => e.code === "INVALID_TYPE" && e.path === "request.budget_range.min"));
  const mismatch = check(request({ budget_amount: "299", budget_range: { min: "100", max: "300" }, budget_mode: "other", contract_version: "giftwise-20261031-v2" }), batch());
  assert.ok(mismatch.errors.some((e) => e.code === "BUDGET_RANGE_MISMATCH"));
  const over = check(request({ budget_amount: "10000.01" }), batch());
  assert.ok(over.errors.some((e) => e.code === "LIMIT_EXCEEDED"));
});

test("新版 intake 派生 max 并原样保留 dislikes，伪造区间不静默修正", () => {
  const input = { contract_version: "giftwise-20261031-v2", budget_mode: "slider", budget_range: { min: "100", max: "300" }, recipient_relation: "pursuit", occasion: "birthday", currency: "CNY", deadline_days: 5, dislikes: "不要香氛" };
  const result = adaptIntakeObject(input);
  assert.equal(result.status, "ready");
  const output = JSON.parse(result.request_json);
  assert.equal(output.budget_amount, "300");
  assert.equal(output.dislikes, "不要香氛");
  const mismatch = adaptIntakeObject({ ...input, budget_amount: "299" });
  assert.equal(mismatch.status, "needs_input");
  assert.ok(mismatch.errors.some((e) => e.code === "BUDGET_RANGE_MISMATCH"));
  const unknownMode = adaptIntakeObject({ ...input, budget_mode: "mystery" });
  assert.equal(unknownMode.status, "needs_input");
  assert.ok(unknownMode.errors.some((e) => e.code === "INVALID_BUDGET_RANGE" && e.path === "intake.budget_mode"));
});

test("新版呈现通过：包含有效呈现说明，不接收报价字段", () => {
  const req = request({ budget_amount: "150", contract_version: "giftwise-20261031-v2", budget_range: { min: "100", max: "150" } });
  const selected = candidate("c1", "138.00", 3);
  const presentation = {
    contract_version: "giftwise-20261031-v2", style: "克制、低压力", packaging: { color_palette: ["米白", "深绿"], description: "受控呈现说明：无需新增包装，可直接交付所选礼物并附上贺卡。" },
    card_text: "祝你今天愉快，愿你有自己的节奏。", giving_advice: { timing: "方便时送出", wording: "一点小心意，请轻松收下。", relationship_cautions: ["不要求即时回应"] },
    unknowns: ["实际购买渠道未核实"], currency: "CNY", revised_estimated_preparation_days: 3,
  };
  assert.equal(checkPresentation(req, selected, presentation).passed, true);
  const quoted = checkPresentation(req, selected, { ...presentation, additional_cost: "40.00" });
  assert.ok(quoted.errors.some((e) => e.code === "PRESENTATION_INVALID"));
});

test("新版呈现拒绝改价、超期、缺字段和禁忌色调/风格", () => {
  const req = request({ budget_amount: "150", available_days: 2, forbidden_terms: ["红色"], contract_version: "giftwise-20261031-v2", budget_range: { min: "100", max: "150" } });
  const selected = candidate("c1", "138.00", 2);
  const base = { contract_version: "giftwise-20261031-v2", style: "红色风格", packaging: { color_palette: ["红色"], description: "受控呈现说明：无需新增包装，可直接交付所选礼物并附上贺卡。" }, card_text: "祝你愉快", giving_advice: { timing: "方便时", wording: "小心意", relationship_cautions: [] }, unknowns: [], currency: "CNY", revised_estimated_preparation_days: 3 };
  const out = checkPresentation(req, selected, base);
  assert.ok(out.errors.some((e) => e.code === "FORBIDDEN_TERM"));
  assert.ok(out.errors.some((e) => e.code === "PREPARATION_TOO_LONG"));
  const missing = { ...base }; delete missing.style;
  assert.ok(checkPresentation(req, selected, missing).errors.some((e) => e.code === "PRESENTATION_INVALID"));
  const legacy = checkPresentation(req, selected, { packaging: { materials: ["纸盒"], steps: ["包裹"], color_palette: ["米白"] }, card_text: "祝好", giving_advice: { timing: "方便时", wording: "小心意", relationship_cautions: [] }, unknowns: [], additional_cost: "0.00", revised_estimated_total: "138.00", currency: "CNY", revised_estimated_preparation_days: 2 });
  assert.ok(legacy.errors.some((e) => e.code === "PRESENTATION_INVALID"));
});
