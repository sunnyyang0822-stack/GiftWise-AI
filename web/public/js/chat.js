/**
 * GiftWise AI · 对话式需求收集：一次只问一个问题，选项卡点选或底部输入框简短回答。
 *
 * 边界：
 *   - 只负责收集与逐题校验 intake 字段；提交、识别接口与结果页仍由 app.js 负责；
 *   - 自由文字理解集中在 interpret(questionId, text)：以后接真实 AI 时只替换这一个函数；
 *   - 用户输入一律以 textContent / value 渲染，不使用 innerHTML；
 *   - 前端不解释“需要避免的”原话里的关键词，原话交给 /api/exclusions/analyze 识别并逐条确认。
 */
import { icon, OPTION_ICONS, DEADLINE_ICONS } from "./icons.js";
import {
  applyParsedToForm, budgetDisplayText, deadlineDisplayText, overriddenRows, literalPreferences,
  requiredFollowups, echoBudgetAmount, echoDeadlineDays, echoDeadlinePhrase,
} from "./parse-intake.js";

const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
export const codePoints = value => [...value].length;
export const moneyCents = value => AMOUNT_RE.test(value) ? Number(value.split(".")[0]) * 100 + Number((value.split(".")[1] || "").padEnd(2, "0")) : null;
const TYPING_MS = 560;
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** app.js 注入：{ state, el, render, submit, analyze, buildIntake, invalidateAnalysis, restart } */
let api = null;
export function setupChat(options) { api = options; }

const st = () => api.state;
const form = () => api.state.form;
const labels = () => api.state.config.labels;
const el = (...args) => api.el(...args);
const zh = (list, id) => list.find(x => x.id === id)?.zh || "";
const opt = (id, label, iconName) => ({ id, label, icon: iconName || OPTION_ICONS[id] || "sparkles" });
// 恋人、家人本身就说明了亲近程度，不再追问熟悉程度（字段留空，不替用户填）。
const ASK_CLOSENESS = f => !["partner", "family"].includes(f.recipient_relation);
// 追求对象问“相处得怎么样”，三档映射到契约里的熟悉程度 ID。
const PURSUIT_CLOSENESS = [["unfamiliar", "刚认识不久"], ["familiar", "聊得挺多"], ["very_familiar", "已经很熟"]];
const closenessLabel = id => (form().recipient_relation === "pursuit" ? PURSUIT_CLOSENESS.find(([x]) => x === id)?.[1] : null) || zh(labels().closeness, id);
const intakeKey = () => JSON.stringify(api.buildIntake());

export function newChatState() {
  return { done: [], shownKey: null, entryKey: null, entryInterests: null, notes: [], draft: "", enterMe: null,
    analyzing: false, analysisError: null, analysisToken: 0, confirmRestart: false, sheetOpen: false,
    /* 第 1 步解析：parsing = 正在等解析响应；parseReport = 最近一次解析的展示信息
       （原话 / 覆盖 / 原文 / 必答追问）；deadlineAlert = 相对时间必须由用户确认的提示。
       都只是前端记账，不下发任何新字段。 */
    parsing: false, parseReport: null, deadlineAlert: null };
}
export function ensureChat() {
  if (!st().chat) st().chat = newChatState();
  return st().chat;
}
const chat = () => ensureChat();

/* --------------------------------------------------------------- 预算与时间 */

const DEADLINE_SHORT = { 1: "一天", 5: "3–5天", 7: "一周", 30: "一月", 90: "一季度", 365: "一年" };
export function deadlineOptions(config = st().config) {
  const options = config?.deadline_options || config?.ranges?.deadline;
  // 只接受配置给出的六档天数，不在浏览器里重建业务映射。
  if (!Array.isArray(options) || options.length !== 6) return null;
  const normalized = options.map(r => ({ ...r, days: Number.isInteger(r.days) ? r.days : r.available_days }));
  return normalized.every(r => typeof r.label === "string" && Number.isInteger(r.days) && r.days >= 0 && r.days <= 365)
    && new Set(normalized.map(r => r.days)).size === 6 ? normalized : null;
}
export function budgetProblems() {
  const f = form(), errors = [];
  const min = moneyCents(f.budget_min), max = moneyCents(f.budget_max);
  if (!["slider", "zero", "other"].includes(f.budget_mode)) errors.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "预算还不确定，先定一个大概的范围吧。" });
  if (min === null || max === null) errors.push({ code: "INVALID_AMOUNT", message: "预算两端都需要填写：非负金额，最多两位小数。" });
  else if (min > 1000000 || max > 1000000) errors.push({ code: "LIMIT_EXCEEDED", message: "礼物预算最高为 10000 元。" });
  else if (min > max) errors.push({ code: "INVALID_BUDGET_RANGE", message: "预算下限不能高于上限。" });
  else if (f.budget_mode === "slider" && (max > 100000 || min % 5000 || max % 5000)) errors.push({ code: "INVALID_BUDGET_RANGE", message: "滑条区间在 0–1000 元内，每次调整 50 元。" });
  else if (f.budget_mode === "zero" && (min !== 0 || max !== 0)) errors.push({ code: "INVALID_BUDGET_RANGE", message: "不花钱的心意应为 0–0 元。" });
  return errors;
}
const sliderValues = () => {
  const f = form();
  const ok = f.budget_mode === "slider" && !budgetProblems().length;
  return ok ? { min: f.budget_min, max: f.budget_max } : { min: "100", max: "300" };
};
const budgetText = () => budgetDisplayText(form(), parseBlock());
/**
 * 最近一次第 1 步解析的 parse 块；没有解析过就是 null（展示层据此决定是否回显原值）。
 * 兜底读 chat().parseReport.parse：只要这次对话确实解析过，⛔ 就绝不能退回显示服务端带宽。
 */
const parseBlock = () => st().parseintake?.parse || chat().parseReport?.parse || null;
/** 用户自己改了预算 ⇒ 之前解析回显的原值不再代表当前输入，清掉（避免展示与提交不一致）。 */
function clearParsedBudget() {
  const f = form();
  f.budget_amount = "";
  f.budget_phrase = "";
}
const textLimit = (value, message) => codePoints(value) > 1000 ? message : null;
const LONG_TEXT = "需要避免的、以前送过的礼物和补充说明，每项最多 1000 字。";

/* ------------------------------------------------------------------ 题目 */

