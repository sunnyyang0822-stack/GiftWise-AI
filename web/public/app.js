/**
 * GiftWise AI · web 最小前端（WEB-WF-001 / WEB-001）
 *
 * 设计边界：
 *   - 只提交 intake 契约字段；facts / available_days / passed / repair_count 等派生值
 *     一律不提交（提交也会被服务端 INTAKE_UNKNOWN_FIELD 拒绝）；
 *   - selected_candidate_id 只来自用户点击，且在推荐阶段由服务端固定返回 null；
 *   - 全局最多一次自动业务修订由服务端持有，前端只显示，不能提交；
 *   - 所有文案为简体中文。
 */

import { PREVIEW_MODE, previewRequest, previewScenarios, setPreviewScenario } from "./js/preview-api.js";
import { createResultViews } from "./js/results-view.js";
import { setupChat, ensureChat, newChatState, renderChat, chatProblems, chatProgress, reopen, codePoints } from "./js/chat.js";
import { parseTimeoutMs, composeAdditionalContext, parseEnabled } from "./js/parse-intake.js";
import { friendlyMessages } from "./js/friendly.js";
import { exclusionConfirmation } from "./js/exclusion-flow.js";

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

const $ = (id) => document.getElementById(id);

function initialForm() {
  return {
    recipient_relation: null,
    recipient_relation_other: "",
    closeness: null,
    occasion: null,
    occasion_other: "",
    budget_mode: "slider",
    budget_min: "100",
    budget_max: "300",
    deadline_days: "",
    interests: [],
    interest_confidence: {},
    interests_unknown: false,
    gift_styles: [],
    styles_unknown: false,
    exclusion_tags: [],
    dislikes: "",
    previous_gifts: "",
    additional_context: "",
    /* 以下键是**前端内部记账**，不是 intake 契约字段（契约字段一个都没新增）：
       · budget_amount / budget_phrase —— 第 1 步解析回显的「用户输入原值」与原话片段；
       · exclusion_terms —— 解析按字面给出的禁忌词，映射到已有的 hard_exclusions.terms；
       · city_answer —— 体验类「必答追问」的城市答案，映射进已有的 additional_context；
       · parsed_context —— 解析时服务端拼的约束说明（如喜好原话），提交时并入已有的 additional_context，
         不出现在用户的「补充」输入框里。 */
    budget_amount: "",
    budget_phrase: "",
    exclusion_terms: [],
    city_answer: "",
    parsed_context: "",
  };
}

const state = {
  config: null,
  /** 配置没拿到时的中文失败态（含重试入口）；与业务错误 state.error 分开。 */
  configError: null,
  step: 1,
  inFlow: false,
  analysis: null,
  confirmedIds: [],
  requestVersion: 0,
  controller: null,
  busy: false,
  error: null,
  timeout: false,
  /** 四段呈现之后的收束屏（鼓励页）；与 presentation 分开，便于「再看一遍」来回切。 */
  encourage: false,
  report: null,
  presentation: null,
  demo: new URLSearchParams(location.search).get("demo") || "",
  restoreNotice: null,
  /** 记录在途动作，超时/错误后「重试」才不会把推荐与呈现搞混。 */
  pending: null,
  /** 对话式需求收集的进度（题目推进、草稿、识别状态），由 js/chat.js 维护。 */
  chat: null,
  /**
   * 第 1 步自然语言解析的最近一次结果（**只保留响应里的字段，不造任何数据**）：
   *   { status, reason_code, degraded, notices, parse, intake, elapsed_ms, text }
   * null 表示用户还没有写过自由文字、或本次录入没走到解析。
   */
  parseIntake: null,
  /** 解析用的那次用户原话（逐字保留，用于「你说的原话」回显与覆盖提示）。 */
  parseText: "",
  form: initialForm(),
};

const CONTRACT_VERSION = "giftwise-20261031-v2";

/* --------------------------------------------------------- 请求超时口径 */
/**
 * 前端请求超时上限（毫秒）。为什么是 120 秒：
 *   · 后端 /api/config 自报 client_timeout_ms = 20000，那是"服务端建议的客户端超时"；
 *     但真实 LLM 出三个方案预计 20–60 秒，而推荐阶段允许一次自动业务修订
 *     （首次生成 + 修订 = 最多两次模型调用），单次 20 秒会在正常路径上误报超时；
 *   · 120 秒 ≈ 2 × 60 秒最坏模型耗时 + 网络与规则校验余量；
 *   · 再往上就没有止损意义（用户只会看到更久的转圈），所以上限不取 180/300 秒。
 * 取 90 秒的备选被否掉：一次自动修订后 90 秒在长文案（?demo=stress）下过紧。
 * 注意：图片任务轮询是请求返回**之后**的另一条链路，用独立的 10 秒超时，
 *       不占用、也不拉长这里的 120 秒。
 */
