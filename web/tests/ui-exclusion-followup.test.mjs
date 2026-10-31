import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { setupChat, newChatState, runAnalysis, answerExclusionClarification, chatProblems, parseFollowups } from "../public/js/chat.js";
import { exclusionConfirmation, exclusionQuestions } from "../public/js/exclusion-flow.js";
import { applyParsedToForm, composeAdditionalContext } from "../public/js/parse-intake.js";
import { previewConfig } from "../public/js/preview-api.js";

globalThis.document = { querySelector: () => null };
const original = "别让人看起来像表白，卡片也别写得暧昧";
const form = () => ({ recipient_relation: "friend", recipient_relation_other: "", closeness: "familiar", occasion: "birthday", occasion_other: "", budget_mode: "slider", budget_min: "100", budget_max: "300", deadline_days: "", interests: ["music_movies"], interest_confidence: { music_movies: "confirmed" }, interests_unknown: false, gift_styles: ["understated"], styles_unknown: false, exclusion_tags: [], exclusion_terms: [], dislikes: original, previous_gifts: "一本书", additional_context: "保留用户自己的补充", parsed_context: "保留喜好原话", city_answer: "" });
const ready = id => ({ status: "ready", analysis_id: id, candidates: [], semantic_constraints: [{ source_span: original, interpretation: "保持朋友间的表达边界", confidence: "high" }], clarification_questions: [], confirmation_required: false });
const needsInput = (id, question) => ({ status: "needs_input", analysis_id: id, candidates: [], semantic_constraints: [], clarification_questions: [{ source_span: original, question }], confirmation_required: false });
function setup(analyze) {
  const state = { config: previewConfig, form: form(), chat: newChatState(), analysis: null, confirmedIds: [] };
  const calls = [];
  const buildIntake = () => structuredClone(state.form);
  const invalidateAnalysis = () => { state.analysis = null; state.confirmedIds = []; state.chat.analysisToken++; state.chat.exclusionAnalysisKey = null; state.chat.pendingExclusionContinuation = null; };
  setupChat({ state, render() {}, buildIntake, invalidateAnalysis, analyze: async (...args) => { calls.push(structuredClone(args)); return analyze(...args); } });
  return { state, calls, buildIntake, invalidateAnalysis };
}

test("已理解的语义边界使用服务端ready引用，无具体禁品就不伪造确认ID", async () => {
  const { state } = setup(async () => ready("semantic-1")); const before = structuredClone(state.form);
  await runAnalysis();
  assert.ok(state.chat.done.includes("avoid_confirm"));
  assert.deepEqual(state.confirmedIds, []);
  assert.deepEqual(exclusionConfirmation(state.analysis, []), { analysis_id: "semantic-1", confirmed_ids: [] });
  assert.deepEqual(state.form, before);
});

test("具体禁品仍须有效ID；语气边界不混入具体禁品确认", () => {
  const analysis = { ...ready("mixed-1"), status: "needs_confirmation", candidates: [{ id: "xc1", term: "香水" }], confirmation_required: true };
  assert.equal(exclusionConfirmation(analysis, []), null);
  assert.equal(exclusionConfirmation(analysis, ["made-up"]), null);
  assert.deepEqual(exclusionConfirmation(analysis, ["xc1"]), { analysis_id: "mixed-1", confirmed_ids: ["xc1"] });
  assert.equal(exclusionConfirmation({ ...ready("bad"), candidates: analysis.candidates }, []), null);
  assert.equal(exclusionConfirmation(needsInput("ask-1", "你希望表达什么？")), null);
  assert.equal(exclusionConfirmation({ ...ready("bad"), confirmation_required: true }), null);
  assert.equal(exclusionConfirmation({ ...ready(""), analysis_id: "" }), null);
});

test("真正歧义保留全部已填需求，采用后端具体问题而非具体物品模板", async () => {
  const question = "你希望这份礼物传达怎样的关系和语气？";
  const { state } = setup(async () => needsInput("ask-1", question)); const before = structuredClone(state.form);
  await runAnalysis();
  assert.deepEqual(exclusionQuestions(state.analysis), [question]);
  assert.ok(!state.chat.done.includes("avoid_confirm"));
  assert.deepEqual(state.form, before);
  assert.equal(exclusionConfirmation(state.analysis, []), null);
});

test("多轮回答沿用当前分析ID和原始dislikes，不经过整段需求重解析", async () => {
  const responses = [needsInput("ask-1", "你希望保持什么距离？"), needsInput("ask-2", "贺卡想用怎样的语气？"), ready("understood-3")];
  const { state, calls } = setup(async () => responses.shift()); const before = structuredClone(state.form);
  await runAnalysis();
  state.chat.notes = [{ role: "bot", text: "上一轮临时提示" }];
  state.chat.draft = "普通朋友，轻松一些";
  await answerExclusionClarification(state.chat.draft);
  state.chat.draft = "像平时聊天一样就好";
  await answerExclusionClarification(state.chat.draft);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1][1], { analysis_id: "ask-1", answer: "普通朋友，轻松一些" });
  assert.deepEqual(calls[2][1], { analysis_id: "ask-2", answer: "像平时聊天一样就好" });
  assert.ok(calls.every(([intake]) => intake.dislikes === original));
  assert.deepEqual(state.form, before);
  assert.deepEqual(state.chat.exclusionTurns, [{ questions: ["你希望保持什么距离？"], answer: "普通朋友，轻松一些" }, { questions: ["贺卡想用怎样的语气？"], answer: "像平时聊天一样就好" }]);
  assert.ok(state.chat.done.includes("avoid_confirm"));
  assert.equal(state.chat.pendingExclusionContinuation, null);
  assert.deepEqual(state.chat.notes, [], "成功续答不残留上一轮提示");
});