const QUESTIONS = [
  {
    id: "relation", group: 0, kind: "single",
    ask: () => ["先说说，这份礼物想送给谁？"],
    options: () => labels().relations.map(x => opt(x.id, x.zh)),
    selected: () => form().recipient_relation,
    pick: id => { const f = form(); f.recipient_relation = id; if (f.recipient_relation !== "other") f.recipient_relation_other = ""; if (!ASK_CLOSENESS(f)) f.closeness = null; },
    answer: () => zh(labels().relations, form().recipient_relation),
    check: () => form().recipient_relation ? null : "请选择送礼对象的关系。",
  },
  {
    id: "relation_other", group: 0, kind: "text", when: f => f.recipient_relation === "other",
    ask: () => ["TA 是你的……？用一两个词说说你们的关系。"],
    placeholder: "例如：社团伙伴", aria: "其他关系", field: "recipient_relation_other",
    get: () => form().recipient_relation_other,
    set: value => { form().recipient_relation_other = value; },
    answer: () => form().recipient_relation_other.trim(),
    check: () => {
      const f = form();
      if (!f.recipient_relation_other.trim()) return "请填写你与对方的关系。";
      return textLimit(f.recipient_relation_other, "自定义关系和场合最多填写 1000 字。");
    },
  },
  {
    id: "closeness", group: 0, kind: "single", skip: "跳过", when: ASK_CLOSENESS,
    ask: () => [form().recipient_relation === "pursuit" ? "你们现在相处得怎么样？" : "你们有多熟？"],
    options: () => form().recipient_relation === "pursuit"
      ? PURSUIT_CLOSENESS.map(([id, label]) => opt(id, label))
      : labels().closeness.map(x => opt(x.id, x.zh)),
    selected: () => form().closeness,
    pick: id => { form().closeness = id; },
    skipAction: () => { form().closeness = null; },
    answer: () => form().closeness ? closenessLabel(form().closeness) : "先跳过",
  },
  {
    id: "occasion", group: 0, kind: "single",
    ask: () => ["这次是什么场合？"],
    options: () => labels().occasions.map(x => opt(x.id, x.zh)),
    selected: () => form().occasion,
    pick: id => { const f = form(); f.occasion = id; if (f.occasion !== "other") f.occasion_other = ""; },
    answer: () => zh(labels().occasions, form().occasion),
    check: () => form().occasion ? null : "请选择送礼场合。",
  },
  {
    id: "occasion_other", group: 0, kind: "text", when: f => f.occasion === "other",
    ask: () => ["是什么场合呢？简单说说就好。"],
    placeholder: "例如：搬家庆祝", aria: "其他送礼场合", field: "occasion_other",
    get: () => form().occasion_other,
    set: value => { form().occasion_other = value; },
    answer: () => form().occasion_other.trim(),
    check: () => {
      const f = form();
      if (!f.occasion_other.trim()) return "请填写具体送礼场合。";
      return textLimit(f.occasion_other, "自定义关系和场合最多填写 1000 字。");
    },
  },
  {
    id: "budget", group: 0, kind: "budget",
    ask: () => ["这份心意，大概想花多少？"],
    answer: budgetText,
    check: () => budgetProblems()[0]?.message || null,
  },
  {
    id: "deadline", group: 0, kind: "single",
    ask: () => ["大概多久之后送出？"],
    options: () => (deadlineOptions() || []).map(r => opt(String(r.days), DEADLINE_SHORT[r.days] || r.label, DEADLINE_ICONS[r.days])),
    selected: () => form().deadline_days,
    pick: id => { form().deadline_days = id; },
    // 原值回显优先：解析给过 echo.deadline_days 且仍然是当前取值时，显示用户输入的原值（不显示 ±1 天区间）。
    answer: () => deadlineDisplayText(form(), parseBlock()) || (deadlineOptions() || []).find(r => String(r.days) === form().deadline_days)?.label || "",
    check: () => {
      const options = deadlineOptions();
      if (!options) return "准备时间的选项还没有准备好，请稍后刷新再试。";
      return options.some(r => String(r.days) === form().deadline_days) ? null : "请选择可用准备时间。";
    },
  },
  {
    id: "interests", group: 1, kind: "multi",
    ask: () => ["TA 平时喜欢什么？可以多选。"],
    options: () => labels().interests.map(x => opt(x.id, x.zh)),
    list: () => form().interests,
    toggle: id => {
      const f = form();
      f.interests_unknown = false;
      if (f.interests.includes(id)) { f.interests = f.interests.filter(x => x !== id); delete f.interest_confidence[id]; }
      else { f.interests.push(id); if (!(id in f.interest_confidence)) f.interest_confidence[id] = "inferred"; }
    },
    unknown: { label: "不太清楚", icon: "shrug" },
    unknownAction: () => { const f = form(); f.interests_unknown = true; f.interests = []; f.interest_confidence = {}; },
    commitAction: () => { form().interests_unknown = false; },
    answer: () => {
      const f = form();
      return f.interests_unknown || !f.interests.length ? "不太清楚" : f.interests.map(id => zh(labels().interests, id)).join("、");
    },
  },
  {
    id: "confidence", group: 1, kind: "single", when: f => !f.interests_unknown && f.interests.length > 0,
    ask: () => ["这些是你确定知道的，还是猜的？"],
    options: () => [opt("confirmed", "很确定", "check"), opt("inferred", "大概是，有些是猜的", "lightbulb")],
    selected: () => {
      const f = form();
      if (!f.interests.length) return null;
      return f.interests.every(id => f.interest_confidence[id] === "confirmed") ? "confirmed" : "inferred";
    },
    pick: level => { const f = form(); f.interest_confidence = Object.fromEntries(f.interests.map(id => [id, level])); },
    answer: () => {
      const f = form();
      return f.interests.every(id => f.interest_confidence[id] === "confirmed") ? "很确定" : "大概是，有些是猜的";
    },
  },
  {
    id: "styles", group: 1, kind: "multi",
    ask: () => ["想送出什么感觉的礼物？可以多选。"],
    options: () => labels().gift_styles.map(x => opt(x.id, x.zh)),
    list: () => form().gift_styles,
    toggle: id => {
      const f = form();
      f.styles_unknown = false;
      f.gift_styles = f.gift_styles.includes(id) ? f.gift_styles.filter(x => x !== id) : [...f.gift_styles, id];
    },
    unknown: { label: "还没想法", icon: "question" },
    unknownAction: () => { const f = form(); f.styles_unknown = true; f.gift_styles = []; },
    commitAction: () => { form().styles_unknown = false; },
    answer: () => {
      const f = form();
      return f.styles_unknown || !f.gift_styles.length ? "还没想法" : f.gift_styles.map(id => zh(labels().gift_styles, id)).join("、");
    },
  },
  {
    id: "avoid", group: 2, kind: "avoid",
    ask: () => ["有什么需要避开的吗？点类别，或在下方写一句。"],
    options: () => labels().exclusions.map(x => opt(x.id, x.zh, x.id === "other" ? "ban" : undefined)),
    list: () => form().exclusion_tags,
    toggle: id => { const f = form(); f.exclusion_tags = f.exclusion_tags.includes(id) ? f.exclusion_tags.filter(x => x !== id) : [...f.exclusion_tags, id]; },
    placeholder:"讨厌的东西，过敏，衣服尺码未知",
    aria: "需要避免的", field: "dislikes",
    answer: () => {
      const f = form();
      const parts = f.exclusion_tags.map(id => zh(labels().exclusions, id));
      if (f.dislikes.trim()) parts.push(`「${f.dislikes.trim()}」`);
      return parts.length ? parts.join("、") : "没有要避开的";
    },
    check: () => textLimit(form().dislikes, LONG_TEXT),
  },
  {
    id: "previous", group: 2, kind: "text", skip: "没送过",
    ask: () => ["以前送过 TA 什么吗？写下来，方便参考、避免重复。"],
    placeholder: "例如：去年送过香水，上次送过一本摄影集", aria: "以前送过什么？", field: "previous_gifts",
    get: () => form().previous_gifts,
    set: value => { form().previous_gifts = value; },
    answer: () => form().previous_gifts.trim() || "没送过",
    check: () => textLimit(form().previous_gifts, LONG_TEXT),
  },
  {
    id: "extra", group: 2, kind: "text", skip: "没有了",
    ask: () => ["最后，还有什么想补充的吗？"],
    placeholder: "例如：希望表达感谢，不造成回应压力。", aria: "补充说明", field: "additional_context",
    get: () => form().additional_context,
    set: value => { form().additional_context = value; },
    answer: () => form().additional_context.trim() || "没有了",
    check: () => textLimit(form().additional_context, LONG_TEXT),
  },
  {
    // 识别必须在全部字段确定之后：服务端按完整 intake 绑定识别结果。
    id: "avoid_confirm", group: 2, kind: "confirm", when: f => f.dislikes.trim() !== "",
    ask: () => ["关于要避开的，我是这样理解的："],
    answer: () => {
      const a = st().analysis;
      const names = (a?.candidates || []).map(c => understanding(c));
      return names.length ? `都对，避开：${names.join("、")}` : "已确认";
    },
  },
  { id: "summary", group: 2, kind: "summary", ask: () => ["我把你说的整理成了一张心意清单，看看对不对："] },
];
const byId = id => QUESTIONS.find(q => q.id === id);
const applicable = () => QUESTIONS.filter(q => !q.when || q.when(form()));
const current = () => applicable().find(q => q.kind === "summary" || !chat().done.includes(q.id));
const understanding = c => c.kind === "tag" ? (zh(labels().exclusions, c.tag) || c.tag) : c.term;

/**
 * 第 1 步解析留下的**必答**项（`required_followups[].required === true`）。
 * 已答完时返回 []。城市走 additional_context 这条既有字段；相对时间必须由用户确认，
 * 因为模型对相对时间不稳定（后端实测：同一句「下个月」一次 30 天、一次 1 天）。
 * 其余必答项（例如排除项识别）由既有 /api/exclusions/analyze 流程负责，这里不重复拦。
 */
export function parseFollowups() {
  const report = chat().parseReport;
  if (!report || !report.parse) return [];
  const f = form();
  return requiredFollowups(report.parse).filter(item => {
    if (item.id === "deadline_confirm") return report.deadlinePending === true;
    if (item.id === "city") return !String(f.city_answer || "").trim();
    return false;
  });
}

/** 提交前整体校验：返回第一个需要回到的题目与提示。 */
export function chatProblems() {
  for (const q of applicable()) {
    const message = q.check?.();
    if (message) return [{ qid: q.id, code: "INTAKE_CLARIFICATION_REQUIRED", message }];
  }
  const pending = parseFollowups();
  if (pending.length) {
    return [{ qid: "summary", code: "INTAKE_CLARIFICATION_REQUIRED", message: pending[0].question || "还有一个必答问题需要你确认。" }];
  }
  return [];
}
export function chatProgress() {
  const list = applicable().filter(q => q.kind !== "summary");
  const q = current();
  const done = q.kind === "summary";
  return { index: done ? list.length : list.indexOf(q) + 1, total: list.length, group: q.group, done };
}

/* -------------------------------------------------------------- 状态推进 */

function finish(q) {
  const c = chat();
  if (!c.done.includes(q.id)) c.done.push(q.id);
  // 任何改动 intake 的回答都会让之前的限制识别失效，需要重新识别并确认。
  if (q.id !== "avoid_confirm" && c.entryKey !== null && intakeKey() !== c.entryKey) {
    api.invalidateAnalysis();
    c.done = c.done.filter(x => x !== "avoid_confirm");
    c.analysisError = null;
  }
  if (q.id === "interests" && c.entryInterests !== JSON.stringify(form().interests)) c.done = c.done.filter(x => x !== "confidence");
  // 用户亲手选了期限（含「跳过」之外的任何一次选择）就视为完成了相对时间的必答确认。
  if (q.id === "deadline") {
    c.deadlineAlert = null;
    if (c.parseReport) c.parseReport.deadlinePending = false;
  }
  c.notes = [];
  c.draft = "";
  c.enterMe = q.id;
  api.render();
}
function note(text, userText) {
  const c = chat();
  if (userText) c.notes.push({ role: "me", text: userText });
  c.notes.push({ role: "bot", text });
  api.render();
  revealCurrent();
}
function attempt(q, userText) {
  const message = q.check?.();
  if (message) { note(message, userText); return; }
  finish(q);
}
/** 回到某一题重新回答；其他已答内容全部保留。 */
export function reopen(qid, message) {
  const c = chat();
  c.done = c.done.filter(x => x !== qid);
  c.notes = message ? [{ role: "bot", text: message }] : [];
  c.confirmRestart = false;
  api.render();
}
async function runAnalysis() {
  const c = chat();
  const token = ++c.analysisToken;
  c.analyzing = true;
  c.analysisError = null;
  api.render();
  try {
    const analysis = await api.analyze(api.buildIntake());
    if (token !== c.analysisToken) return;
    st().analysis = analysis;
    st().confirmedIds = [];
  } catch {
    if (token !== c.analysisToken) return;
    c.analysisError = "刚刚没能读懂这句话，再试一次好吗？";
  }
  c.analyzing = false;
  api.render();
  revealCurrent();
}

