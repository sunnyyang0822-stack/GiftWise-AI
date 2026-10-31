import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { previewConfig } from "../public/js/preview-api.js";
import { setupChat, interpret, chatProblems, budgetProblems, newChatState } from "../public/js/chat.js";

const freshForm = () => ({
  recipient_relation: null, recipient_relation_other: "", closeness: null, occasion: null, occasion_other: "",
  budget_mode: "slider", budget_min: "100", budget_max: "300", deadline_days: "", interests: [], interest_confidence: {},
  interests_unknown: false, gift_styles: [], styles_unknown: false, exclusion_tags: [], dislikes: "", previous_gifts: "", additional_context: "",
});
const state = { config: previewConfig, form: freshForm(), chat: newChatState(), analysis: null, confirmedIds: [] };
setupChat({ state, el: () => null, render: () => {}, submit: () => {}, analyze: async () => ({}), buildIntake: () => ({ ...state.form }), invalidateAnalysis: () => {}, restart: () => {} });

test("自由文字：关系、场合、熟悉程度按选项理解，匹配不到时作为“其他”自定义", () => {
  assert.deepEqual(interpret("relation", "我女朋友"), { type: "pick", id: "partner" });
  assert.deepEqual(interpret("relation", "正在追的女生，算是喜欢的人"), { type: "pick", id: "pursuit" });
  assert.deepEqual(interpret("relation", "社团伙伴"), { type: "custom", text: "社团伙伴" });
  assert.deepEqual(interpret("occasion", "情人节"), { type: "pick", id: "festival" });
  assert.deepEqual(interpret("occasion", "她的生日"), { type: "pick", id: "birthday" });
  assert.deepEqual(interpret("closeness", "不熟悉"), { type: "pick", id: "unfamiliar" });
  assert.deepEqual(interpret("closeness", "非常熟悉"), { type: "pick", id: "very_familiar" });
  assert.deepEqual(interpret("closeness", "跳过"), { type: "skip" });
});

test("自由文字：预算与时间解析，滑条只接受 50 的倍数且不超过 1000", () => {
  assert.deepEqual(interpret("budget", "200-500"), { type: "budget", mode: "slider", min: "200", max: "500" });
  assert.deepEqual(interpret("budget", "1500以内"), { type: "budget", mode: "other", min: "0", max: "1500" });
  assert.deepEqual(interpret("budget", "120到380"), { type: "budget", mode: "other", min: "120", max: "380" });
  assert.deepEqual(interpret("budget", "不花钱"), { type: "budget", mode: "zero", min: "0", max: "0" });
  assert.deepEqual(interpret("budget", "看情况"), { type: "unclear" });
  assert.deepEqual(interpret("deadline", "明天就要"), { type: "pick", id: "1" });
  assert.deepEqual(interpret("deadline", "下周"), { type: "pick", id: "7" });
  assert.deepEqual(interpret("deadline", "两周后"), { type: "pick", id: "30" });
  assert.deepEqual(interpret("deadline", "三个月"), { type: "pick", id: "90" });
});

test("自由文字：多选兴趣、确定程度；“需要避免的”原话不在前端解释成类别", () => {
  const r = interpret("interests", "喜欢咖啡，也爱旅行");
  assert.equal(r.type, "multi");
  assert.ok(r.ids.includes("coffee_food") && r.ids.includes("travel_exploration"));
  assert.deepEqual(interpret("interests", "不清楚"), { type: "unknown" });
  assert.deepEqual(interpret("confidence", "不确定，猜的"), { type: "pick", id: "inferred" });
  assert.deepEqual(interpret("confidence", "很确定"), { type: "pick", id: "confirmed" });
  assert.deepEqual(interpret("avoid", "不要香水"), { type: "text", text: "不要香水" });
  assert.deepEqual(interpret("previous", "没送过"), { type: "skip" });
  assert.deepEqual(interpret("previous", "去年送过香水"), { type: "text", text: "去年送过香水" });
});

test("逐题校验：缺关系先回到第一题；预算倒置、超限、非法均阻止；合法预算无需额外确认", () => {
  Object.assign(state.form, freshForm());
  assert.equal(chatProblems()[0].qid, "relation");
  Object.assign(state.form, { recipient_relation: "other" });
  assert.equal(chatProblems()[0].qid, "relation_other");
  Object.assign(state.form, { recipient_relation: "pursuit", occasion: "other" });
  assert.equal(chatProblems()[0].qid, "occasion_other");
  Object.assign(state.form, { occasion: "birthday", budget_mode: "other", budget_min: "500", budget_max: "100" });
  assert.equal(budgetProblems()[0].code, "INVALID_BUDGET_RANGE");
  Object.assign(state.form, { budget_max: "20000" });
  assert.equal(budgetProblems()[0].code, "LIMIT_EXCEEDED");
  Object.assign(state.form, { budget_min: "", budget_max: "100" });
  assert.equal(budgetProblems()[0].code, "INVALID_AMOUNT");
  Object.assign(state.form, { budget_mode: "slider", budget_min: "120", budget_max: "300" });
  assert.equal(budgetProblems()[0].code, "INVALID_BUDGET_RANGE");
  Object.assign(state.form, { budget_mode: "slider", budget_min: "100", budget_max: "300" });
  assert.deepEqual(budgetProblems(), []);
  assert.equal(chatProblems()[0].qid, "deadline");
  Object.assign(state.form, { deadline_days: "5" });
  assert.deepEqual(chatProblems(), [], "以前送过、补充、需要避免的均为选填");
});

test("对话源码：用户输入只走 textContent/value，不使用 innerHTML；placeholder 与字段名保持契约", async () => {
  const src = await readFile(new URL("../public/js/chat.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML/);
  assert.match(src, /placeholder:"讨厌的东西，过敏，衣服尺码未知"/);
  assert.match(src, /field: "previous_gifts"/);
  assert.match(src, /field: "dislikes"/);
  assert.doesNotMatch(src, /模拟|预览|示例数据|非真实/);
});