test("低可信的具体禁品不自动确认", async () => {
  const { state } = setup(async () => ({ status: "needs_confirmation", analysis_id: "manual-1", candidates: [{ id: "xc1", confidence: "low", source_span: "卡片" }], clarification_questions: [] }));
  await runAnalysis();
  assert.deepEqual(state.confirmedIds, []);
  assert.ok(!state.chat.done.includes("avoid_confirm"));
});

test("传输失败不丢失回答或清空需求，重试同一回答且不重复历史", async () => {
  let attempt = 0;
  const { state, calls } = setup(async () => { attempt++; if (attempt === 1) return needsInput("ask-1", "你希望怎样表达？"); if (attempt === 2) throw new Error("network"); return ready("done-2"); });
  await runAnalysis(); state.chat.draft = "轻松地表达感谢";
  const before = structuredClone(state.form);
  await answerExclusionClarification(state.chat.draft);
  assert.equal(state.analysis.analysis_id, "ask-1");
  assert.equal(state.chat.draft, "轻松地表达感谢");
  assert.equal(state.chat.exclusionTurns.length, 0);
  assert.ok(state.chat.analysisError);
  const pending = state.chat.pendingExclusionContinuation;
  await runAnalysis(pending);
  assert.deepEqual(calls[1][1], calls[2][1]);
  assert.equal(state.chat.exclusionTurns.length, 1);
  assert.deepEqual(state.form, before);
});

test("在途续答防重复；表单更新后旧响应不能覆盖当前任务", async () => {
  let resolve;
  const { state, calls } = setup(async () => new Promise(done => { resolve = done; }));
  state.analysis = needsInput("ask-1", "还想注意什么？");
  const pending = answerExclusionClarification("低调一点");
  await answerExclusionClarification("第二次点击");
  assert.equal(calls.length, 1);
  state.form.budget_max = "500";
  resolve(ready("stale")); await pending;
  assert.notEqual(state.analysis.analysis_id, "stale");
  assert.ok(!state.chat.done.includes("avoid_confirm"));
  const next = setup(async () => ready("next"));
  await runAnalysis(); assert.equal(next.state.analysis.analysis_id, "next");
});

test("空回答、过长回答和无有效分析引用不会发续答请求", async () => {
  const { state, calls } = setup(async () => ready("unused"));
  await answerExclusionClarification(" ");
  await answerExclusionClarification("字".repeat(1001));
  await answerExclusionClarification("正常回答");
  assert.equal(calls.length, 0);
  assert.equal(state.form.dislikes, original);
});

test("不可用/损坏的服务响应保留恢复入口，不能冒充语义已理解", async () => {
  const { state } = setup(async () => ({ ...ready("invalid"), candidates: [{ id: "unconfirmed" }] }));
  await runAnalysis();
  assert.equal(state.analysis, null);
  assert.ok(state.chat.analysisError);
  assert.ok(!state.chat.done.includes("avoid_confirm"));
});

test("缺送礼时间不阻断；旧相对时间追问不成为必答", () => {
  const { state } = setup(async () => ready("unused"));
  assert.deepEqual(chatProblems(), []);
  state.chat.parseReport = { deadlinePending: true, parse: { required_followups: [{ id: "deadline_confirm", required: true }] } };
  assert.deepEqual(parseFollowups(), []);
  state.form.deadline_days = "10";
  assert.deepEqual(chatProblems(), [], "合法主动时间不锁六个预设档位");
});

test("解析时间仅保留合法参考，不编档位、不追问不确定时间", () => {
  const f = form();
  const parsed = applyParsedToForm({ form: f, config: previewConfig, result: { intake: {}, parse: { echo: { deadline_days: 10, deadline_phrase: "十天后" } } } });
  assert.equal(f.deadline_days, "10"); assert.ok(parsed.qids.includes("deadline"));
  const uncertain = applyParsedToForm({ form: f, config: previewConfig, result: { intake: {}, parse: { echo: { deadline_days: 1, deadline_phrase: "下个月" }, deadline_check: { ok: false } } } });
  assert.equal(f.deadline_days, "");
  assert.ok(!uncertain.notes.some(note => /确认|亲自选/.test(note)));
});

test("真实buildIntake未填/不确定时间不补0，主动的0天和10天原值保留", async () => {
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const source = app.slice(app.indexOf("export function buildIntake()"), app.indexOf("async function analyzeDislikes("));
  for (const [value, expected] of [["", undefined], [null, undefined], ["0", 0], ["10", 10]]) {
    const state = { form: { ...form(), deadline_days: value } };
    const result = vm.runInNewContext(`${source.replace("export function", "function")}\nbuildIntake()`, { state, CONTRACT_VERSION: "test", amountCents: () => null, composeAdditionalContext });
    assert.equal(result.deadline_days, expected);
    assert.equal(Object.hasOwn(result, "deadline_days"), expected !== undefined);
    assert.equal(result.dislikes, original);
  }
});