const REQUEST_TIMEOUT_MS = 120000;
/** /api/config 是本地常量表，不该等 120 秒；15 秒足够，失败立刻给重试入口。 */
const CONFIG_TIMEOUT_MS = 15000;
// 对话题目的三个分组：用于顶部细进度条的无障碍说明。
const STEP_TITLES = ["关系场合预算时间", "兴趣风格", "需要避免的与补充"];

function invalidateAnalysis() {
  state.analysis = null;
  state.confirmedIds = [];
  if (state.chat) {
    state.chat.analysisToken++;
    state.chat.analyzing = false;
    state.chat.exclusionAnalysisKey = null;
    state.chat.exclusionTurns = [];
    state.chat.pendingExclusionContinuation = null;
  }
}
function cancelPending() {
  state.requestVersion++;
  state.controller?.abort();
  state.busy = false;
}
function scrollToView() {
  // 聊天面板占满一屏，回到页首即可完整看到；结果页等其他视图仍滚到挂载点。
  if (inChat()) window.scrollTo(0, 0);
  else $("view").scrollIntoView({ block: "start" });
  $("view").focus({ preventScroll: true });
}
/** 进入（或回到）对话：已答内容全部保留，从下一道未答的题继续。 */
function startFlow() {
  cancelPending();
  ensureChat();
  state.inFlow = true;
  state.report = null;
  state.presentation = null;
  state.encourage = false;
  state.timeout = false;
  state.error = null;
  render();
  scrollToView();
}
function restartChat() {
  cancelPending();
  state.form = initialForm();
  state.chat = newChatState();
  state.parseIntake = null;
  state.parseText = "";
  invalidateAnalysis();
  state.error = null;
  render();
  scrollToView();
}

/* ------------------------------------------------------------------ 渲染 */

function renderBadges() {
  $("badges").replaceChildren();
  $("badges").hidden = true;
  const flag = $("mode-flag");
  flag.hidden = true;
  flag.textContent = "";
  $("hero-flag").hidden = true;
  $("hero-flag").textContent = "";
}
function renderBanners() {
  const slot = $("banner-slot");
  slot.replaceChildren();
  const notices = [state.restoreNotice, state.config?.fixture_notice].filter(Boolean);
  if (state.inFlow) notices.forEach(text => slot.append(el("p", { class: "banner banner--warn", text })));
  // 调试用：只有地址带 ?preview= 时才显示状态切换，正常访问不出现。
  const debug = PREVIEW_MODE && new URLSearchParams(location.search).has("preview");
  if (debug && state.inFlow) {
    slot.append(el("label", { class: "preview-scenario" }, [
      el("span", { text: "状态" }),
      el("select", { id: "preview-scenario", "aria-label": "状态", disabled: state.busy, onchange: e => {
        state.previewScenario = e.target.value;
        setPreviewScenario(e.target.value);
      } }, previewScenarios.map(([value, text]) => el("option", { value, selected: value === (state.previewScenario || new URLSearchParams(location.search).get("preview") || "normal"), text }))),
    ]));
  }
  slot.hidden = slot.childElementCount === 0;
}
function inChat() {
  return Boolean(state.config) && state.inFlow && !state.busy && !state.report && !state.presentation && !state.encourage && !state.timeout && !(state.error && state.error.kind === "error");
}
/** 对话进度已放进聊天面板头部（js/chat.js），这里的旧步骤条保持隐藏。 */
function renderSteps() {
  const nav = $("steps");
  nav.replaceChildren();
  nav.hidden = true;
  if (inChat()) nav.setAttribute("aria-label", `填写进度：${STEP_TITLES[chatProgress().group]}`);
}
function renderLandingVisibility() {
  for (const section of document.querySelectorAll("[data-landing]")) section.hidden = state.inFlow;
}

/** 面向用户的问题提示：大白话、不显示错误码与字段路径；纯内部条目不展示（见 js/friendly.js）。 */
function errorBox(errors, title = "需要处理的问题") {
  const lines = friendlyMessages(errors);
  if (lines.length === 0) return null;
  return el("div", { class: "error-box" }, [
    el("strong", { text: title }),
    el("ul", {}, lines.map(text => el("li", { text }))),
  ]);
}