/* ------------------------------------------------------------ 自由文字 */

const SYNONYMS = {
  relation: [
    ["partner", ["恋人", "女朋友", "男朋友", "女友", "男友", "对象", "老婆", "老公", "爱人", "伴侣", "媳妇", "另一半"]],
    ["pursuit", ["追求", "喜欢的人", "暗恋", "心动", "在追"]],
    ["friend", ["朋友", "闺蜜", "好友", "兄弟", "哥们", "室友", "死党"]],
    ["family", ["家人", "妈", "爸", "父亲", "母亲", "爷爷", "奶奶", "外公", "外婆", "哥哥", "姐姐", "弟弟", "妹妹", "亲戚"]],
    ["classmate", ["同学", "学长", "学姐", "学弟", "学妹"]],
    ["mentor", ["老师", "导师", "教授"]],
    ["client_partner", ["客户", "合作伙伴", "甲方", "合作方"]],
  ],
  closeness: [
    ["unfamiliar", ["几乎不了解", "不熟", "刚认识"]],
    ["limited", ["了解不多", "不太熟", "一般"]],
    ["very_familiar", ["非常熟", "很熟", "特别熟", "超熟"]],
    ["familiar", ["比较熟", "挺熟", "熟悉", "还算熟"]],
    ["unknown", ["不确定", "说不好", "不知道"]],
  ],
  occasion: [
    ["birthday", ["生日"]],
    ["anniversary", ["纪念日", "周年", "纪念"]],
    ["graduation_promotion", ["毕业", "升职", "升学", "入职", "晋升", "上岸"]],
    ["thanks", ["感谢", "谢谢", "答谢", "道谢"]],
    ["festival", ["节", "春节", "圣诞", "中秋", "七夕", "新年", "元旦"]],
  ],
};
const UNKNOWN_RE = /^(不知道|不清楚|不太清楚|随便|没想好|还没想法|不确定)$/;
const SKIP_RE = /^(跳过|没有|没|无|不用|没送过|没了|没有了|算了|不知道)$/;
const CN_DIGITS = { 一: "1", 两: "2", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10", 半: "0.5" };
const labelParts = label => label.split(/与|和|\/|、/).map(x => x.trim()).filter(Boolean);

function matchSingle(qid, text, options) {
  // 先查同义词（“女朋友”不能被“朋友”抢先），再查选项文字本身。
  for (const [id, words] of SYNONYMS[qid] || []) if (words.some(w => text.includes(w)) && options.some(o => o.id === id)) return id;
  for (const o of options) if (o.id !== "other" && labelParts(o.label).some(part => text.includes(part))) return o.id;
  return null;
}
function parseBudget(text) {
  const t = text.replace(/\s|,|，/g, "");
  if (/不花钱|免费|零预算|^0元?$|不用花/.test(t)) return { mode: "zero", min: "0", max: "0" };
  const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map(m => m[0]);
  if (!nums.length) return null;
  let min, max;
  if (nums.length >= 2) [min, max] = nums;
  else if (/以内|以下|之内|不超过|最多/.test(t)) [min, max] = ["0", nums[0]];
  else if (/左右|大概|差不多/.test(t)) {
    const n = Number(nums[0]);
    [min, max] = [String(Math.max(0, Math.round(n * 0.8 / 50) * 50)), String(Math.round(n * 1.2 / 50) * 50)];
  } else if (/以上|起|至少/.test(t)) return null;
  else [min, max] = ["0", nums[0]];
  const slider = [min, max].every(v => /^\d+$/.test(v) && Number(v) % 50 === 0 && Number(v) <= 1000);
  return { mode: slider ? "slider" : "other", min, max };
}
function parseDeadline(text) {
  const t = text.replace(/\s/g, "");
  if (/明天|今天|马上|当天|立刻/.test(t)) return 1;
  if (/几天|这周|本周|后天/.test(t)) return 5;
  if (/下周/.test(t)) return 7;
  if (/下个月/.test(t)) return 30;
  if (/明年|年底/.test(t)) return 365;
  const n = t.replace(/[一两二三四五六七八九十半]/g, d => CN_DIGITS[d]);
  const m = n.match(/(\d+(?:\.\d+)?)个?(天|日|周|星期|礼拜|月|季度|年)/);
  if (!m) return null;
  const unit = { 天: 1, 日: 1, 周: 7, 星期: 7, 礼拜: 7, 月: 30, 季度: 90, 年: 365 }[m[2]];
  const days = Math.ceil(Number(m[1]) * unit);
  return (deadlineOptions() || []).map(r => r.days).sort((a, b) => a - b).find(d => d >= days) ?? null;
}

/**
 * 把一句自由文字理解为当前题目的回答。现在是本地规则；接入 AI 后替换本函数即可，
 * 返回结构保持：pick / custom / multi / unknown / skip / text / budget / submit / unclear。
 */
export function interpret(questionId, text) {
  const q = byId(questionId);
  const t = text.trim();
  if (!q || !t) return { type: "unclear" };
  if (q.kind === "single") {
    if (q.skip && SKIP_RE.test(t)) return { type: "skip" };
    if (questionId === "confidence") {
      if (/猜|大概|可能|不确定|应该|也许/.test(t)) return { type: "pick", id: "inferred" };
      if (/确定|肯定|知道|没错|是的/.test(t)) return { type: "pick", id: "confirmed" };
      return { type: "unclear" };
    }
    if (questionId === "deadline") {
      const days = parseDeadline(t);
      return days === null ? { type: "unclear" } : { type: "pick", id: String(days) };
    }
    const id = matchSingle(questionId, t, q.options());
    if (id) return { type: "pick", id };
    if (q.options().some(o => o.id === "other")) return { type: "custom", text: t };
    return { type: "unclear" };
  }
  if (q.kind === "multi") {
    if (UNKNOWN_RE.test(t)) return { type: "unknown" };
    const ids = q.options().filter(o => labelParts(o.label).some(part => t.includes(part))).map(o => o.id);
    return ids.length ? { type: "multi", ids } : { type: "unclear" };
  }
  if (q.kind === "budget") {
    const budget = parseBudget(t);
    return budget ? { type: "budget", ...budget } : { type: "unclear" };
  }
  if (q.kind === "avoid") return SKIP_RE.test(t) ? { type: "skip" } : { type: "text", text };
  if (q.kind === "text") return q.skip && SKIP_RE.test(t) ? { type: "skip" } : { type: "text", text };
  if (q.kind === "summary" && /生成|开始|好了|可以|没问题|ok/i.test(t)) return { type: "submit" };
  return { type: "unclear" };
}

function applyText(q, text) {
  const result = interpret(q.id, text);
  const said = text.trim();
  const f = form();
  switch (result.type) {
    case "pick": choose(q, result.id, said); return;
    case "skip":
      if (q.kind === "avoid") { f.exclusion_tags = []; f.dislikes = ""; finish(q); return; }
      if (q.kind === "text") { q.set(""); finish(q); return; }
      q.skipAction?.(); finish(q); return;
    case "custom":
      if (q.id === "relation") { f.recipient_relation = "other"; f.recipient_relation_other = said; }
      else { f.occasion = "other"; f.occasion_other = said; }
      if (!chat().done.includes(q.id)) chat().done.push(q.id);
      attempt(byId(`${q.id}_other`), said);
      return;
    case "multi":
      for (const id of result.ids) if (!q.list().includes(id)) q.toggle(id);
      q.commitAction?.(); finish(q); return;
    case "unknown": q.unknownAction(); finish(q); return;
    case "budget":
      f.budget_mode = result.mode; f.budget_min = result.min; f.budget_max = result.max;
      clearParsedBudget();
      attempt(q, said); return;
    case "text":
      if (q.kind === "avoid") { f.dislikes = text; attempt(q, said); return; }
      q.set(text); attempt(q, said); return;
    case "submit": api.submit(); return;
    default:
      note(q.kind === "summary" || q.kind === "confirm" ? "点一下上面的按钮就好，想改哪一项也可以点「改一下」。" : "我还没完全明白，可以点一下上面的选项，或者换个说法告诉我。", said);
  }
}
function choose(q, id, userText) {
  q.pick(id);
  attempt(q, userText);
}

/* ------------------------------------------------- 第 1 步：自然语言解析 */
/*
 * 用户在输入框里写的那句话**就是**要用 `/api/intake/parse` 解析的用户原话。
 * 这里只做分流，不做任何业务猜测：
 *   · ready / needs_input → 把服务端合并好的 intake 落到**现有**表单字段上，跳过已被覆盖的题；
 *   · empty               → ⛔ 不猜：一个字段都不改，只如实说「没读懂」；
 *   · degraded / disabled / 真实传输失败 → ⛔ 不报错：回落到本地规则（接入大模型之前的既有表单路径）。
 * 三态都必须让用户能走到三个候选 —— 没有「卡在解析」的分支。
 */
const PARSE_KINDS = new Set(["single", "multi", "budget", "text", "avoid"]);
const PARSE_EMPTY_NOTE =
  "这句我没读出能落到清单上的信息，所以没有替你猜：一个字段都没改。你可以直接点下面的选项，或换一句更具体的说法（例如「女朋友，生日，预算 600，下个月要用」）。";
const PARSE_DEGRADED_NOTE =
  "这一次的自然语言解析没有完成，我没有改你填的任何内容；按你原来的填写继续就好。";

function send() {
  const c = chat();
  const q = current();
  if (!c.draft.trim()) {
    if (q.kind === "avoid") commitAvoid(q);
    return;
  }
  const said = c.draft;
  if (!PARSE_KINDS.has(q.kind) || typeof api.parseText !== "function") { applyText(q, said); return; }
  void answerWithParse(q, said);
}

/** 解析在途时先把用户原话留在对话里，并按三态分流。 */
async function answerWithParse(q, said) {
  const c = chat();
  c.parsing = true;
  c.notes = [];
  c.draft = "";
  api.render();
  let result = null;
  try { result = await api.parseText(said); } catch { result = null; }
  c.parsing = false;
  const status = result?.status || "degraded";
  const parse = result?.parse || null;
  const overrides = overriddenRows(parse);
  const literals = literalPreferences(parse);
  c.parseReport = {
    text: said, status, parse, overrides, literals,
    notices: Array.isArray(result?.notices) ? result.notices : [],
    applied: [], dropped: [], deadlinePending: false,
  };

  if (status === "ready" || status === "needs_input") {
    const applied = applyParsedToForm({ form: form(), config: st().config, result });
    c.parseReport.applied = applied.notes;
    c.parseReport.dropped = applied.dropped;
    if (applied.qids.length > 0) {
      st().parseText = said;
      for (const qid of applied.qids) if (!c.done.includes(qid)) c.done.push(qid);
      // 解析改动了 intake ⇒ 之前的限制识别结果作废，必须重新逐条确认（与 finish() 同口径）。
      api.invalidateAnalysis();
      c.done = c.done.filter(x => x !== "avoid_confirm");
      const lines = ["我按你这句原话把清单填好了：", ...applied.notes.map(n => `· ${n}`)];
      if (overrides.length) {
        lines.push("你填的选项已被你的原话覆盖：", ...overrides.map(r => `· ${r.label}：${r.from} → ${r.to}`));
      }
      if (literals.length) {
        lines.push("你的喜好原话（原样保留，不用预设类目替代）：", ...literals.map(t => `「${t}」`));
      }
      /* 相对时间（例：「下个月」）模型换算不稳定 ⇒ ⛔ 不静默采用：
         把期限这一题退回去，让用户看着模型算的值与原话的差额**亲自确认一次**。 */
      const confirmItem = requiredFollowups(parse).find(item => item.id === "deadline_confirm");
      if (confirmItem) {
        c.deadlineAlert = {
          phrase: parse?.deadline_check?.phrase || echoDeadlinePhrase(parse) || "",
          current: Number.isInteger(confirmItem.current_value) ? confirmItem.current_value : null,
          expected: Number.isInteger(confirmItem.expected) ? confirmItem.expected
            : (Number.isInteger(confirmItem.suggested_value) ? confirmItem.suggested_value : null),
          reason: typeof confirmItem.reason === "string" ? confirmItem.reason : (parse?.deadline_check?.reason || ""),
        };
        c.parseReport.deadlinePending = true;
        c.done = c.done.filter(x => x !== "deadline");
        lines.push("还有一件事要你亲自确认：期限是相对时间，模型换算不稳定，下面这题请你点一个要用的准备时间。");
      }
      c.done = [...new Set(c.done)];
      c.notes = [{ role: "me", text: said }, { role: "bot", texts: lines }];
      api.render();
      revealCurrent();
      return;
    }
    // ready 但没有任何字段能落到表单上 ⇒ 等同于没读懂，按 empty 的口径处理（不猜）。
  }

  if (status === "empty") {
    c.notes = [{ role: "me", text: said }, { role: "bot", text: PARSE_EMPTY_NOTE }];
    api.render();
    revealCurrent();
    return;
  }

  /* degraded / disabled / 传输失败：⛔ 不报错，回落到既有表单路径继续。 */
  c.notes = [{ role: "me", text: said }];
  applyText(q, said);
  const reason = c.parseReport.notices[0] || PARSE_DEGRADED_NOTE;
  if (!c.notes.some(n => n.role === "bot" && (n.text === reason || (n.texts || []).includes(reason)))) {
    c.notes.push({ role: "bot", text: reason });
  }
  api.render();
  revealCurrent();
}
function commitAvoid(q) {
  form().dislikes = chat().draft;
  attempt(q);
}

/* ---------------------------------------------------------------- 渲染 */
/*
 * 聊天面板：头部（小礼头像、进度、清单、重新开始）+ 面板内滚动的消息区 + 贴底输入区；
 * 桌面 ≥1100px 右侧“心意清单”侧栏，窄屏收为头部胶囊 + 底部抽屉。
 * 每一题 = 助手一组气泡（承接上一答 + 提问）+ 贴在提问下方的“附件卡”（选项/滑条），
 * 答完后附件卡收起为只读的已选状态，用户回答以右侧轻气泡显示，可“改一下”。
 */

const BOT_NAME = "小礼";
const PLACEHOLDERS = {
  relation: "比如：我女朋友、正在追的人",
  relation_other: "比如：社团伙伴",
  closeness: "比如：认识两年，挺熟",
  occasion: "比如：她的生日、毕业",
  occasion_other: "比如：搬家庆祝",
  budget: "比如：200 到 500、500 以内",
  deadline: "比如：下周、两周后",
  interests: "比如：喜欢拍照、爱喝咖啡",
  confidence: "比如：很确定，或者是猜的",
  styles: "比如：实用一点、有纪念意义",
  summary: "说“生成”，或点上面的按钮",
  avoid_confirm: "也可以点上面的按钮确认",
};
const QUICK = {
  previous: ["去年送过一本书", "送过围巾"],
  extra: ["希望低调一点，不给 TA 压力", "想表达感谢"],
};
const SHEET = [
  { qid: "relation", icon: "user", term: "送给", covers: ["relation", "relation_other", "closeness"] },
  { qid: "occasion", icon: "calendar", term: "场合", covers: ["occasion", "occasion_other"] },
  { qid: "budget", icon: "wallet", term: "预算", covers: ["budget"] },
  { qid: "deadline", icon: "clock", term: "送出", covers: ["deadline"] },
  { qid: "interests", icon: "sparkles", term: "喜欢", covers: ["interests", "confidence"] },
  { qid: "styles", icon: "wand", term: "感觉", covers: ["styles"] },
  { qid: "avoid", icon: "ban", term: "避开", covers: ["avoid", "avoid_confirm"] },
  { qid: "previous", icon: "gift", term: "送过", covers: ["previous"] },
  { qid: "extra", icon: "chat", term: "补充", covers: ["extra"] },
];

/** 承接上一题回答的一句自然回应（第一题由开场白承接）。 */
function ackFor(q) {
  const list = applicable();
  const prev = list[list.indexOf(q) - 1];
  if (!prev) return null;
  const f = form();
  switch (prev.id) {
    case "relation": return ({
      partner: "收到，是送给恋人～那我们挑一份有心意、也能融进日常的。",
      pursuit: "收到，追求对象～那我们选得低调又用心一点，不给 TA 压力。",
      friend: "好呀，送朋友～轻松一点、懂 TA 最重要。",
      family: "送家人，实用和陪伴感都很加分。",
      classmate: "同学之间，一起经历过的事最好用。",
      mentor: "送老师或导师，分寸感最重要，我会帮你把握。",
      client_partner: "送客户或合作伙伴，得体大方是关键。",
      other: "好的。",
    })[f.recipient_relation] || "好的。";
    case "relation_other": return `明白了，是你的${f.recipient_relation_other.trim()}。`;
    case "closeness": return f.closeness ? "了解，我会照着这个熟悉程度来拿捏。" : "没关系，这题跳过也可以。";
    case "occasion": return ({
      birthday: "生日呀，那就让礼物带点专属感。",
      festival: "节日的礼物，仪式感可以多一点。",
      thanks: "表达感谢的礼物，真诚比贵重更重要。",
      anniversary: "纪念日，适合有故事的礼物。",
      graduation_promotion: "恭喜 TA！值得好好庆祝一下。",
      other: "好的。",
    })[f.occasion] || "好的。";
    case "occasion_other": return `“${f.occasion_other.trim()}”，记下了。`;
    case "budget": return f.budget_mode === "zero" ? "不花钱的心意也很珍贵，我们往手作和陪伴的方向想。" : `预算 ${budgetText()}，记下了。`;
    case "deadline": return `${prev.answer()}之内送出，我会把准备时间算进去。`;
    case "interests": return f.interests_unknown || !f.interests.length ? "不清楚也没关系，我会从关系和场合出发。" : `${f.interests.length} 个方向，很有参考价值。`;
    case "confidence": return f.interests.every(id => f.interest_confidence[id] === "confirmed") ? "太好了，这些就当作确定的信息。" : "明白，猜的部分我会单独标出来，不当成事实。";
    case "styles": return f.styles_unknown || !f.gift_styles.length ? "没想法也没关系，我来给你几个不同方向。" : "收到，就往这个感觉找。";
    case "avoid": return f.exclusion_tags.length || f.dislikes.trim() ? "记住了，这些会严格避开。" : "好，没有要特别避开的。";
    case "previous": return f.previous_gifts.trim() ? "好的，我会尽量不重复。" : "好的。";
    case "extra": return "信息差不多齐了。";
    case "avoid_confirm": return "谢谢你逐条确认。";
    default: return null;
  }
}
/** 当前题的助手消息：承接 + 提问（已答的题沿用当时的问法）。 */
const botTexts = q => [ackFor(q), ...q.ask()].filter(Boolean);

/* ------------------------------------------------------------ 基础部件 */

/** 小礼头像：品牌四角星标记（白星置于黑圆底，细缎带红描边由 CSS 提供）。 */
function starMark(size) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 48 48"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("class", "gw-star");
  for (const [d, fill] of [
    ["M23 2c2 13 6 17 20 20-14 3-18 7-20 23C20 29 16 25 2 22 16 19 20 15 23 2Z", "currentColor"],
    ["m23 16 2 6-2 7-3-7Z", "var(--gw-avatar-bg, #0f0f10)"],
    ["m41 5 1.5 4.5L47 11l-4.5 1.5L41 17l-1.5-4.5L35 11l4.5-1.5Z", "currentColor"],
  ]) { const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); path.setAttribute("fill", fill); svg.append(path); }
  return svg;
}
function botAvatar(size = "md") {
  return el("span", { class: `gw-bot-avatar gw-bot-avatar--${size}`, "aria-hidden": "true" }, [starMark(size === "lg" ? 24 : 18)]);
}
/** 助手一组消息：组首头像与名字，组内气泡紧凑排列，附件卡贴在最后一条气泡下方。 */
function botGroup(texts, attachment = null, extraClass = "") {
  const bubbles = texts.map(text => el("p", { class: "gw-bubble gw-bubble--bot", text }));
  return el("div", { class: `gw-group gw-group--bot ${extraClass}`.trim() }, [
    botAvatar(),
    el("div", { class: "gw-group__col" }, [
      el("span", { class: "gw-group__name", text: BOT_NAME }),
      ...bubbles,
      attachment,
    ]),
  ]);
}
function meGroup(text, edit = null, enter = false) {
  return el("div", { class: `gw-group gw-group--me${enter ? " is-new" : ""}` }, [
    el("div", { class: "gw-group__col" }, [el("p", { class: "gw-bubble gw-bubble--me", text }), edit]),
  ]);
}
function typingGroup() {
  return el("div", { class: "gw-group gw-group--bot gw-typing", "aria-hidden": "true" }, [
    botAvatar(),
    el("div", { class: "gw-group__col" }, [el("p", { class: "gw-bubble gw-bubble--bot gw-bubble--typing" }, [
      el("span", { class: "gw-dots" }, [el("i"), el("i"), el("i")]),
    ])]),
  ]);
}
function optionButton(o, pressed, onclick, i, field, extraClass = "") {
  return el("button", {
    type: "button", class: `gw-opt ${extraClass}`.trim(), "aria-pressed": String(Boolean(pressed)), "data-field": field,
    style: `--i:${i}`, onclick,
  }, [
    el("span", { class: "gw-opt__icon", "aria-hidden": "true" }, [icon(o.icon, { size: 18 })]),
    el("span", { class: "gw-opt__label", text: o.label }),
  ]);
}
const attach = (children, extraClass = "") => el("div", { class: `gw-attach ${extraClass}`.trim() }, children);
const optionGrid = (label, buttons, cols = "") => el("div", { class: `gw-opts ${cols}`.trim(), role: "group", "aria-label": label }, buttons);

