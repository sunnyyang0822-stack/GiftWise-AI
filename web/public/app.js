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

import { PREVIEW_MODE, previewConfig, previewRequest, previewScenarios, setPreviewScenario } from "./js/preview-api.js";
import { createResultViews } from "./js/results-view.js";
import { setupChat, ensureChat, newChatState, renderChat, chatProblems, chatProgress, reopen, codePoints } from "./js/chat.js";

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
  };
}

const state = {
  config: null,
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
  form: initialForm(),
};

const CONTRACT_VERSION = "giftwise-20261031-v2";
// 对话题目的三个分组：用于顶部细进度条的无障碍说明。
const STEP_TITLES = ["关系场合预算时间", "兴趣风格", "需要避免的与补充"];

function invalidateAnalysis() {
  state.analysis = null;
  state.confirmedIds = [];
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

function errorBox(errors, title = "需要处理的问题") {
  if (!errors || errors.length === 0) return null;
  return el("div", { class: "error-box" }, [
    el("strong", { text: title }),
    el(
      "ul",
      {},
      errors.map((e) =>
        el("li", {}, [
          el("span", { text: e.message || "未知问题" }),
          e.code ? el("span", { class: "code", text: `（${e.code}${e.path ? " · " + e.path : ""}）` }) : null,
        ]),
      ),
    ),
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

/** 配置未就位时的中文等待态：表单字段全部来自接入层配置，缺配置就先去读配置。 */
function renderWaiting() {
  return {
    body: [
      el("section", { class: "state" }, [
        el("div", { class: "spinner", role: "presentation" }),
        el("h2", { class: "state__title", text: "正在载入接入层配置…" }),
      ]),
    ],
    actions: [],
  };
}

function renderGenerating() {  return {
    body: [
      el("section", { class: "state" }, [
        el("h2", { class: "state__title", role: "status", "aria-live": "polite" }, [el("span", { class: "spinner", "aria-hidden": "true" }), state.pending?.kind === "analyze" ? "正在识别你写下的限制…" : state.pending?.kind === "present" ? "正在整理这份礼物的账单与赠送建议…" : "正在生成三个不同思路…"]),
        el("p", { text: "稍等一下，正在为你整理。" }),
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
  resultViews ||= createResultViews({ el, state, selectCandidate, resetToForm, backToEncourage, backToHome, errorBox, stateView, render });
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

export function buildIntake() {
  const f = state.form;
  const intake = {
    recipient_relation: f.recipient_relation,
    occasion: f.occasion,
    contract_version: CONTRACT_VERSION,
    budget_mode: f.budget_mode,
    budget_range: { min: f.budget_min, max: f.budget_max },
    currency: "CNY",
    deadline_days: Number(f.deadline_days),
    interests: f.interests_unknown ? [] : [...f.interests],
    interest_confidence: f.interests_unknown ? {} : { ...f.interest_confidence },
    gift_styles: f.styles_unknown ? [] : [...f.gift_styles],
    dislikes: f.dislikes.trim() ? f.dislikes : "",
    previous_gifts: f.previous_gifts || "",
    hard_exclusions: { tags: [...f.exclusion_tags], terms: [], unresolved: [] },
    additional_context: f.additional_context || "",
  };
  if (f.recipient_relation === "other") intake.recipient_relation_custom = f.recipient_relation_other.trim();
  if (f.occasion === "other") intake.occasion_custom = f.occasion_other.trim();
  if (f.closeness) intake.closeness = f.closeness;
  return intake;
}

async function analyzeDislikes(intake) {
  const response = await apiFetch("/api/exclusions/analyze", { intake });
  return response.data || { status: "error", errors: [{code:"BAD_RESPONSE",message:"识别暂未完成，请重试。"}] };
}

async function apiFetch(path, payload) {
  if (PREVIEW_MODE) return previewRequest(path, payload);
  throw new Error("同版本后端尚未接入，旧服务调用已禁用");
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
  // 填写了“需要避免的”：必须先经 /api/exclusions/analyze 识别并在对话里逐条确认，没有默认全选。
  if (intake.dislikes && (!state.analysis || state.analysis.status !== "needs_confirmation" || state.confirmedIds.length !== state.analysis.candidates.length)) {
    backToQuestion("avoid_confirm", "请先逐条确认我理解到的限制。");
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
    if (intake.dislikes) payload.exclusion_confirmation = { analysis_id: state.analysis.analysis_id, confirmed_ids: [...state.confirmedIds] };
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
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      state.timeout = true;
      state.error = { kind: "timeout", errors: [{ code: "CLIENT_TIMEOUT", message: "请求超时：服务端在设定时间内没有返回，已按超时处理，未标记为通过。" }] };
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
    if (err && err.name === "AbortError") {
      state.timeout = true;
      state.error = { kind: "timeout", errors: [{ code: "CLIENT_TIMEOUT", message: "请求超时：未生成呈现内容，也未标记为完成。" }] };
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
  if (!state.config && !(state.error && state.error.kind === "error")) return "waiting";
  if (state.busy && !state.report && !state.presentation) return "generating";
  if (state.timeout) return "timeout";
  if (state.error && state.error.kind === "error") return "error";
  if (state.encourage) return "encourage";
  if (state.presentation) return "presentation";
  if (state.report) return "recommendation";
  return "chat";
}

function render() {
  renderBadges();
  renderBanners();
  renderSteps();
  renderLandingVisibility();
  const view = $("view");
  view.hidden = !state.inFlow;
  let rendered;
  if (!state.config && !(state.error && state.error.kind === "error")) {
    // 接入层配置还没到手：不渲染表单（表单字段全部来自配置，读它会空指针）。
    rendered = renderWaiting();
  } else if (!state.inFlow) {
    rendered = { body: [el("p", { class: "sr-only", text: "点击开始挑选礼物进入三页流程。" })], actions: [] };
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

setupChat({ state, el, render: () => render(), submit: () => submitIntake(), analyze: intake => analyzeDislikes(intake), buildIntake, invalidateAnalysis, restart: () => restartChat() });

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
  // 当前仅加载本地固定配置，不请求旧服务或第三方模型。
  state.config = previewConfig;
  render();
}

bootstrap();