/* ------------------------------------------------------------- 状态页 */

/** 超时与错误态的恢复入口：贴在中文明说旁边（在 #view 里），而不是只挂在底部固定动作条上。 */
function recoveryActions() {
  return el("div", { class: "state__actions" }, [
    el("button", { class: "btn btn--primary", type: "button", text: "重试上一次动作", onclick: () => selectLast() }),
    el("button", { class: "btn", type: "button", text: "回到表单", onclick: () => resetToForm() }),
  ]);
}

function stateView(title, paragraphs, actions = [], extraNodes = []) {
  return {
    body: [
      el("section", { class: "state" }, [
        el("h2", { class: "state__title", text: title }),
        ...paragraphs.map((p) => el("p", { text: p })),
        ...extraNodes,
      ]),
    ],
    actions,
  };
}

/** 配置没拿到时的中文失败态：说清"连不上接入层"，并给一个明确的重试入口。 */
function renderConfigError() {
  const retry = el("div", { class: "state__actions" }, [
    el("button", { class: "btn btn--primary", type: "button", text: "重新加载配置", onclick: () => { loadConfig(); } }),
  ]);
  return {
    body: [
      el("section", { class: "state" }, [
        el("h2", { class: "state__title", text: "连不上接入层服务" }),
        el("p", { text: "页面需要先读到服务端的配置（关系、场合、预算与时间区间）才能开始。现在没有读到，所以没有渲染任何表单，也没有用本地假配置顶上。" }),
        el("p", { text: "请确认服务已启动（默认 127.0.0.1:8787），然后点下面的按钮重试。" }),
        ...(state.configError?.errors?.length ? [errorBox(state.configError.errors, "错误详情")] : []),
        retry,
      ]),
    ],
    actions: [],
  };
}

/** 配置未就位时的中文等待态：表单字段全部来自接入层配置，缺配置就先去读配置。 */
function renderWaiting() {
  return {
    body: [
      // 只显示加载动画，不写说明文字（产品负责人 2026-11-01）；读屏用户仍能听到状态。
      el("section", { class: "state state--loading", role: "status", "aria-live": "polite" }, [
        el("span", { class: "spinner", "aria-hidden": "true" }),
        el("span", { class: "sr-only", text: "加载中" }),
      ]),
    ],
    actions: [],
  };
}

function renderGenerating() {  return {
    body: [
      // 只显示加载动画，不写说明文字（产品负责人 2026-11-01）；读屏用户仍能听到状态。
      el("section", { class: "state state--loading", role: "status", "aria-live": "polite" }, [
        el("span", { class: "spinner", "aria-hidden": "true" }),
        el("span", { class: "sr-only", text: "加载中" }),
      ]),
    ],
    actions: [],
  };
}

/* --------------------------------------------------------- 三方案对比页 */

// 结果页三屏（三个思路 / 选定后的呈现 / 收束页）由 js/results-view.js 渲染；
// 账单只统计所选礼物本身（recheck_summary.gift_estimated_total），备选不相加。
let resultViews = null;
function views() {
  resultViews ||= createResultViews({ el, state, selectCandidate, resetToForm, backToEncourage, backToHome, errorBox, stateView, render, apiFetch });
  return resultViews;
}
const renderRecommendation = () => views().renderRecommendation();
const renderPresentation = () => views().renderPresentation();
const renderEncourage = () => views().renderEncourage();

function backToFormActions(label) {
  return [
    el("button", {
      class: "btn btn--primary",
      type: "button",
      text: label,
      onclick: () => resetToForm(),
    }),
  ];
}

/* ------------------------------------------------- 鼓励页（流程收束屏） */

/** 四段呈现看完之后的收束屏：先说一句人话，再给「回到主页」。 */
function backToEncourage() {
  state.encourage = true;
  render();
  const view = $("view");
  if (view) {
    view.scrollIntoView({ block: "start" });
    view.focus({ preventScroll: true });
  }
}

/** 回到主页：清掉本次任务状态，首屏六屏重新出现并回到页首。
 *  从收束屏到页首是几千像素的距离，这里不做平滑滚动（那样又慢又晕），直接回到顶部。 */
function backToHome() {
  state.encourage = false;
  resetToForm();
  state.inFlow = false;
  render();
  window.scrollTo(0, 0);
  const hero = $("hero");
  if (hero) {
    hero.setAttribute("tabindex", "-1");
    hero.focus({ preventScroll: true });
  }
}