/* ---------------------------------------------------------- 当前题附件卡 */

function singleAttach(q) {
  const selected = q.selected?.();
  const options = q.options();
  if (!options.length) return attach([el("p", { class: "gw-attach__hint", text: q.check?.() || "" })]);
  // 回到某题重答时，上次的选择以细描边提示；点任意一项即作答。
  const buttons = options.map((o, i) => optionButton(o, false, () => choose(q, o.id, o.label), i, `opt-${q.id}-${o.id}`, selected === o.id ? "gw-opt--was" : ""));
  if (q.skip) buttons.push(optionButton(opt("skip", q.skip, "skip"), false, () => { q.skipAction?.(); finish(q); }, options.length, `opt-${q.id}-skip`, "gw-opt--quiet"));
  const alert = q.id === "deadline" ? deadlineAlertNode() : null;
  return attach([alert, optionGrid(q.ask().at(-1), buttons, options.length > 4 ? "gw-opts--grid" : "")].filter(Boolean));
}
function multiAttach(q, { confirmLabel = "选好了", none = null } = {}) {
  const list = q.list();
  const options = q.options();
  const buttons = options.map((o, i) => optionButton(o, list.includes(o.id), () => { q.toggle(o.id); api.render(); }, i, `opt-${q.id}-${o.id}`));
  if (q.unknown) buttons.push(optionButton(opt("unknown", q.unknown.label, q.unknown.icon), false, () => { q.unknownAction(); finish(q); }, options.length, `opt-${q.id}-unknown`, "gw-opt--quiet"));
  if (none) buttons.push(optionButton(opt("none", none.label, none.icon), false, none.action, options.length, `opt-${q.id}-none`, "gw-opt--quiet"));
  const ready = q.kind === "avoid" ? true : list.length > 0;
  return attach([
    optionGrid(q.ask().at(-1), buttons, "gw-opts--grid"),
    el("div", { class: "gw-attach__foot" }, [
      el("span", { class: "gw-attach__count", text: list.length ? `已选 ${list.length} 项` : q.kind === "avoid" ? "可多选，也可在下方写一句" : "可多选" }),
      el("button", {
        type: "button", class: "gw-send-btn", id: `${q.id}-done`, disabled: !ready, "data-field": `${q.id}-done`,
        onclick: () => { if (q.kind === "avoid") { commitAvoid(q); return; } q.commitAction?.(); finish(q); },
      }, [confirmLabel, icon("arrow-right", { size: 15 })]),
    ]),
  ]);
}
function budgetAttach(q) {
  const f = form();
  const other = f.budget_mode === "other";
  const chips = optionGrid("其他预算方式", [
    optionButton(opt("zero", "不花钱的心意", "heart"), false, () => { const f = form(); f.budget_mode = "zero"; f.budget_min = "0"; f.budget_max = "0"; clearParsedBudget(); attempt(q, "不花钱的心意"); }, 0, "budget-zero"),
    other
      ? optionButton(opt("slider", "用滑条选", "arrow-left"), false, () => { const f = form(); f.budget_mode = "slider"; f.budget_min = "100"; f.budget_max = "300"; api.render(); }, 1, "budget-slider-mode")
      : optionButton(opt("other", "其他金额", "coins"), false, () => { form().budget_mode = "other"; api.render(); }, 1, "budget-other-mode"),
    optionButton(opt("uncertain", "还没想好", "question"), false, () => note("没关系，先定一个大概的范围就好，之后随时可以改。", "还没想好"), 2, "budget-uncertain"),
  ], "gw-opts--budget");
  if (other) {
    const field = which => el("label", { class: "gw-money" }, [
      el("span", { class: "gw-money__label", text: which === "min" ? "最低" : "最高" }),
      el("span", { class: "gw-money__box" }, [
        el("span", { class: "gw-money__unit", "aria-hidden": "true", text: "¥" }),
        el("input", {
          type: "text", inputmode: "decimal", id: `budget-other-${which}`, value: f[`budget_${which}`],
          "aria-label": which === "min" ? "其他金额下限" : "其他金额上限", "data-field": `budget_other_${which}`,
          oninput: e => { form()[`budget_${which}`] = e.target.value.trim(); },
          onkeydown: e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); attempt(q, budgetText()); } },
        }),
      ]),
    ]);
    return attach([
      el("div", { class: "gw-budget budget-sliders" }, [
        el("div", { class: "gw-money-row" }, [field("min"), el("span", { class: "gw-money__dash", "aria-hidden": "true", text: "—" }), field("max")]),
        el("div", { class: "gw-attach__foot" }, [
          el("span", { class: "gw-attach__count", text: "0–10000 元，最多两位小数" }),
          el("button", { type: "button", class: "gw-send-btn", id: "budget-done", "data-field": "budget-done", onclick: () => { clearParsedBudget(); attempt(q, budgetText()); } }, ["用这个金额", icon("arrow-right", { size: 15 })]),
        ]),
      ]),
      chips,
    ], "gw-attach--budget");
  }
  const values = sliderValues();
  const readout = el("p", { class: "gw-budget__readout", id: "budget-readout", role: "status", "aria-live": "polite" }, [
    el("span", { "data-budget-value": "min", text: `¥${values.min}` }),
    el("span", { class: "gw-budget__dash", "aria-hidden": "true", text: "—" }),
    el("span", { "data-budget-value": "max", text: `¥${values.max}` }),
  ]);
  const range = el("div", { class: "gw-range", style: `--minf:${Number(values.min) / 1000};--maxf:${Number(values.max) / 1000}` }, [
    el("div", { class: "gw-range__track", "aria-hidden": "true" }),
    el("div", { class: "gw-range__fill", "aria-hidden": "true" }),
    ...["min", "max"].map(which => el("input", {
      type: "range", id: `budget-${which}`, min: "0", max: "1000", step: "50", value: values[which],
      "aria-label": which === "min" ? "礼物预算下限" : "礼物预算上限", "data-field": `budget-${which}`,
      oninput: e => slide(which, e, range, readout),
    })),
  ]);
  return attach([
    el("div", { class: "gw-budget budget-sliders" }, [
      readout,
      range,
      el("div", { class: "gw-range__scale", "aria-hidden": "true" }, [el("span", { text: "0" }), el("span", { text: "500" }), el("span", { text: "1000 元" })]),
      el("div", { class: "gw-attach__foot gw-attach__foot--end" }, [
        el("button", {
          type: "button", class: "gw-send-btn", id: "budget-done", "data-field": "budget-done",
          onclick: () => {
            const f = form();
            f.budget_mode = "slider";
            f.budget_min = range.querySelector("#budget-min").value;
            f.budget_max = range.querySelector("#budget-max").value;
            clearParsedBudget();
            attempt(q, budgetText());
          },
        }, ["就这个范围", icon("arrow-right", { size: 15 })]),
      ]),
    ]),
    chips,
  ], "gw-attach--budget");
}
function slide(which, event, range, readout) {
  const f = form();
  const minInput = range.querySelector("#budget-min"), maxInput = range.querySelector("#budget-max");
  let min = Number(minInput.value), max = Number(maxInput.value);
  if (which === "min" && min > max) min = max;
  if (which === "max" && max < min) max = min;
  minInput.value = String(min); maxInput.value = String(max);
  f.budget_mode = "slider"; f.budget_min = String(min); f.budget_max = String(max);
  clearParsedBudget();
  range.style.setProperty("--minf", String(min / 1000));
  range.style.setProperty("--maxf", String(max / 1000));
  range.classList.toggle("is-min-top", min >= 900);
  readout.querySelector('[data-budget-value="min"]').textContent = `¥${min}`;
  readout.querySelector('[data-budget-value="max"]').textContent = `¥${max}`;
  refreshSheet();
}
function textAttach(q) {
  if (!q.skip) return null;
  return attach([optionGrid(q.ask().at(-1), [
    optionButton(opt("skip", q.skip, "skip"), false, () => { q.set(""); finish(q); }, 0, `opt-${q.id}-skip`, "gw-opt--quiet"),
  ]), el("p", { class: "gw-attach__hint" }, [icon("arrow-down", { size: 14 }), "或在下方输入框里写一句"])], "gw-attach--slim");
}
function avoidAttach(q) {
  return multiAttach(q, {
    confirmLabel: "就这些",
    none: { label: "没有要避开的", icon: "smile", action: () => { const f = form(); f.exclusion_tags = []; f.dislikes = ""; chat().draft = ""; finish(q); } },
  });
}
function confirmAttach(q) {
  const c = chat();
  const a = st().analysis;
  if (c.analysisError) return attach([optionGrid("识别失败", [
    optionButton(opt("retry", "再试一次", "refresh"), false, () => runAnalysis(), 0, "analysis-retry"),
    optionButton(opt("edit", "改一下原话", "edit"), false, () => reopen("avoid"), 1, "analysis-edit", "gw-opt--quiet"),
  ])]);
  if (a.status !== "needs_confirmation") return attach([optionGrid("需要澄清", [
    optionButton(opt("edit", "改一下原话", "edit"), false, () => reopen("avoid"), 0, "analysis-edit"),
    optionButton(opt("retry", "重新识别", "refresh"), false, () => { api.invalidateAnalysis(); runAnalysis(); }, 1, "analyze-again", "gw-opt--quiet"),
  ])]);
  const confirmed = st().confirmedIds;
  const all = a.candidates.length > 0 && a.candidates.every(item => confirmed.includes(item.id));
  return attach([
    el("div", { class: "gw-understand-list" }, a.candidates.map(item => {
      const ok = confirmed.includes(item.id);
      const toggle = optionButton(opt("ok", ok ? "已确认" : "对，避开它", ok ? "check" : "ban"), ok, () => {
        st().confirmedIds = ok ? confirmed.filter(id => id !== item.id) : [...confirmed, item.id];
        api.render();
      }, 0, `exclusion-confirm-${item.id}`);
      toggle.id = `exclusion-confirm-${item.id}`;
      return el("div", { class: `gw-understand${ok ? " is-ok" : ""}` }, [
        el("p", { class: "gw-understand__quote", text: `「${item.source_span}」` }),
        el("p", { class: "gw-understand__meaning" }, [icon("arrow-right", { size: 14 }), el("span", { text: `理解为：避开${understanding(item)}` })]),
        item.why ? el("p", { class: "gw-understand__why", text: item.why }) : null,
        toggle,
      ]);
    })),
    el("div", { class: "gw-attach__foot" }, [
      el("button", { type: "button", class: "gw-text-btn", "data-field": "analysis-edit", onclick: () => reopen("avoid") }, [icon("edit", { size: 14 }), "不对，我改一下"]),
      el("button", { type: "button", class: "gw-send-btn", id: "exclusion-continue", disabled: !all, "data-field": "exclusion-continue", onclick: () => finish(q) }, ["都对，继续", icon("arrow-right", { size: 15 })]),
    ]),
  ]);
}
/** 当前心意清单的取值（侧栏与小结卡共用）。 */
function sheetValue(item) {
  const f = form();
  const L = labels();
  const done = chat().done;
  if (!item.covers.some(id => done.includes(id)) || !done.includes(item.qid)) return null;
  switch (item.qid) {
    case "relation": {
      const relation = f.recipient_relation === "other" ? f.recipient_relation_other.trim() || "其他" : zh(L.relations, f.recipient_relation);
      return [relation, f.closeness ? closenessLabel(f.closeness) : ""].filter(Boolean).join(" · ");
    }
    case "occasion": return f.occasion === "other" ? f.occasion_other.trim() || "其他" : zh(L.occasions, f.occasion);
    case "interests": {
      const q = byId("interests");
      const guessed = !f.interests_unknown && f.interests.length && !f.interests.every(id => f.interest_confidence[id] === "confirmed");
      return `${q.answer()}${guessed && done.includes("confidence") ? "（有些是猜的）" : ""}`;
    }
    default: return byId(item.qid).answer();
  }
}
/* --------------------------------- 解析结果在结算卡上的呈现（4 条裁定） */

/** 相对时间的必答确认：模型算出来的天数与原话不符时，把这题的差额摆出来让用户点。 */
function deadlineAlertNode() {
  const a = chat().deadlineAlert;
  if (!a) return null;
  const said = a.phrase ? `你说的是「${a.phrase}」` : "你的原话是相对时间";
  const model = a.current === null ? "" : `，模型算成 ${a.current} 天`;
  const expected = a.expected === null ? "" : `，按原话大约是 ${a.expected} 天`;
  return el("section", { class: "gw-parse-block gw-parse-block--required", "aria-label": "必答：期限确认" }, [
    el("h4", { class: "gw-parse-block__title", text: "期限要你亲自确认" }),
    el("p", { class: "gw-parse-block__ask", text: `${said}${model}${expected}。请点一个你这次要用的准备时间。` }),
    a.reason ? el("p", { class: "gw-parse-block__why", text: a.reason }) : null,
  ]);
}

function cityCard(item) {
  const f = form();
  const input = el("input", {
    type: "text", id: "parse-city", class: "gw-parse-block__input", value: f.city_answer || "",
    placeholder: "例如：杭州", "aria-label": "体验使用的城市", "data-field": "parse-city",
    oninput: e => { form().city_answer = e.target.value; },
    onkeydown: e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); confirmCity(); } },
  });
  return el("section", { class: "gw-parse-block gw-parse-block--required", "aria-label": "必答：城市" }, [
    el("h4", { class: "gw-parse-block__title", text: "还差一个必答问题" }),
    el("p", { class: "gw-parse-block__ask", text: item.question || "这个体验打算在哪个城市使用？" }),
    el("div", { class: "gw-parse-block__row" }, [
      input,
      el("button", { type: "button", class: "gw-send-btn", id: "parse-city-ok", "data-field": "parse-city-ok", onclick: () => confirmCity() }, ["确认城市", icon("arrow-right", { size: 15 })]),
    ]),
    item.reason ? el("p", { class: "gw-parse-block__why", text: item.reason }) : null,
  ]);
}
function confirmCity() {
  const f = form();
  f.city_answer = String(f.city_answer || "").trim();
  api.render();
}