/* --------------------------------------------------------------- 流程 */

/** 回到对话：已答内容全部保留，停在需求小结，可逐项“改一下”。 */
function resetToForm() {
  state.report = null;
  state.presentation = null;
  state.encourage = false;
  state.error = null;
  state.timeout = false;
  state.inFlow = true;
  ensureChat();
  render();
}

/** 金额的「分」表示；非法（非十进制字符串/超两位小数）返回 null。只用于自洽性比较。 */
function amountCents(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [yuan, frac = ""] = value.split(".");
  const cents = Number(yuan) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function buildIntake() {
  const f = state.form;
  const intake = {
    recipient_relation: f.recipient_relation,
    occasion: f.occasion,
    contract_version: CONTRACT_VERSION,
    budget_mode: f.budget_mode,
    budget_range: { min: f.budget_min, max: f.budget_max },
    currency: "CNY",
    ...(f.deadline_days !== "" && f.deadline_days != null ? { deadline_days: Number(f.deadline_days) } : {}),
    interests: f.interests_unknown ? [] : [...f.interests],
    interest_confidence: f.interests_unknown ? {} : { ...f.interest_confidence },
    gift_styles: f.styles_unknown ? [] : [...f.gift_styles],
    dislikes: f.dislikes.trim() ? f.dislikes : "",
    previous_gifts: f.previous_gifts || "",
    hard_exclusions: { tags: [...f.exclusion_tags], terms: [...(f.exclusion_terms || [])], unresolved: [] },
    additional_context: composeAdditionalContext({ base: f.additional_context, parsed: f.parsed_context, city: f.city_answer }),
  };
  /* budget_amount 只在「第 1 步解析给过用户原值」且「与契约区间上界数值一致」时下发。
     契约要求 budget_amount === budget_range.max（checker.mjs:BUDGET_RANGE_MISMATCH）；
     不自洽时**不下发**，维持既有行为（服务端按 budget_range.max 取值），绝不制造脏数据。 */
  const original = amountCents(f.budget_amount);
  if (original !== null && original === amountCents(f.budget_max)) intake.budget_amount = f.budget_amount;
  if (f.recipient_relation === "other") intake.recipient_relation_custom = f.recipient_relation_other.trim();
  if (f.occasion === "other") intake.occasion_custom = f.occasion_other.trim();
  if (f.closeness) intake.closeness = f.closeness;
  return intake;
}

async function analyzeDislikes(intake, continuation) {
  const response = await apiFetch("/api/exclusions/analyze", { intake, ...(continuation ? { continuation } : {}) });
  return response.data || { status: "error", errors: [{code:"BAD_RESPONSE",message:"识别暂未完成，请重试。"}] };
}

/**
 * 第 1 步：把用户的**自然语言原话**交给 `POST /api/intake/parse` 解析成**现有** intake 字段。
 *
 * 这是前端唯一调用解析端点的地方；调用方（js/chat.js）在用户每次发出自由文字时使用它。
 * 三态一律不卡用户（响应 HTTP 恒为 200，前端只看 `status`，不看 HTTP 码）：
 *   · ready            → 用返回的 intake 继续（落到现有表单字段上）；
 *   · empty            → ⛔ **不猜**：不写任何字段，交回既有表单路径继续；
 *   · degraded/disabled→ ⛔ **不报错**：用原表单继续（后端已实测这样仍能出 3 个候选）。
 * 真实传输失败（网络/超时）同样按 degraded 处理——失败不是"请求错误"，不该把用户挡住。
 *
 * @returns {Promise<null|{status:string, reason_code:string|null, degraded:boolean,
 *   notices:string[], parse:object|null, intake:object|null, text:string, transport_error?:string}>}
 *   null 表示本次没有解析结果可用（没有文本 / 服务端自报能力关闭）。
 */
async function parseIntakeText(utterance) {
  const said = String(utterance || "").trim();
  if (!said || !parseEnabled(state.config)) return null;
  const timeoutMs = parseTimeoutMs(state.config);
  let data = null;
  let transportError = null;
  try {
    const response = await apiFetch("/api/intake/parse", { text: said, form: buildIntake() }, { timeoutMs });
    data = response && response.ok === false ? null : response?.data;
    if (response && response.ok === false) transportError = "HTTP " + response.status;
  } catch (err) {
    transportError = err && err.code === "CLIENT_TIMEOUT" ? "CLIENT_TIMEOUT" : (err?.name === "AbortError" ? "ABORT_ERR" : "NETWORK_ERROR");
  }
  state.parseText = said;
  const normalized = !data || typeof data !== "object"
    ? {
        status: "degraded",
        reason_code: transportError || "BAD_RESPONSE",
        degraded: true,
        parse: null,
        intake: null,
        notices: ["这次的自然语言解析没有拿到可用结果，已按你原来的填写继续；没有用任何猜测值顶替。"],
      }
    : {
        status: typeof data.status === "string" ? data.status : "degraded",
        reason_code: typeof data.reason_code === "string" ? data.reason_code : null,
        degraded: data.degraded === true,
        parse: data.parse && typeof data.parse === "object" ? data.parse : null,
        intake: data.intake && typeof data.intake === "object" ? data.intake : null,
        intake_validation: data.intake_validation || null,
        notices: Array.isArray(data.notices) ? data.notices.filter((n) => typeof n === "string" && n.trim()) : [],
        llm: data.llm || null,
        elapsed_ms: Number.isFinite(data.elapsed_ms) ? data.elapsed_ms : null,
      };
  normalized.text = said;
  if (transportError && normalized.notices.length === 0) {
    normalized.notices.push("这次的自然语言解析没有拿到可用结果，已按你原来的填写继续；没有用任何猜测值顶替。");
  }
  state.parseIntake = normalized;
  return normalized;
}

/**
 * 统一请求入口：真实 HTTP + AbortController 超时。
 *
 * 改前：`if (PREVIEW_MODE) return previewRequest(...); throw new Error("同版本后端尚未接入…")`
 *       —— 前端从未真正发出过一次请求，也**没有任何超时**。
 * 改后：默认走真实 fetch（同源，带 gw_task_session Cookie）；每个请求都有硬超时，
 *       超时 abort 后抛 code:"CLIENT_TIMEOUT"（不是静默失败，也不是无限转圈）。
 *       PREVIEW_MODE 只在显式 ?preview=1 时为 true，此时仍走本地预览适配器。
 *
 * @param {string} path 以 /api/ 开头的同源路径
 * @param {object|null} payload 为 null 表示 GET；否则 POST JSON
 * @param {{method?:string, timeoutMs?:number, track?:boolean}} [options]
 *        track:false 表示这次请求不登记到 state.controller（读配置、轮询图片状态用），
 *        这样「用户取消」只会中止真正的业务请求，不会误伤这两类后台请求。
 * @returns {Promise<{ok:boolean,status:number,data:any}>} 与旧调用方一致的响应信封
 */
async function apiFetch(path, payload = null, options = {}) {
  if (PREVIEW_MODE) return previewRequest(path, payload);
  const method = options.method || (payload === null ? "GET" : "POST");
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  if (options.track !== false) state.controller = controller;
  // 定时器先置标志再 abort：用户主动取消（cancelPending）也会 abort，
  // 但那时标志仍是 false，必须区分开——取消不能显示成"超时"。
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: payload === null ? undefined : { "content-type": "application/json" },
      body: payload === null ? undefined : JSON.stringify(payload),
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      // 非 JSON 或空响应体：data 保持 null，由调用方按 BAD_RESPONSE 处理。
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    if (timedOut) {
      const timeoutError = new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已中止`);
      timeoutError.name = "TimeoutError";
      timeoutError.code = "CLIENT_TIMEOUT";
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (state.controller === controller) state.controller = null;
  }
}

/** 在对话里给出一句提示并回到对应题目（不再整页报错）。 */
function backToQuestion(qid, message) {
  state.busy = false;
  state.error = null;
  reopen(qid, message);
}

async function submitIntake() {
  if (state.busy) return;
  const version = state.requestVersion;
  const problems = chatProblems();
  if (problems.length) {
    backToQuestion(problems[0].qid, problems[0].message);
    return;
  }
  const intake = buildIntake();
  if (codePoints(intake.dislikes) > 1000 || codePoints(intake.previous_gifts) > 1000 || codePoints(intake.additional_context) > 1000) {
    backToQuestion("avoid", "需要避免的、以前送过的礼物和补充说明，每项最多 1000 字。");
    return;
  }
  // 语义限制采用服务端 ready 引用；具体禁品仍须确认，待澄清状态不能提交推荐。
  const confirmation = exclusionConfirmation(state.analysis, state.confirmedIds);
  if (intake.dislikes && !confirmation) {
    backToQuestion("avoid_confirm", "我们先把这条要求聊清楚。");
    return;
  }
  state.busy = true;
  state.pending = { kind: "recommend" };
  state.error = null;
  state.timeout = false;
  render();
  try {
    // 先做一次服务端确定性适配，把中文错误在提交前给用户
    const pre = intake.dislikes ? { ok: true, data: {status: "ready"} } : await apiFetch("/api/intake/validate", { intake });
    if (version !== state.requestVersion) return;
    if (pre.ok && pre.data && pre.data.status !== "ready") {
      backToQuestion("summary", (pre.data.errors || []).map(e => e.message).join(" ") || "还有信息需要补充。");
      return;
    }
    const payload = { intake, demo: state.demo || null };
    if (intake.dislikes) payload.exclusion_confirmation = confirmation;
    const response = await apiFetch("/api/recommendations", payload);
    if (version !== state.requestVersion) return;
    state.busy = false;
    if (!response.data) {
      state.error = { kind: "error", errors: [{ code: "BAD_RESPONSE", message: "服务端返回的内容无法解析，请重试。" }] };
      render();
      return;
    }
    if (!response.ok) {
      if (response.status === 422) {
        const stale = (response.data.errors || []).some(e => e.code === "EXCLUSION_ANALYSIS_STALE");
        if (stale) invalidateAnalysis();
        backToQuestion(stale ? "avoid_confirm" : "summary", (response.data.errors || []).map(e => e.message).join(" ") || "还有信息需要调整。");
        return;
      }
      state.error = { kind: "error", errors: response.data.errors || [] };
      render();
      return;
    }
    state.report = response.data;
    state.pending = null;
    render();
  } catch (err) {
    if (version !== state.requestVersion) return;
    state.busy = false;
    if (err && err.code === "CLIENT_TIMEOUT") {
      // 明确的中文超时态：不标记为通过、不生成任何方案，并给出「重试上一次动作」入口。
      state.timeout = true;
      state.error = { kind: "timeout", errors: [{ code: "CLIENT_TIMEOUT", message: `请求超过 ${Math.round((err.timeoutMs || REQUEST_TIMEOUT_MS) / 1000)} 秒没有返回，已中止这次请求：没有生成任何方案，也没有把任何内容标记为通过。你可以直接重试。` }] };
    } else if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      // 用户自己取消（或新一次请求取代了这一次）：不是错误，不渲染任何失败态。
      return;
    } else {
      state.error = { kind: "error", errors: [{ code: "NETWORK_ERROR", message: "无法连接接入层服务，请确认服务已启动。" }] };
    }
    render();
  }
}

async function selectCandidate(candidateId) {
  if (state.busy) return;
  const version = state.requestVersion;
  const result=state.report?.validation.candidate_results.find(x=>x.id===candidateId);
  if (!state.report?.selectable_candidate_ids.includes(candidateId) || result?.passed !== true) return;
  state.busy = true;
  state.pending = { kind: "present", candidateId };
  state.error = null;
  state.timeout = false;
  render();
  try {
    const response = await apiFetch("/api/presentations", {
      recommendation_run_id: state.report ? state.report.recommendation_run_id : null,
      selected_candidate_id: candidateId,
      demo: state.demo || null,
    });
    if (version !== state.requestVersion) return;
    state.busy = false;
    if (!response.data) {
      state.error = { kind: "error", errors: [{ code: "BAD_RESPONSE", message: "服务端返回的内容无法解析，请重试。" }] };
      render();
      return;
    }
    if (response.status === 409) {
      state.presentation = response.data;
      render();
      return;
    }
    if (!response.ok) {
      state.error = { kind: "error", errors: response.data.errors || [] };
      render();
      return;
    }
    state.presentation = response.data;
    render();
  } catch (err) {
    if (version !== state.requestVersion) return;
    state.busy = false;
    if (err && err.code === "CLIENT_TIMEOUT") {
      state.timeout = true;
      state.error = { kind: "timeout", errors: [{ code: "CLIENT_TIMEOUT", message: `请求超过 ${Math.round((err.timeoutMs || REQUEST_TIMEOUT_MS) / 1000)} 秒没有返回，已中止：没有生成呈现内容，也没有标记为完成。你可以直接重试。` }] };
    } else if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      return;
    } else {
      state.error = { kind: "error", errors: [{ code: "NETWORK_ERROR", message: "无法连接接入层服务。" }] };
    }
    render();
  }
}

/* ------------------------------------------------------------------ 组装 */

/**
 * 记录当前正在编辑的字段（用 data-field 标识，跨重绘稳定）。
 * 没有 data-field 的元素不记录：重绘后无法安全地认回同一个节点。
 */
function captureFocus() {
  const active = document.activeElement;
  if (!active || active === document.body || !active.dataset || !active.dataset.field) return null;
  let start = null;
  let end = null;
  try {
    start = active.selectionStart;
    end = active.selectionEnd;
  } catch {
    /* type=number 的输入框不支持选区 API */
  }
  return { field: active.dataset.field, start, end };
}

function restoreFocus(snapshot) {
  if (!snapshot) return;
  const node = document.querySelector(`[data-field="${snapshot.field}"]`);
  if (!node) return;
  if (node !== document.activeElement) node.focus({ preventScroll: true });
  if (snapshot.start === null || snapshot.start === undefined) return;
  try {
    node.setSelectionRange(snapshot.start, snapshot.end);
  } catch {
    /* 同上：number 输入框忽略 */
  }
}

/** 当前视图标识：只在切换时重放一次入场动效，同一视图内的重绘（打字）不重放。 */
function currentViewKey() {
  if (!state.config) return state.configError ? "error" : "waiting";
  if (state.busy && state.pending?.kind === "recommend") return "recommendation";
  if (state.busy && state.pending?.kind === "present") return "presentation";
  if (state.busy && !state.report && !state.presentation) return "generating";
  if (state.timeout) return "timeout";
  if (state.error && state.error.kind === "error") return "error";
  if (state.encourage) return "encourage";
  if (state.presentation) return "presentation";
  if (state.report) return "recommendation";
  return "chat";
}

function render() {
  if (!state.presentation || !state.inFlow || state.busy || state.encourage || state.timeout || state.error) resultViews?.stopMediaPoll();
  renderBadges();
  renderBanners();
  renderSteps();
  renderLandingVisibility();
  const view = $("view");
  view.hidden = !state.inFlow;
  let rendered;
  if (!state.config && state.configError) {
    // 配置请求失败：给中文失败态 + 重试入口，不用本地假配置顶上。
    rendered = renderConfigError();
  } else if (!state.config && !(state.error && state.error.kind === "error")) {
    // 接入层配置还没到手：不渲染表单（表单字段全部来自配置，读它会空指针）。
    rendered = renderWaiting();
  } else if (!state.inFlow) {
    rendered = { body: [el("p", { class: "sr-only", text: "点击开始挑选礼物进入三页流程。" })], actions: [] };
  } else if (state.busy && state.pending?.kind === "recommend") {
    // 聊完直接进入结果页，文字没回来前在结果页里等（不再停在独立加载页）。
    rendered = views().renderRecommendationLoading();
  } else if (state.busy && state.pending?.kind === "present") {
    rendered = views().renderPresentationLoading(state.pending.candidateId);
  } else if (state.busy) {
    rendered = renderGenerating();
  } else if (state.timeout) {
    rendered = stateView(
      "超时：没有在设定时间内拿到结果",
      [
        state.error && state.error.errors[0] ? state.error.errors[0].message : "请求超时。",
        "超时不会被当作成功，也没有生成任何方案或呈现内容。",
      ],
      [],
      [state.error ? errorBox(state.error.errors, "错误码") : null, recoveryActions()],
    );
  } else if (state.error && state.error.kind === "error") {
    rendered = stateView(
      "错误：这次请求没有成功",
      ["服务端返回错误，未把任何内容标记为通过。请稍后重试或检查接入层是否已启动。"],
      [],
      [errorBox(state.error.errors, "错误详情"), recoveryActions()],
    );
  } else if (state.encourage) {
    rendered = renderEncourage();
  } else if (state.presentation) {
    rendered = renderPresentation();
  } else if (state.report) {
    rendered = renderRecommendation();
  } else {
    rendered = renderChat();
  }

  const nodes = [].concat(rendered.body).filter(Boolean);
  // 重绘会销毁并替换输入框节点：先记下正在编辑的字段，重绘后还原焦点与光标。
  const focused = captureFocus();
  view.replaceChildren(...nodes);

  // 视图切换时给一次位移动效（CSS 里是 #view.gw-enter）；打字重绘不会重放。
  const viewKey = currentViewKey();
  if (view.dataset.viewKey !== viewKey) {
    view.dataset.viewKey = viewKey;
    view.classList.remove("gw-enter");
    void view.offsetWidth;
    view.classList.add("gw-enter");
  }

  const actions = $("actions") || (() => {
    const bar = el("div", { class: "actions", id: "actions" });
    $("view").after(bar); // 紧跟内容区，位于页脚之前
    return bar;
  })();
  actions.replaceChildren(...[].concat(rendered.actions || []).filter(Boolean));
  actions.hidden = !state.inFlow;
  document.querySelector(".app-footer").hidden = false;
  document.body.classList.toggle("gw-flow-active", state.inFlow);
  document.body.classList.toggle("gw-chat-active", inChat());
  restoreFocus(focused);

  $("footer-meta").textContent = "";
}

function selectLast() {
  if (state.pending && state.pending.kind === "present" && state.pending.candidateId) {
    return selectCandidate(state.pending.candidateId);
  }
  return submitIntake();
}

setupChat({ state, el, render: () => render(), submit: () => submitIntake(), analyze: (intake, continuation) => analyzeDislikes(intake, continuation), buildIntake, invalidateAnalysis, restart: () => restartChat(), parseText: utterance => parseIntakeText(utterance) });

/**
 * 真实 /api/config → 前端运行时配置的最小归一化。
 *
 * 已核实的跨文件契约不一致（js/chat.js 不在本次授权的 4 个文件内，不能在那里改）：
 *   · 服务端 web/server/config.mjs 的 DEADLINE_RANGES 用 `value` 表示天数，形如
 *     {id,label,value:5,hint,minDays,maxDays}；
 *   · js/chat.js:52 的 deadlineOptions() 只认 `r.days` 或 `r.available_days`，
 *     于是六个档位的 days 全是 undefined → 函数返回 null →
 *     「大概多久之后送出？」这题没有选项、check() 永远报「请选择可用准备时间」，
 *     接真实后端后**整个流程会卡在第 4 题**（浏览器实测：找不到 opt-deadline-* 选项）。
 * 这里把服务端自己给出的数字 1:1 补成 `days`（不重建业务映射、不改 minDays/maxDays
 * 等其它字段，只加一个同值字段），让 chat.js 的既有契约成立。
 * 正经修复应由 owner 决定：后端在 ranges.deadline 里补 `days`，或 chat.js 直接接受 `value`。
 * 回退：删掉本函数与 loadConfig 里的那一次调用即可。
 */
function normalizeConfig(data) {
  const deadline = data?.ranges?.deadline;
  if (Array.isArray(deadline)) {
    data.ranges.deadline = deadline.map((range) => {
      if (!range || typeof range !== "object" || Number.isInteger(range.days)) return range;
      const days = Number.isInteger(range.value) ? range.value : range.available_days;
      return Number.isInteger(days) ? { ...range, days } : range;
    });
  }
  return data;
}

/**
 * 读接入层配置（GET /api/config）。
 * 改前：`state.config = previewConfig` —— 直接把本地预览配置当运行时配置，
 *       于是关系/场合/预算区间全是前端内置的假标签，与后端实际标签表可能不一致。
 * 改后：默认走真实 HTTP；失败进 state.configError（中文失败态 + 重试入口），
 *       绝不用本地假配置静默顶上。只有显式 ?preview=1 时才仍由预览适配器返回配置。
 */
async function loadConfig() {
  state.configError = null;
  render();
  try {
    const response = await apiFetch("/api/config", null, { timeoutMs: CONFIG_TIMEOUT_MS, track: false });
    const data = response.data;
    if (!response.ok || !data || typeof data !== "object" || !data.labels || !data.limits) {
      state.configError = { errors: [{ code: "CONFIG_BAD_RESPONSE", path: "/api/config", message: "服务端返回的配置缺少 labels / limits，无法渲染表单。" }] };
      render();
      return;
    }
    state.config = normalizeConfig(data);
    state.configError = null;
    render();
  } catch (err) {
    const timeout = err && err.code === "CLIENT_TIMEOUT";
    state.configError = {
      errors: [{
        code: timeout ? "CLIENT_TIMEOUT" : "NETWORK_ERROR",
        path: "/api/config",
        message: timeout
          ? `读取配置超过 ${Math.round(CONFIG_TIMEOUT_MS / 1000)} 秒没有返回，已中止。`
          : "无法连接接入层服务（/api/config 没有响应）。",
      }],
    };
    render();
  }
}

async function bootstrap() {
  // 先绑定入口与读取配置，再渲染：渲染依赖 state.config，
  // 顺序反了会在首帧抛 TypeError 并阻断后面的配置加载。
  for (const id of ["cta-start", "cta-start-2", "cta-start-3", "cta-welcome"]) {
    const node = $(id);
    if (node) {
      node.addEventListener("click", startFlow);
    }
  }
  render();
  await loadConfig();
}

bootstrap();