/** 结算卡上的解析区块：原话可见、覆盖提示、原值回显、必答追问 —— 全部来自响应，不造数据。 */
function summaryExtras() {
  const c = chat();
  const report = c.parseReport;
  const nodes = [];
  if (!report) return nodes;
  const parse = report.parse || null;
  const long = e => [...e].length > 1000 ? [...e].slice(0, 999).join("") + "…" : e;

  // 原文可见：用户说过的那句话始终原样可见。
  if (report.text) nodes.push(el("p", { class: "gw-parse-block__quote", text: `你刚才说的：「${long(report.text)}」` }));

  // 原值回显：金额/天数显示用户输入的原值，⛔ 界面不显示 ±50 / ±1 的区间。
  const amount = echoBudgetAmount(parse);
  const days = echoDeadlineDays(parse);
  if (amount !== null && form().budget_amount) {
    nodes.push(el("p", { class: "gw-summary__note gw-summary__note--strong", text: `预算按你输入的原值：${amount} 元（不显示区间）` }));
  }
  if (days !== null && String(form().deadline_days) === String(days)) {
    nodes.push(el("p", { class: "gw-summary__note gw-summary__note--strong", text: `准备时间按你输入的原值：${days} 天（不显示区间）` }));
  }

  // 覆盖提示：文本优先于选项，逐条如实列出。
  if (report.overrides.length) {
    nodes.push(el("section", { class: "gw-parse-block", "aria-label": "覆盖提示" }, [
      el("h4", { class: "gw-parse-block__title", text: "你填的选项已被你的原话覆盖" }),
      el("ul", { class: "gw-parse-block__list" }, report.overrides.map(r => el("li", { text: `${r.label}：${r.from} → ${r.to}` }))),
    ]));
  }

  // 喜好原文：逐字保留，不用预设类目替代。
  if (report.literals.length) {
    nodes.push(el("section", { class: "gw-parse-block", "aria-label": "喜好原文" }, [
      el("h4", { class: "gw-parse-block__title", text: "你的喜好原话（原样保留）" }),
      el("ul", { class: "gw-parse-block__list" }, report.literals.map(t => el("li", { text: `「${long(t)}」` }))),
    ]));
  }

  // 必答追问（未答完的排在最前）：「体验类」缺城市 ⇒ 在结算卡上直接问。
  // 相对时间（deadline_confirm）不在这里问：它由 deadlineAlertNode 把那道题退回去让用户亲自点。
  const pending = new Map(parseFollowups().map(item => [item.id, item]));
  for (const item of pending.values()) {
    if (item.id === "city") nodes.push(cityCard(item));
  }

  // 解析的如实说明（降级/空/未采用项），不是报错态。
  for (const notice of report.notices) nodes.push(el("p", { class: "gw-summary__note", text: long(notice) }));
  for (const dropped of report.dropped) nodes.push(el("p", { class: "gw-summary__note", text: `未采用：${dropped}` }));
  return nodes;
}

function summaryAttach() {
  const f = form();
  const relation = sheetValue(SHEET[0])?.split(" · ")[0] || "TA";
  const occasion = sheetValue(SHEET[1]) || "";
  const blocked = parseFollowups().length > 0;
  return attach([
    el("article", { class: "greeting-card gw-summary", "aria-label": "需求小结" }, [
      el("p", { class: "greeting-card__eyebrow" }, [icon("ribbon", { size: 15 }), "心意清单"]),
      el("h3", { class: "greeting-card__title", text: `送给${relation}的${occasion}礼物` }),
      el("dl", { class: "gw-summary__list" }, SHEET.map(item => el("div", { class: "gw-summary__row" }, [
        el("dt", {}, [el("span", { class: "gw-summary__icon", "aria-hidden": "true" }, [icon(item.qid === "relation" ? OPTION_ICONS[f.recipient_relation] || "user" : item.icon, { size: 14 })]), item.term]),
        el("dd", { text: sheetValue(item) || "—" }),
      ]))),
      el("p", { class: "greeting-card__sign", text: "—— 为 TA 准备的心意" }),
      ...summaryExtras(),
      el("button", {
        type: "button", class: "gw-cta", id: "step-next", "data-field": "step-next", disabled: blocked,
        onclick: () => api.submit(),
      }, [
        icon("sparkles", { size: 18 }), blocked ? "先回答上面的必答问题" : "生成三个礼物思路",
      ]),
    ]),
  ], "gw-attach--summary");
}
function currentAttach(q) {
  switch (q.kind) {
    case "single": return singleAttach(q);
    case "multi": return multiAttach(q);
    case "budget": return budgetAttach(q);
    case "text": return textAttach(q);
    case "avoid": return avoidAttach(q);
    case "confirm": return confirmAttach(q);
    case "summary": return summaryAttach();
    default: return null;
  }
}

/* ------------------------------------------------------- 已答的只读附件 */

/** 多选类题目答完后，附件卡收起为只读的已选小标签；单选与文字题由“我”的气泡表达即可。 */
function answeredAttach(q) {
  const f = form();
  let items = [];
  if (q.kind === "multi") items = q.options().filter(o => q.list().includes(o.id));
  else if (q.kind === "avoid") items = q.options().filter(o => f.exclusion_tags.includes(o.id));
  else if (q.kind === "confirm") items = (st().analysis?.candidates || []).map(c => opt("ok", `避开${understanding(c)}`, "check"));
  if (!items.length) return null;
  return el("div", { class: "gw-attach gw-attach--done", "aria-hidden": "true" }, [
    el("div", { class: "gw-chips" }, items.map(o => el("span", { class: "gw-chip" }, [icon(o.icon, { size: 14 }), el("span", { text: o.label })]))),
  ]);
}
/** “我”的回答：有已选标签时用一句简短的话，避免与标签重复。 */
function meText(q) {
  const f = form();
  if (q.kind === "multi" && q.list().length) return `选好了，${q.list().length} 项`;
  if (q.kind === "avoid" && f.exclusion_tags.length) return f.dislikes.trim() ? `就这些，还有「${f.dislikes.trim()}」` : "就这些";
  if (q.kind === "confirm") return "都对";
  return q.answer();
}

/* ------------------------------------------------------------- 消息流 */

function introGroup() {
  return el("li", { class: "gw-turn gw-turn--intro" }, [botGroup(["嗨，我是小礼。问你几个小问题，点选项就能答。"])]);
}
function pastTurn(q, enter) {
  const edit = el("button", { type: "button", class: "gw-edit", "aria-label": `修改这一项：${q.ask().at(-1)}`, "data-field": `edit-${q.id}`, onclick: () => reopen(q.id) }, [
    icon("edit", { size: 12 }), "改一下",
  ]);
  return el("li", { class: "gw-turn gw-turn--past" }, [botGroup(botTexts(q), answeredAttach(q)), meGroup(meText(q), edit, enter)]);
}
function currentTurn(q, typing, entering) {
  const c = chat();
  const turn = el("li", { class: `gw-turn gw-turn--current${typing ? " is-typing" : ""}${entering ? " is-entering" : ""}`, "data-question": q.id });
  if (c.parsing) {
    turn.append(botGroup([ackFor(q)].filter(Boolean)), el("div", { class: "gw-group gw-group--bot gw-typing gw-typing--live", "aria-hidden": "true" }, [
      botAvatar(), el("div", { class: "gw-group__col" }, [el("p", { class: "gw-bubble gw-bubble--bot gw-bubble--typing" }, [
        el("span", { class: "gw-dots" }, [el("i"), el("i"), el("i")]), el("span", { class: "gw-typing__text", text: "正在读你这句原话…" }),
      ])]),
    ]));
    return turn;
  }
  if (q.kind === "confirm" && (c.analyzing || (!st().analysis && !c.analysisError))) {
    if (!st().analysis && !c.analyzing) setTimeout(runAnalysis, 0);
    turn.append(botGroup([ackFor(q)].filter(Boolean)), el("div", { class: "gw-group gw-group--bot gw-typing gw-typing--live", "aria-hidden": "true" }, [
      botAvatar(), el("div", { class: "gw-group__col" }, [el("p", { class: "gw-bubble gw-bubble--bot gw-bubble--typing" }, [
        el("span", { class: "gw-dots" }, [el("i"), el("i"), el("i")]), el("span", { class: "gw-typing__text", text: "正在理解你写的话…" }),
      ])]),
    ]));
    return turn;
  }
  let texts = botTexts(q);
  if (q.kind === "confirm") {
    const a = st().analysis;
    texts = c.analysisError ? [c.analysisError]
      : a.status !== "needs_confirmation" ? ["这句话我还没完全理解。", ...(a.errors || []).map(e => e.message).filter(Boolean).slice(0, 2)]
      : [ackFor(q), "关于要避开的，我是这样理解的，帮我逐条确认一下："].filter(Boolean);
  }
  if (q.kind === "summary") texts = [ackFor(q), "我把你说的整理成了一张心意清单，看看对不对："].filter(Boolean);
  turn.append(typingGroup(), botGroup(texts, currentAttach(q)));
  // notes 里的 bot 项可以是多行（解析回执），逐条渲染成紧贴的气泡。
  for (const n of c.notes) {
    turn.append(n.role === "me" ? meGroup(n.text) : botGroup([].concat(n.texts || n.text).filter(Boolean), null, "gw-group--note"));
  }
  return turn;
}

/* ------------------------------------------------------- 头部 / 清单 / 输入 */

function panelHead() {
  const c = chat();
  // 进度与右侧心意清单共用同一口径（固定 9 项），不随条件追问题增减。
  const filled = SHEET.filter(item => sheetValue(item)).length;
  const q = current();
  const at = SHEET.findIndex(item => item.covers.includes(q.id));
  const p = { done: q.kind === "summary", index: at >= 0 ? at + 1 : Math.min(filled + 1, SHEET.length), total: SHEET.length };
  return el("header", { class: "gw-chat-head" }, [
    botAvatar("lg"),
    el("div", { class: "gw-chat-head__id" }, [
      el("h1", { class: "gw-chat-head__name", text: BOT_NAME }),
      el("p", { class: "gw-chat-head__sub" }, [el("span", { class: "gw-chat-head__brand", text: "GiftWise 礼物助手 ·" }), el("span", { class: "gw-chat-head__status" }, [el("span", { class: "gw-online", "aria-hidden": "true" }), "在线"])]),
    ]),
    el("div", { class: "gw-chat-head__progress", role: "status", "aria-label": p.done ? "问题都答完了" : `第 ${p.index} 项，共 ${p.total} 项` }, [
      el("span", { class: "gw-chat-head__count", text: p.done ? "完成" : `${p.index} / ${p.total}` }),
      el("span", { class: "gw-chat-head__bar", "aria-hidden": "true" }, [el("span", { style: `--p:${Math.round((p.done ? 1 : filled / p.total) * 100)}%` })]),
    ]),
    el("button", {
      type: "button", class: "gw-sheet-pill", "aria-expanded": String(Boolean(c.sheetOpen)), "aria-controls": "gw-sheet", "data-field": "sheet-pill",
      onclick: () => { c.sheetOpen = !c.sheetOpen; api.render(); },
    }, [icon("ribbon", { size: 15 }), `清单 ${filled}/${SHEET.length}`]),
    el("button", {
      type: "button", class: `gw-icon-btn${c.confirmRestart ? " is-armed" : ""}`, "data-field": "chat-restart",
      "aria-label": c.confirmRestart ? "再点一次清空并重新开始" : "重新开始", title: c.confirmRestart ? "再点一次清空重来" : "重新开始",
      onclick: () => {
        if (!c.confirmRestart) { c.confirmRestart = true; api.render(); setTimeout(() => { if (c.confirmRestart) { c.confirmRestart = false; api.render(); } }, 3200); return; }
        api.restart();
      },
    }, [icon("refresh", { size: 17 }), c.confirmRestart ? el("span", { class: "gw-icon-btn__tip", text: "再点一次清空" }) : null]),
  ]);
}
// 清单每次随对话整体重绘；记住上一次的取值，只让“刚变化的那一项”播放入场动画，
// 抽屉也只在刚打开的那一次播放弹出动画，避免每选一个选项整栏闪一下。
const sheetMemo = new Map();
let sheetWasOpen = false;
function sheet(q) {
  const c = chat();
  const opening = Boolean(c.sheetOpen) && !sheetWasOpen;
  sheetWasOpen = Boolean(c.sheetOpen);
  const active = SHEET.find(item => item.covers.includes(q.id))?.qid;
  const ready = q.kind === "summary";
  const filled = SHEET.filter(item => sheetValue(item)).length;
  return el("aside", { class: `gw-sheet${c.sheetOpen ? " is-open" : ""}${opening ? " is-opening" : ""}`, id: "gw-sheet", "aria-label": "心意清单" }, [
    el("button", { type: "button", class: "gw-sheet__scrim", "aria-label": "关闭清单", tabindex: "-1", onclick: () => { c.sheetOpen = false; api.render(); } }),
    el("div", { class: "gw-sheet__card" }, [
      el("div", { class: "gw-sheet__head" }, [
        el("p", { class: "gw-sheet__eyebrow" }, [icon("ribbon", { size: 15 }), "心意清单"]),
        el("span", { class: "gw-sheet__count", text: `${filled} / ${SHEET.length}` }),
        el("button", { type: "button", class: "gw-icon-btn gw-sheet__close", "aria-label": "关闭清单", onclick: () => { c.sheetOpen = false; api.render(); } }, [icon("x", { size: 16 })]),
      ]),
      el("p", { class: "gw-sheet__title", text: "边聊边记下来" }),
      el("ul", { class: "gw-sheet__list" }, SHEET.map(item => {
        const value = sheetValue(item);
        const fresh = Boolean(value) && sheetMemo.has(item.qid) && sheetMemo.get(item.qid) !== value;
        sheetMemo.set(item.qid, value || "");
        const isActive = item.qid === active && !ready;
        return el("li", {}, [el("button", {
          type: "button", class: `gw-sheet__row${value ? " is-filled" : ""}${fresh ? " is-fresh" : ""}${isActive ? " is-active" : ""}`, disabled: !value,
          "aria-label": value ? `${item.term}：${value}，点击修改` : `${item.term}：待聊`, "data-field": `sheet-${item.qid}`,
          onclick: () => { c.sheetOpen = false; reopen(item.qid); },
        }, [
          el("span", { class: "gw-sheet__icon", "aria-hidden": "true" }, [icon(item.icon, { size: 15 })]),
          el("span", { class: "gw-sheet__term", text: item.term }),
          el("span", { class: "gw-sheet__value", text: value || (isActive ? "正在聊…" : "待聊") }),
          value ? el("span", { class: "gw-sheet__edit", "aria-hidden": "true" }, [icon("edit", { size: 13 })]) : null,
        ])]);
      })),
      el("p", { class: "gw-sheet__sign", text: "—— 为 TA 准备的心意" }),
      ready ? el("button", { type: "button", class: "gw-cta", "data-field": "sheet-submit", onclick: () => api.submit() }, [icon("sparkles", { size: 18 }), "生成三个礼物思路"]) : null,
    ]),
  ]);
}
/** 只更新清单里的预算值（拖动滑条时不整页重绘）。 */
function refreshSheet() {
  const node = document.querySelector('[data-field="sheet-budget"] .gw-sheet__value');
  if (node && chat().done.includes("budget")) node.textContent = budgetText();
}
function composer(q) {
  const c = chat();
  const spec = q.kind === "text" || q.kind === "avoid" ? q : null;
  const input = el("textarea", {
    id: q.kind === "avoid" ? "dislikes" : "chat-input", class: "gw-composer__input", rows: "1",
    placeholder: spec?.placeholder || PLACEHOLDERS[q.id] || "直接打字回答也可以",
    "aria-label": spec?.aria || "回答当前问题", "data-field": spec?.field || "chat-input", enterkeyhint: "send",
    oninput: e => { c.draft = e.target.value; grow(e.target); },
    onkeydown: e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } },
  });
  input.value = c.draft;
  requestAnimationFrame(() => grow(input));
  const quick = QUICK[q.id];
  return el("div", { class: "gw-chat-input" }, [
    quick ? el("div", { class: "gw-quick", role: "group", "aria-label": "快捷回复" }, quick.map(text => el("button", {
      type: "button", class: "gw-quick__btn", "data-field": `quick-${q.id}`,
      onclick: () => { c.draft = text; const box = document.querySelector(".gw-composer__input"); if (box) { box.value = text; grow(box); box.focus(); } },
    }, [text]))) : null,
    el("form", { class: "gw-composer", onsubmit: e => { e.preventDefault(); send(); } }, [
      input,
      el("button", { type: "submit", class: "gw-composer__send", "aria-label": "发送" }, [icon("send", { size: 18 })]),
    ]),
  ]);
}
function grow(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  input.classList.toggle("is-overflowing", input.scrollHeight > 120);
}

/* ------------------------------------------------------------- 滚动 */

const scroller = () => document.querySelector(".gw-chat-scroll");
/** 把当前一题带到可视区：整题放得下就贴底，放不下就让题目开头可见。 */
function reveal(turn, smooth = true) {
  const box = scroller();
  if (!box || !turn?.isConnected) return;
  const bottom = box.scrollHeight - box.clientHeight;
  // 锚点是当前提问气泡（打字中则是三点气泡）：整题放得下就贴底；放不下时保证提问与其下方的选项完整可见。
  const anchor = [...turn.querySelectorAll(".gw-group--bot:not(.gw-typing) .gw-bubble:last-of-type, .gw-typing")].find(n => n.getClientRects().length) || turn;
  const boxTop = box.getBoundingClientRect().top - box.scrollTop;
  const anchorTop = anchor.getBoundingClientRect().top - boxTop - 12;
  // 整题（提问 + 选项卡片）放得下时，让卡片底部完整露出；放不下时保证提问开头可见。
  const end = [...turn.querySelectorAll(".gw-attach, .gw-bubble, .gw-typing")].reduce((m, n) => Math.max(m, n.getBoundingClientRect().bottom - boxTop), 0) + 16;
  const want = end - anchorTop <= box.clientHeight ? end - box.clientHeight : anchorTop;
  const top = Math.max(0, Math.min(bottom, Math.max(want, 0)));
  const animate = smooth && !reducedMotion();
  // 平滑滚动途中若因点击重绘，用记下的目标位置续上，避免停在半路。
  chat().scrollGoal = animate ? { top, until: Date.now() + 800 } : null;
  box.scrollTo({ top, behavior: animate ? "smooth" : "auto" });
}
function revealCurrent() {
  setTimeout(() => reveal(document.querySelector(".gw-turn--current")), 40);
}
let usingKeyboard = false;
globalThis.addEventListener?.("keydown", e => {
  if (e.key === "Tab" || e.key.startsWith("Arrow")) usingKeyboard = true;
  if (e.key === "Escape" && api?.state.chat?.sheetOpen) { api.state.chat.sheetOpen = false; api.render(); }
}, true);
globalThis.addEventListener?.("pointerdown", () => { usingKeyboard = false; }, true);

/** 渲染聊天面板（消息区在面板内部滚动，重绘时保留滚动位置）。 */
export function renderChat() {
  const c = chat();
  const q = current();
  const entering = c.shownKey !== q.id;
  const typing = entering && !reducedMotion();
  const keep = scroller()?.scrollTop ?? null;
  if (entering) {
    c.shownKey = q.id;
    c.entryKey = intakeKey();
    c.entryInterests = JSON.stringify(form().interests);
    c.draft = q.kind === "avoid" ? form().dislikes : q.kind === "text" ? q.get() : "";
  }
  const log = el("ol", { class: "gw-log", role: "log", "aria-live": "polite", "aria-label": "和小礼的对话" }, [introGroup()]);
  for (const item of applicable()) {
    if (item === q) break;
    log.append(pastTurn(item, c.enterMe === item.id));
  }
  c.enterMe = null;
  const turn = currentTurn(q, typing, entering);
  log.append(turn);
  const scroll = el("div", { class: "gw-chat-scroll", tabindex: "-1" }, [log]);
  const shell = el("div", { class: "gw-chat-shell" }, [
    el("section", { class: "gw-chat-panel", "aria-label": "选礼对话" }, [panelHead(), scroll, composer(q)]),
    sheet(q),
  ]);
  // render() 同步替换节点后再恢复滚动，避免每次重绘跳回顶部。
  queueMicrotask(() => {
    if (!scroll.isConnected) return;
    const goal = c.scrollGoal && Date.now() < c.scrollGoal.until ? c.scrollGoal.top : null;
    if (entering) scroll.scrollTop = keep ?? 0;
    else if (goal !== null) scroll.scrollTop = goal;
    else if (keep !== null) scroll.scrollTop = keep;
    if (entering) reveal(turn, keep !== null);
  });
  if (entering) {
    setTimeout(() => {
      if (!turn.isConnected) return;
      turn.classList.remove("is-typing");
      reveal(turn);
      // 只给键盘用户自动移焦，避免鼠标/触屏用户把焦点环误认为“已选中”。
      if (!usingKeyboard) return;
      const target = q.kind === "text" || q.kind === "avoid" ? document.querySelector(".gw-composer__input") : turn.querySelector(".gw-opt:not(:disabled), .gw-send-btn:not(:disabled), .gw-cta");
      target?.focus({ preventScroll: true });
    }, typing ? TYPING_MS : 0);
  }
  return { body: [shell], actions: [] };
}
