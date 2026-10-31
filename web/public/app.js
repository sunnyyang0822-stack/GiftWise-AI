/**
 * GiftWise AI · web 最小前端（WEB-WF-001 / WEB-001）
 *
 * 设计边界：
 *   - 只提交 intake 契约字段；facts / available_days / passed / repair_count 等派生值
 *     一律不提交（提交也会被服务端 INTAKE_UNKNOWN_FIELD 拒绝）；
 *   - selected_candidate_id 只来自用户点击，且在推荐阶段由服务端固定返回 null；
 *   - 全局最多一次自动业务修订由服务端持有，前端只显示，不能提交；
 *   - 所有文案为简体中文；页面常驻模拟数据标识。
 */

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
  form: {
    recipient_relation: null,
    closeness: null,
    occasion: null,
    budget_mode: "slider",
    budget_min: "100",
    budget_max: "300",
    budget_confirmed: false,
    deadline_days: "",
    interests: [],
    interest_confidence: {},
    interests_unknown: false,
    gift_styles: [],
    styles_unknown: false,
    exclusion_tags: [],
    dislikes: "",
    additional_context: "",
  },
};

const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;

const CONTRACT_VERSION = "giftwise-20261031-v2";
const STEP_TITLES = ["关系场合预算时间", "兴趣风格", "不喜欢和补充"];
const LOCAL_UI_FIXTURE = new URLSearchParams(location.search).get("ui_fixture") === "nov01";
const LOCAL_DEADLINES = [
  ["一天", 1], ["3–5天", 5], ["一周", 7], ["一月", 30], ["一季度", 90], ["一年", 365],
].map(([label, days]) => ({ id: `fixture-${days}`, label, days }));
const codePoints = value => [...value].length;
const moneyCents = value => AMOUNT_RE.test(value) ? Number(value.split(".")[0]) * 100 + Number((value.split(".")[1] || "").padEnd(2, "0")) : null;

function invalidateAnalysis() {
  state.analysis = null;
  state.confirmedIds = [];
}
function cancelPending() {
  state.requestVersion++;
  state.controller?.abort();
  state.busy = false;
}
function moveToStep(step) {
  state.step = step;
  state.error = null;
  render();
  $("view").scrollIntoView({ block: "start" });
  $("view").focus({ preventScroll: true });
}
function startFlow() {
  cancelPending();
  state.inFlow = true;
  state.report = null;
  state.presentation = null;
  state.encourage = false;
  state.timeout = false;
  moveToStep(1);
}

/* ------------------------------------------------------------------ 渲染 */

function renderBadges() {
  $("badges").replaceChildren(el("span", { class: "sr-only", text: "流程状态由顶部标识说明。" }));
  $("badges").hidden = true;
  if (!state.config) return;
  const mock = state.config.mode === "mock";
  const flag = $("mode-flag");
  flag.hidden = false;
  flag.textContent = mock ? "模拟数据 · 未接真实模型" : "模型生成 · 价格未核实";
  flag.classList.toggle("mode-flag--real", !mock);
  flag.title = mock ? "本次候选、识别与呈现为模拟数据，不是真实模型输出。" : "生成内容仍需独立规则检查，价格、库存与送达未核实。";
  $("hero-flag").hidden = !mock;
  $("hero-flag").textContent = "当前为模拟数据演示，识别、方案与呈现均非真实模型输出；价格、库存与送达未核实。";
}
function renderBanners() {
  const slot = $("banner-slot");
  slot.replaceChildren();
  const notices = [state.restoreNotice, state.config?.fixture_notice].filter(Boolean);
  slot.hidden = notices.length === 0 || !state.inFlow;
  if (!slot.hidden) notices.forEach(text => slot.append(el("p", { class: "banner banner--warn", text })));
  else slot.append(el("span", { class: "sr-only", text: "暂无流程通知。" }));
}
function renderSteps() {
  const nav = $("steps");
  nav.replaceChildren();
  const inForm = state.inFlow && !state.busy && !state.report && !state.presentation && !state.encourage;
  nav.hidden = !inForm;
  if (!inForm) return;
  nav.setAttribute("aria-label", `填写进度：第 ${state.step} 步，共三步`);
  nav.append(el("p", { class: "step-page", text: `第 ${state.step} 步 / 共三步` }));
  nav.append(el("progress", { max: "3", value: String(state.step), "aria-label": "需求填写进度" }));
  nav.append(el("ol", { class: "revision-step-list" }, STEP_TITLES.map((title,i) => el("li", {}, [
    el("button", { type: "button", class: "step-pill", "aria-current": state.step === i+1 ? "step" : null,
      disabled: i+1 > state.step, text: `${i+1}. ${title}`, onclick: () => moveToStep(i+1) }),
  ]))));
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

function chip(label, selected, onToggle, extra = {}) {
  const input = el("input", { type: "checkbox", checked: selected, "aria-label": label });
  const node = el("label", { class: `chip ${extra.class || ""}`, dataset: { selected: String(selected) } }, [
    input,
    el("span", { text: label }),
  ]);
  input.addEventListener("change", () => onToggle(input.checked));
  if (extra.disabled) input.disabled = true;
  return node;
}

/* --------------------------------------------------------------- 第一步 */

function renderStep1() {
  const f = state.form;
  const cfg = state.config;
  const body = [];

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "给谁送、什么关系？" }),
      el("p", {
        class: "card__hint field__hint",
        text:
          "恋人与追求对象是两个独立选项，不会互相替代。追求对象默认低压力表达，不假定对方已接受或存在双向好感。",
      }),
      el(
        "div",
        { class: "chips" },
        cfg.labels.relations.map((item) =>
          chip(item.zh, f.recipient_relation === item.id, () => {
            f.recipient_relation = f.recipient_relation === item.id ? null : item.id;
            render();
          }, { class: "chip--radio" }),
        ),
      ),
      f.recipient_relation
        ? el("p", {
            class: "field__selected",
            text: `已选「${cfg.labels.relations.find((x) => x.id === f.recipient_relation).zh}」：${cfg.labels.relations.find((x) => x.id === f.recipient_relation).scene}`,
          })
        : null,
      f.recipient_relation === "pursuit" && !cfg.pursuit_contract_ready
        ? el("p", { class: "field__error", text: cfg.pursuit_notice })
        : null,
    ]),
  );

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "熟悉程度（可跳过）" }),
      el("p", { class: "field__hint", text: "不确定可以留空；不会依据关系或职业替你推断对方的喜好。" }),
      el(
        "div",
        { class: "chips" },
        cfg.labels.closeness.map((item) =>
          chip(item.zh, f.closeness === item.id, () => {
            f.closeness = f.closeness === item.id ? null : item.id;
            render();
          }, { class: "chip--radio", type: "radio" }),
        ),
      ),
    ]),
  );

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "送礼场合" }),
      el(
        "div",
        { class: "chips" },
        cfg.labels.occasions.map((item) =>
          chip(item.zh, f.occasion === item.id, () => {
            f.occasion = f.occasion === item.id ? null : item.id;
            render();
          }, { class: "chip--radio", type: "radio" }),
        ),
      ),
    ]),
  );

  body.push(renderBudget(), renderDeadline());


  return {
    body,
    actions: [
      el("button", {
        class: "btn btn--primary",
        type: "button",
        // 稳定 id：验证脚本按 id 选择，不再依赖会变的按钮文案（协调方 01:2x 的契约改动）。
        id: "step-next",
        text: "下一步：兴趣与风格",
        onclick: () => {
          const problem = validateStep1();
          if (problem) {
            state.error = { kind: "needs_input", errors: problem };
            render();
            return;
          }
          state.error = null;
          state.step = 2;
          render();
        },
      }),
    ],
  };
}

function deadlineOptions() {
  const options = state.config?.deadline_options || state.config?.ranges?.deadline;
  // Accept numeric config only, never reconstruct the six business mappings in the browser.
  if (!Array.isArray(options) || options.length !== 6) return null;
  const normalized = options.map(r => ({ ...r, days: Number.isInteger(r.days) ? r.days : r.available_days }));
  return normalized.every(r => typeof r.label === "string" && Number.isInteger(r.days) && r.days >= 0 && r.days <= 365)
    && new Set(normalized.map(r => r.days)).size === 6 ? normalized : null;
}
function budgetProblems() {
  const f = state.form, errors = [];
  const min = moneyCents(f.budget_min), max = moneyCents(f.budget_max);
  if (!["slider","zero","other"].includes(f.budget_mode)) errors.push({code:"INTAKE_CLARIFICATION_REQUIRED",message:"预算还不确定，请先选定区间或其他金额。"});
  if (min === null || max === null) errors.push({code:"INVALID_AMOUNT",message:"预算两端都需填写非负金额，最多两位小数，不含空格或前导零。"});
  else if (min > 1000000 || max > 1000000) errors.push({code:"LIMIT_EXCEEDED",message:"礼物预算最高为 10000 元。"});
  else if (min > max) errors.push({code:"INVALID_BUDGET_RANGE",message:"预算下限不能高于上限。"});
  else if (f.budget_mode === "slider" && (max > 100000 || min % 5000 || max % 5000)) errors.push({code:"INVALID_BUDGET_RANGE",message:"滑条区间需在 0–1000 元内，每次调整 50 元。"});
  else if (f.budget_mode === "zero" && (min !== 0 || max !== 0)) errors.push({code:"INVALID_BUDGET_RANGE",message:"不花钱的心意应为 0–0 元。"});
  if (!f.budget_confirmed) errors.push({code:"INTAKE_CLARIFICATION_REQUIRED",message:"请调整滑条或明确确认礼物预算区间。"});
  return errors;
}
function validateStep1() {
  const f = state.form, errors = budgetProblems();
  if (!f.recipient_relation) errors.unshift({code:"INTAKE_CLARIFICATION_REQUIRED",message:"请选择送礼对象的关系。"});
  if (!f.occasion) errors.push({code:"INTAKE_CLARIFICATION_REQUIRED",message:"请选择送礼场合。"});
  const options = deadlineOptions();
  if (!options) errors.push({code:"CONFIG_VERSION_UNSUPPORTED",message:"准备时间配置尚未更新为六档，请稍后重试。"});
  else if (!options.some(r => String(r.days) === f.deadline_days)) errors.push({code:"INTAKE_CLARIFICATION_REQUIRED",message:"请选择可用准备时间。"});
  return errors.length ? errors : null;
}
function renderBudget() {
  const f = state.form;
  const modes = [["slider","选择预算区间"],["zero","不花钱的心意"],["other","其他金额"],["uncertain","不确定"]];
  const body = [
    el("h2", {class:"card__title",text:"这份心意，想花多少？"}),
    el("p", {class:"field__hint",text:"预算只计算礼物本身。包装、贺卡、装饰和配送未计价，不代表免费。"}),
    el("div", {class:"chips",role:"group","aria-label":"预算方式"}, modes.map(([mode,label]) => chip(label,f.budget_mode===mode,()=>{
      f.budget_mode = f.budget_mode === mode ? null : mode;
      f.budget_confirmed = mode === "zero" && f.budget_mode === "zero";
      if (f.budget_mode === "zero") { f.budget_min="0";f.budget_max="0"; }
      if (f.budget_mode === "slider") {f.budget_min="100";f.budget_max="300";}
      invalidateAnalysis();render();
    }))),
  ];
  if (f.budget_mode === "slider") {
    const update = (which,event) => {
      const value = Number(event.target.value);
      const other = Number(which === "min" ? f.budget_max : f.budget_min);
      const next = which === "min" ? Math.min(value,other) : Math.max(value,other);
      f[`budget_${which}`] = String(next);
      event.target.value = String(next);
      f.budget_confirmed = true; invalidateAnalysis();
      const output = $("budget-readout"); output.textContent = `预算下限 ${f.budget_min} 元 — 上限 ${f.budget_max} 元`;
      const dual = document.querySelector(".range-dual");
      if (dual) { dual.style.setProperty("--range-min", `${Number(f.budget_min) / 10}%`); dual.style.setProperty("--range-max", `${Number(f.budget_max) / 10}%`); }
      document.querySelectorAll('[data-budget-value]').forEach(n=>{n.textContent=f[`budget_${n.dataset.budgetValue}`]+" 元"});
      const selected = document.querySelector(".range-dual__selected");
      if (selected) selected.textContent = `${f.budget_min}–${f.budget_max} 元`;
      const confirm = $("budget-confirm"); if(confirm) confirm.checked = true;
    };
    body.push(
      el("p", {id:"budget-readout",class:"budget-readout",role:"status","aria-live":"polite",text:`预算下限 ${f.budget_min} 元 — 上限 ${f.budget_max} 元`}),
      el("div",{class:"budget-sliders"},[
        el("div",{class:"range-dual","style":`--range-min:${Number(f.budget_min) / 10}%;--range-max:${Number(f.budget_max) / 10}%`},[
          el("div",{class:"range-dual__track","aria-hidden":"true"}),
          el("div",{class:"range-dual__fill","aria-hidden":"true"}),
          ...["min","max"].map(which => el("input",{type:"range",id:`budget-${which}`,min:"0",max:"1000",step:"50",value:f[`budget_${which}`],"aria-label":which === "min" ? "礼物预算下限" : "礼物预算上限","data-field":`budget-${which}`,oninput:e=>update(which,e)})),
        ]),
        el("div",{class:"range-dual__labels"},[
          el("strong",{text:"0 元"}),
          el("span",{class:"range-dual__selected",text:`${f.budget_min}–${f.budget_max} 元`}),
          el("strong",{text:"1000 元"}),
        ]),
      ]),
      el("p",{class:"field__hint",text:"同一条轨道的两端都可拖动；左端是下限，右端是上限。也可用方向键调整，每次 50 元。"})
    );
  } else if (f.budget_mode === "other") {
    body.push(el("div",{class:"budget-custom"},["min","max"].map(which=>el("label",{},[
      el("span",{text:which === "min" ? "预算下限（元）" : "预算上限（元）"}),
      el("input",{type:"text",inputmode:"decimal",value:f[`budget_${which}`],id:`budget-other-${which}`,"aria-label":which === "min" ? "其他金额下限" : "其他金额上限","data-field":`budget_other_${which}`,oninput:e=>{
        f[`budget_${which}`]=e.target.value;f.budget_confirmed=false;invalidateAnalysis();
        const c=$("budget-confirm");if(c)c.checked=false;
      }}),
    ]))),el("p",{class:"field__hint",text:"两端必填，0–10000 元，最多两位小数。"}));
  } else if (f.budget_mode === "zero") {
    body.push(el("p",{class:"field__selected",text:"礼物预算 0 元：优先已有材料、手写或陪伴；可行性仍需核对，不把新购物品称作免费。"}));
  } else body.push(el("p",{class:"field__hint",text:"可以先想一想愿意花多少。不确定时会先请你澄清，不直接生成。"}));
  if (["slider","other"].includes(f.budget_mode)) body.push(el("label",{class:"confirm-row"},[
    el("input",{id:"budget-confirm",type:"checkbox",checked:f.budget_confirmed,onchange:e=>{f.budget_confirmed=e.target.checked;invalidateAnalysis();}}),
    el("span",{text:"我确认当前礼物预算区间（初始显示不代表已经确认）"}),
  ]));
  return el("section",{class:"card budget-card"},body);
}
function renderDeadline() {
  const options = deadlineOptions();
  const simpleLabel = days => ({ 1: "一天", 5: "3–5天", 7: "一周", 30: "一月", 90: "一季度", 365: "一年" }[days] || "");
  return el("section",{class:"card"},[
    el("h2",{class:"card__title",text:"你有多少时间准备？"}),
    el("p",{class:"field__hint",text:"选一个最接近的时间，不代表承诺送达日期。"}),
    options ? el("div",{class:"chips deadline-options",role:"group","aria-label":"准备时间"},options.map(r=>chip(simpleLabel(r.days) || r.label,state.form.deadline_days===String(r.days),()=>{
      state.form.deadline_days=state.form.deadline_days===String(r.days)?"":String(r.days);invalidateAnalysis();render();
    }))) : el("p",{class:"field__error",role:"alert",text:"准备时间配置尚未更新为六档，请稍后刷新；暂不能提交。"}),
  ]);
}


/* --------------------------------------------------------------- 第二步 */

function renderStep2() {
  const f = state.form;
  const cfg = state.config;
  const body = [];
  const confirmedCount = f.interests.filter((id) => f.interest_confidence[id] === "confirmed").length;

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "对方的兴趣（可跳过）" }),
      el("p", { class: "field__hint", text: cfg.unknown_interests_hint }),
      el(
        "div",
        { class: "chips" },
        [
          chip("暂时不知道（互斥）", f.interests_unknown, (checked) => {
            f.interests_unknown = checked;
            if (checked) {
              f.interests = [];
              f.interest_confidence = {};
            }
            render();
          }, { class: "chip--muted" }),
        ],
      ),
      el("div", { style: "margin-top:10px" },
        cfg.labels.interests.map((item) => {
          const selected = f.interests.includes(item.id);
          const row = el("div", { class: "interest-row" }, [
            chip(item.zh, selected, (checked) => {
              if (checked) {
                f.interests_unknown = false;
                if (!f.interests.includes(item.id)) f.interests.push(item.id);
                if (!(item.id in f.interest_confidence)) f.interest_confidence[item.id] = "inferred";
              } else {
                f.interests = f.interests.filter((x) => x !== item.id);
                delete f.interest_confidence[item.id];
              }
              render();
            }),
            selected && !f.interests_unknown
              ? el("div", { class: "seg", role: "group", "aria-label": `${item.zh}的可信度` }, [
                  el("button", {
                    type: "button",
                    "aria-pressed": String(f.interest_confidence[item.id] === "confirmed"),
                    text: "明确知道",
                    onclick: () => {
                      f.interest_confidence[item.id] = "confirmed";
                      render();
                    },
                  }),
                  el("button", {
                    type: "button",
                    "aria-pressed": String((f.interest_confidence[item.id] || "inferred") === "inferred"),
                    text: "只是猜测",
                    onclick: () => {
                      f.interest_confidence[item.id] = "inferred";
                      render();
                    },
                  }),
                ])
              : null,
          ]);
          return row;
        }),
      ),
      el("p", {
        class: "field__hint",
        text: `当前会生成 ${confirmedCount} 条用户事实（只有「明确知道」才进入事实；「只是猜测」单独存为推断）。`,
      }),
    ]),
  );

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "你希望的礼物风格（可跳过）" }),
      el("p", { class: "field__hint", text: "这是你希望的风格，不是收礼人已确认的偏好。" }),
      el(
        "div",
        { class: "chips" },
        [
          chip("不确定（互斥）", f.styles_unknown, (checked) => {
            f.styles_unknown = checked;
            if (checked) f.gift_styles = [];
            render();
          }, { class: "chip--muted" }),
          ...cfg.labels.gift_styles.map((item) =>
            chip(item.zh, f.gift_styles.includes(item.id), (checked) => {
              f.styles_unknown = false;
              if (checked && !f.gift_styles.includes(item.id)) f.gift_styles.push(item.id);
              if (!checked) f.gift_styles = f.gift_styles.filter((x) => x !== item.id);
              render();
            }),
          ),
        ],
      ),
    ]),
  );

  return {
    body,
    actions: [
      el("button", {
        class: "btn btn--ghost",
        type: "button",
        // 第二步的「返回第一步」就是这一步的上一步；给它稳定 id，不再另加一个同义按钮。
        id: "step-back",
        text: "上一步",
        onclick: () => {
          state.step = 1;
          state.error = null;
          render();
        },
      }),
      el("button", {
        class: "btn btn--ghost",
        type: "button",
        text: "跳过（视为未知）",
        onclick: () => {
          f.interests = [];
          f.interest_confidence = {};
          f.interests_unknown = true;
          f.gift_styles = [];
          f.styles_unknown = true;
          state.step = 3;
          state.error = null;
          render();
        },
      }),
      el("button", {
        class: "btn btn--primary",
        type: "button",
        id: "step-next",
        text: "下一步：不喜欢和补充",
        onclick: () => {
          state.step = 3;
          state.error = null;
          render();
        },
      }),
    ],
  };
}

/* --------------------------------------------------------------- 第三步 */

function renderStep3() {
  const f = state.form;
  return {
    body: [
      el("section",{class:"card"},[
        el("h2",{class:"card__title",text:"有哪些明确要避开的？"}),
        el("p",{class:"field__hint",text:"类别可以不选；选中的类别会成为明确限制。"}),
        el("div",{class:"chips"},state.config.labels.exclusions.map(item=>chip(item.zh,f.exclusion_tags.includes(item.id),checked=>{
          f.exclusion_tags = checked ? [...f.exclusion_tags,item.id] : f.exclusion_tags.filter(id=>id!==item.id);
          invalidateAnalysis();render();
        }))),
        el("label",{class:"text-field"},[
          el("span",{text:"不喜欢的东西（可选）"}),
          el("textarea",{id:"dislikes","aria-label":"不喜欢的东西","data-field":"dislikes",placeholder:"例如：不要香水。请只填写虚构或已脱敏的信息。",oninput:e=>{
            f.dislikes=e.target.value;invalidateAnalysis();render();
          }},[f.dislikes]),
        ]),
        el("p",{class:"field__hint",text:`${codePoints(f.dislikes)} / 1000 字。非空内容会先识别，再请你逐条确认；不能可靠理解时会先澄清。`}),
        el("label",{class:"text-field"},[
          el("span",{text:"补充说明（可选）"}),
          el("textarea",{id:"additional-context","aria-label":"补充说明","data-field":"additional_context",placeholder:"例如：希望表达感谢，不造成回应压力。",oninput:e=>{
            f.additional_context=e.target.value;invalidateAnalysis();render();
          }},[f.additional_context]),
        ]),
        el("p",{class:"field__hint",text:"补充说明不能解除上面的限制。无需真实姓名、手机号或邮箱。"}),
      ]),
      renderAnalysis(),
    ],
    actions: [
      el("button",{class:"btn",id:"step-back",type:"button",text:"上一步",onclick:()=>moveToStep(2)}),
      el("button",{class:"btn btn--primary",id:"step-next",type:"button",text:state.analysis?.status === "needs_confirmation" ? "确认并生成三个方案" : "生成三个方案",onclick:submitIntake}),
    ],
  };
}
function renderAnalysis() {
  const a = state.analysis;
  if (!a) return null;
  if (a.status !== "needs_confirmation") return el("section",{class:"card card--fail",id:"exclusion-analysis",role:"status"},[
    el("h2",{class:"card__title",text:"这部分还需要你澄清"}),
    el("p",{text:"暂时无法可靠理解全部限制，不会先生成礼物。请修改“不喜欢的东西”后重新识别。"}),
    errorBox(a.errors,"需要澄清"),
    el("button",{class:"btn",type:"button",text:"修改不喜欢的东西",onclick:()=>$("dislikes").focus()}),
    el("button",{class:"btn",id:"analyze-again",type:"button",text:"重新识别",onclick:()=>{invalidateAnalysis();submitIntake();}}),
  ]);
  return el("section",{class:"card",id:"exclusion-analysis","aria-labelledby":"analysis-title"},[
    el("h2",{class:"card__title",id:"analysis-title",text:"我理解的是这些，请你确认"}),
    el("p",{class:"field__hint",text:`${a.mode === "mock" ? "模拟识别结果" : "识别结果"} · 文字来源不代表理解一定正确；没有预先勾选，全部确认后才会推荐。`}),
    ...a.candidates.map(c=>el("div",{class:"analysis-item"},[
      el("blockquote",{text:`原文依据：「${c.source_span}」`}),
      el("p",{text:`理解：${c.kind === "tag" ? (state.config.labels.exclusions.find(x=>x.id===c.tag)?.zh || c.tag) : c.term}`}),
      el("p",{text:`理由：${c.why}`}),
      el("p",{class:"field__hint",text:`${state.confirmedIds.includes(c.id)?"已确认":"待确认"} · 识别把握：${({high:"较高",medium:"中等",low:"较低"})[c.confidence] || "未知"}`}),
      el("label",{class:"confirm-row"},[
        el("input",{type:"checkbox",id:`exclusion-confirm-${c.id}`,checked:state.confirmedIds.includes(c.id),onchange:e=>{
          state.confirmedIds=e.target.checked?[...state.confirmedIds,c.id]:state.confirmedIds.filter(id=>id!==c.id);render();
        }}),el("span",{text:`确认这项限制：${c.source_span}`}),
      ]),
    ])),
    el("button",{class:"btn",type:"button",text:"理解不对，修改原话",onclick:()=>$("dislikes").focus()}),
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
        el("p", { text: "关系、场合、兴趣、风格与预算区间都由服务端配置下发，载入完成前不显示空表单，也不使用任何前端内置默认值。" }),
      ]),
    ],
    actions: [],
  };
}

function renderGenerating() {  return {
    body: [
      el("section", { class: "state" }, [
        el("h2", { class: "state__title" }, [el("span", { class: "spinner", "aria-hidden": "true" }), state.pending?.kind === "analyze" ? "正在识别你写下的限制…" : "正在生成三个不同思路…"]),
        el("p", { text: state.pending?.kind === "analyze" ? "先核对原文依据与识别理由；确认前不会生成任何礼物方案。" : "服务端正在做确定性适配 → 生成三候选 → 独立规则校验；如有可修订项，最多自动修订一次并重新校验。" }),
        el("p", { text: "你已经在认真对待这份心意了——先喝口水，剩下的交给服务端。" }),
        el("p", { class: "field__hint", text: "请不要重复点击；选择方案之前不会生成包装、贺卡或赠送方式。" }),
      ]),
    ],
    actions: [],
  };
}

/* --------------------------------------------------------- 三方案对比页 */

function renderRecommendation() {
  const report = state.report;
  const cfg = state.config;
  const body = [];
  const facts = new Map((report.request.facts || []).map((f) => [f.id, f.text]));
  const errorsByCandidate = new Map((report.validation.candidate_results || []).map((r) => [r.id, r]));
  const selectable = new Set(report.selectable_candidate_ids || []);
  const statusText = {
    passed: "三个方案均通过独立规则检查，请自行选择。",
    failed: "部分或全部方案未通过独立规则检查；失败项不可选。",
    needs_input: "请补充或澄清需求后再推荐。",
    error: "检查暂不可用，未把结果标记为通过。",
  }[report.status] || "状态未知。";

  body.push(
    el("section", { class: `card ${selectable.size > 0 ? "card--ok" : "card--fail"}` }, [
      el("h2", { class: "card__title", text: `推荐结果：${statusText}` }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "运行编号" }),
        el("dd", { class: "code", text: report.recommendation_run_id }),
        el("dt", { text: "关系 / 场合" }),
        el("dd", { text: `${report.request.recipient_relation} · ${report.request.occasion}` }),
        el("dt", { text: "预算 / 天数" }),
        el("dd", { text: `${report.request.budget_range ? `${report.request.budget_range.min}–${report.request.budget_range.max}` : report.request.budget_amount || "未提供"} ${report.request.currency} · ${report.request.available_days} 天（仅估算，不是送达承诺）` }),
        el("dt", { text: "可用自动修订" }),
        el("dd", { text: `已用 ${report.repair_count} / 1，剩余 ${report.remaining_repairs}（由服务端持有，浏览器不能提交）` }),
        el("dt", { text: "当前选择" }),
        el("dd", { text: report.selected_candidate_id === null ? "尚未选择（推荐阶段服务端固定返回 null）" : String(report.selected_candidate_id) }),
        el("dt", { text: "真实业务数据" }),
        el("dd", { text: "not_verified（价格、库存、送达均未核实）" }),
      ]),
      el("p", { class: "field__hint", text: "以下校验结果来自独立规则检查（接入层镜像 validator/rules.py），不是模型自述。" }),
      report.workflow_errors && report.workflow_errors.length > 0
        ? errorBox(report.workflow_errors, "工作流层错误（影响可选范围）")
        : null,
      report.validation.errors && report.validation.errors.length > 0
        ? errorBox(report.validation.errors, "批次级校验错误")
        : null,
    ]),
  );

  if ((report.request.preference_inferences || []).length > 0) {
    body.push(
      el("section", { class: "card" }, [
        el("h2", { class: "card__title", text: "你提供的兴趣归因（推断，不是事实）" }),
        el("ul", { class: "list" }, report.request.preference_inferences.map((x) => el("li", { text: x.text }))),
      ]),
    );
  }

  if ((report.candidates || []).length === 0) {
    return stateView("空状态：没有收到任何候选方案", [
      "服务端没有返回候选，可能模型输出无效或调用失败；本页不会把空结果当作成功。",
    ], backToFormActions("修改需求后重新生成"));
  }

  report.candidates.forEach((candidate, index) => {
    const result = errorsByCandidate.get(candidate.id) || { passed: false, errors: [{ code: "MISSING_RESULT", message: "缺少校验结果，按不可选处理" }] };
    const canSelect = selectable.has(candidate.id);
    body.push(
      el("section", { class: `card ${canSelect ? "" : "card--fail"}` }, [
        el("p", { class: "how__num", text: `思路 ${String(index + 1).padStart(2, "0")} · ${candidate.id}` }),
        el("h2", { class: "card__title", text: candidate.name }),
        el("p", { class: "card__lead", text: candidate.description }),
        el("dl", { class: "kv" }, [
          el("dt", { text: "理由" }),
          el("dd", { text: candidate.reason }),
          el("dt", { text: "用户事实引用" }),
          el(
            "dd",
            {},
            candidate.fact_refs && candidate.fact_refs.length > 0
              ? [el("ul", { class: "list" }, candidate.fact_refs.map((ref) => el("li", { text: `${ref}：${facts.get(ref) || "无有效事实引用"}` })))]
              : ["未提供可引用事实"],
          ),
          el("dt", { text: "模型推断" }),
          el(
            "dd",
            {},
            candidate.inferences && candidate.inferences.length > 0
              ? [el("ul", { class: "list" }, candidate.inferences.map((x) => el("li", { text: x })))]
              : ["无"],
          ),
          el("dt", { text: "仍未知" }),
          el(
            "dd",
            {},
            candidate.unknowns && candidate.unknowns.length > 0
              ? [el("ul", { class: "list" }, candidate.unknowns.map((x) => el("li", { text: x })))]
              : ["未列出；不代表已经核实"],
          ),
          el("dt", { text: "礼物估价" }),
          el("dd", { text: `${candidate.estimated_total} ${candidate.currency}（只表示所选礼物本身；业务数据未核实）` }),
          el("dt", { text: "准备时间" }),
          el("dd", { text: `${candidate.estimated_preparation_days} 天` }),
          el("dt", { text: "独立检查结果" }),
          el("dd", {}, [
            el("strong", { text: canSelect ? "通过，可选择" : "未通过，不可选择" }),
            result.errors && result.errors.length > 0
              ? el("ul", { class: "list" }, result.errors.map((e) => el("li", {}, [el("span", { text: e.message }), el("span", { class: "code", text: `（${e.code}）` })])))
              : null,
          ]),
        ]),
        el("div", { class: "suggest-row" }, [
          canSelect
            ? el("button", {
                class: "btn btn--primary",
                type: "button",
                text: state.busy ? "正在生成呈现…" : "选择这个方案（选择后才生成包装与贺卡）",
                disabled: state.busy,
                onclick: () => selectCandidate(candidate.id),
              })
            : el("span", { class: "field__hint", text: "失败项不可选择；系统也不会自动替你改选其他方案。" }),
        ]),
      ]),
    );
  });

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "未选择状态说明" }),
      el("p", {
        text:
          selectable.size > 0
            ? "已有合格方案但尚未选择。在你明确选择之前，系统不会调用呈现阶段，也不会生成任何包装、配色、贺卡或赠送话术。"
            : "当前没有任何方案通过独立检查，因此不存在可选项；没有自动替选，也没有第二次自动修订。",
      }),
    ]),
  );

  const actions = [];
  if (selectable.size > 0) {
    actions.push(
      el("button", {
        class: "btn",
        type: "button",
        text: "重新填写需求",
        onclick: () => resetToForm(),
      }),
    );
  } else {
    actions.push(...backToFormActions("修改需求后重新生成"));
  }
  return { body, actions };
}

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

/* ------------------------------------------------------------ 呈现结果页 */

function renderPresentation() {
  const view = state.presentation;
  const body = [];
  const failed = view.status === "presentation_failed";

  body.push(
    el("section", { class: `card ${failed ? "card--fail" : "card--ok"}` }, [
      el("h2", {
        class: "card__title",
        text: failed ? "呈现阶段复核未通过：不伪装为完成" : "你选择的方案：四段呈现已通过复核",
      }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "运行编号" }),
        el("dd", { class: "code", text: view.recommendation_run_id }),
        el("dt", { text: "已选候选" }),
        el("dd", { text: view.selected_candidate_id }),
        el("dt", { text: "生成方式" }),
        el("dd", { text: view.generated_by === "dify" ? "真实 Dify（仍以服务端校验为准）" : "模拟数据" }),
        view.idempotent_replay ? el("dt", { text: "重复提交" }) : null,
        view.idempotent_replay
          ? el("dd", { text: "这是同一选择的重复提交，服务端返回此前同一份结果，没有再次消耗修订额度。" })
          : null,
        el("dt", { text: "全局修订" }),
        el("dd", { text: `已用 ${view.repair_count} / 1，剩余 ${view.remaining_repairs}` }),
        el("dt", { text: "真实业务数据" }),
        el("dd", { text: "not_verified（价格、库存、送达均未核实，本页费用与天数只是估算）" }),
        view.repair_note ? el("dt", { text: "修订说明" }) : null,
        view.repair_note ? el("dd", { text: view.repair_note }) : null,
      ]),
      view.revised_once && view.repaired_checks && view.repaired_checks.length > 0
        ? errorBox(view.repaired_checks, "首次复核发现的问题（已用唯一一次修订）")
        : null,
      failed ? errorBox(view.presentation_check.errors, "复核失败原因") : null,
    ]),
  );

  if (!failed) {
    for (const section of view.sections) {
      body.push(
        el("section", { class: "card" }, [
          el("h2", { class: "card__title", text: section.title }),
          el("ul", { class: "list" }, section.items.map((item) => el("li", { text: item }))),
        ]),
      );
    }
  }

  const s = view.recheck_summary;
  body.push(
    el("section", { class: `card ${s.passed ? "card--ok" : "card--fail"}` }, [
          el("h2", { class: "card__title", text: "选择后复核：只统计这一份礼物" }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "礼物合计" }),
        el("dd", { text: s.gift_estimated_total !== undefined ? `${s.gift_estimated_total} ${s.currency}` : "新版账单字段缺失，未捏造金额" }),
        el("dt", { text: "预算区间" }),
        el("dd", { text: s.budget_range ? `${s.budget_range.min}–${s.budget_range.max} ${s.currency}` : "新版账单字段缺失" }),
        el("dt", { text: "包装等附加项" }),
        el("dd", { text: "只显示风格与色调；未计价，不代表免费" }),
        el("dt", { text: "准备时间" }),
        el("dd", { text: `${s.revised_estimated_preparation_days} 天（可用 ${s.available_days} 天）` }),
        el("dt", { text: "禁忌复核" }),
        el("dd", { text: `类别：${(s.forbidden_tags || []).join("、") || "无"}；字面词：${(s.forbidden_terms || []).join("、") || "无"}` }),
        el("dt", { text: "复核结论" }),
        el("dd", { text: s.passed ? "通过；但价格、库存与送达仍未核实" : "未通过，未作为可执行方案展示" }),
      ]),
    ]),
  );

  const actions = [
    el("button", {
      class: "btn btn--primary",
      type: "button",
      text: "收下这份鼓励",
      onclick: () => backToEncourage(),
    }),
    el("button", {
      class: "btn",
      type: "button",
      text: "返回三方案（可另选，但全局修订额度不再重置）",
      onclick: () => {
        state.presentation = null;
        render();
      },
    }),
    el("button", { class: "btn", type: "button", text: "重新开始", onclick: () => resetToForm() }),
  ];
  return { body, actions };
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

function renderEncourage() {
  const report = state.report;
  const view = state.presentation;
  const request = report ? report.request : null;
  const summary = view ? view.recheck_summary : null;
  const stat = (term, detail) =>
    el("div", { class: "encourage__stat" }, [el("dt", { text: term }), el("dd", { text: detail })]);
  return {
    body: [
      el("section", { class: "card" }, [
        el("p", { class: "encourage__eyebrow", text: "三页走完 · 鼓励页" }),
        el("h2", { class: "encourage__title", text: "心意已经想清楚了。" }),
        el("p", {
          class: "encourage__lead",
          text:
            "你不是不知道送什么，你只是想把这件事做对——这本身就是礼物里最值钱的部分。" +
            "剩下的，只是把它包起来、写下来、递出去。",
        }),
        el("div", { class: "encourage__rule", "aria-hidden": "true" }),
        el("dl", { class: "encourage__stats" }, [
          stat("你为谁准备", request ? `${request.recipient_relation} · ${request.occasion}` : "未记录"),
          stat(
            "你守住的边界",
            request
              ? `礼物预算 ${request.budget_range ? `${request.budget_range.min}–${request.budget_range.max}` : request.budget_amount || "未提供"} ${request.currency}；可用 ${request.available_days} 天（估算，不是送达承诺）`
              : "未记录",
          ),
          stat(
            "你选定的方案",
            view
              ? `${view.selected_candidate_id}；四段呈现已通过复核，礼物合计 ${summary?.gift_estimated_total ?? "未提供"} ${
                  summary ? summary.currency : ""
                }`
              : "未生成呈现",
          ),
        ]),
        el("p", {
          class: "encourage__note",
          text:
            "提醒：价格、库存与送达仍未核实（not_verified）；准备天数不是送达承诺；对方是否喜欢也不会被承诺。" +
            "这次查看不消耗、也不重置全局自动修订额度（两个阶段合计最多 1 次，由服务端持有）。",
        }),
      ]),
    ],
    actions: [
      el("button", { class: "btn btn--primary", type: "button", text: "回到主页", onclick: () => backToHome() }),
      el("button", {
        class: "btn",
        type: "button",
        text: "再看一遍四段呈现",
        onclick: () => {
          state.encourage = false;
          render();
        },
      }),
    ],
  };
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

function resetToForm() {
  state.report = null;
  state.presentation = null;
  state.encourage = false;
  state.error = null;
  state.timeout = false;
  state.step = 1;
  state.inFlow = true;
  render();
}

function buildIntake() {
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
    dislikes: f.dislikes || "",
    hard_exclusions: { tags: [...f.exclusion_tags], terms: [], unresolved: [] },
    additional_context: f.additional_context || "",
  };
  if (f.closeness) intake.closeness = f.closeness;
  return intake;
}

function localMockAnalysis(dislikes) {
  const source = dislikes.trim();
  const candidates = [];
  const known = [
    ["香水", "fragrance", "不喜欢香氛类礼物"],
    ["酒", "alcohol", "不选择酒类礼物"],
    ["巧克力", "chocolate", "不选择巧克力类礼物"],
  ];
  for (const [term, tag, why] of known) {
    if (source.includes(term)) candidates.push({ id: `xc${candidates.length + 1}`, kind: "tag", tag, term: null, source_span: term, confidence: "high", why, evidence: "user_text" });
  }
  return candidates.length
    ? { status: "needs_confirmation", mode: "mock", analysis_id: `mock-${Date.now()}`, candidates, errors: [] }
    : { status: "needs_input", mode: "mock", analysis_id: null, candidates: [], errors: [{ code: "INTAKE_CLARIFICATION_REQUIRED", message: "这段描述暂时无法可靠映射到明确类别，请换一种说法或删去不确定限制。" }] };
}

async function analyzeDislikes(intake) {
  const response = await apiFetch("/api/exclusions/analyze", { intake });
  if (response.ok && response.data) return response.data;
  if (state.config?.mode === "mock" && response.status === 404) return localMockAnalysis(intake.dislikes);
  return response.data || { status: "error", errors: [{ code: "EXCLUSION_ANALYSIS_UNAVAILABLE", message: "暂时无法识别不喜欢的内容，请稍后重试。" }] };
}

async function apiFetch(path, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), state.config ? state.config.client_timeout_ms : 20000);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function submitIntake() {
  const problems = state.step === 1 ? validateStep1() : null;
  if (problems) {
    state.step = 1;
    state.error = { kind: "needs_input", errors: problems };
    render();
    return;
  }
  if (state.step === 2) {
    state.step = 3;
    state.error = null;
    render();
    return;
  }
  const intake = buildIntake();
  if (intake.dislikes && !state.analysis) {
    state.busy = true;
    state.pending = { kind: "analyze" };
    state.error = null;
    render();
    try {
      state.analysis = await analyzeDislikes(intake);
      state.busy = false;
      state.pending = null;
      render();
    } catch (error) {
      state.busy = false;
      state.error = { kind: "error", errors: [{ code: "EXCLUSION_ANALYSIS_UNAVAILABLE", message: "暂时无法识别不喜欢的内容，请稍后重试。" }] };
      render();
    }
    return;
  }
  if (intake.dislikes && (!state.analysis || state.analysis.status !== "needs_confirmation" || state.confirmedIds.length !== state.analysis.candidates.length)) {
    state.error = { kind: "needs_input", errors: [{ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请先逐条确认识别到的限制；没有默认全选。" }] };
    render();
    return;
  }
  state.busy = true;
  state.pending = { kind: "recommend" };
  state.error = null;
  state.timeout = false;
  render();
  try {
    // 先做一次服务端确定性适配，把中文错误在提交前给用户
    const pre = await apiFetch("/api/intake/validate", { intake });
    if (pre.ok && pre.data && pre.data.status !== "ready") {
      state.busy = false;
      state.error = { kind: "needs_input", errors: pre.data.errors };
      render();
      return;
    }
    const payload = { intake, demo: state.demo || null };
    if (intake.dislikes) payload.exclusion_confirmation = { analysis_id: state.analysis.analysis_id, confirmed_ids: [...state.confirmedIds] };
    const response = await apiFetch("/api/recommendations", payload);
    state.busy = false;
    if (!response.data) {
      state.error = { kind: "error", errors: [{ code: "BAD_RESPONSE", message: "服务端返回的内容无法解析，请重试。" }] };
      render();
      return;
    }
    if (!response.ok) {
      state.error = { kind: response.status === 503 ? "infrastructure_error" : "needs_input", errors: response.data.errors || [] };
      render();
      return;
    }
    state.report = response.data;
    state.pending = null;
    state.step = 3;
    render();
  } catch (err) {
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
  state.busy = true;
  state.pending = { kind: "present", candidateId };
  state.error = null;
  render();
  try {
    const response = await apiFetch("/api/presentations", {
      recommendation_run_id: state.report ? state.report.recommendation_run_id : null,
      selected_candidate_id: candidateId,
      demo: state.demo || null,
    });
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
  return `step${state.step}`;
}

function render() {
  renderBadges();
  renderBanners();
  renderSteps();
  renderLandingVisibility();
  const view = $("view");
  let rendered;
  if (!state.config && !(state.error && state.error.kind === "error")) {
    // 接入层配置还没到手：不渲染表单（表单字段全部来自配置，读它会空指针）。
    rendered = renderWaiting();
  } else if (!state.inFlow) {
    rendered = { body: [el("p", { class: "sr-only", text: "点击开始挑选礼物进入三页流程。" })], actions: [] };
  } else if (state.busy && !state.report && !state.presentation) {
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
  } else if (state.step === 1) {
    rendered = renderStep1();
  } else if (state.step === 2) {
    rendered = renderStep2();
  } else {
    rendered = renderStep3();
  }

  const nodes = [].concat(rendered.body).filter(Boolean);
  if (state.error && state.error.kind === "needs_input" && !state.timeout && !state.presentation && !state.report) {
    nodes.unshift(errorBox(state.error.errors, "提交前需要修改（服务端确定性适配）"));
  }
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
    document.body.append(bar);
    return bar;
  })();
  actions.replaceChildren(...[].concat(rendered.actions || []).filter(Boolean));
  restoreFocus(focused);

  $("footer-meta").textContent = state.config
    ? `当前为${state.config.mode === "mock" ? "模拟数据演示" : "模型生成"} · 追求对象场景：${state.config.pursuit_contract_ready ? "已支持" : "暂不可用"} · 价格、库存及送达未核实`
    : "";
}

function selectLast() {
  if (state.pending && state.pending.kind === "present" && state.pending.candidateId) {
    return selectCandidate(state.pending.candidateId);
  }
  return submitIntake();
}

async function bootstrap() {
  // 先绑定入口与读取配置，再渲染：渲染依赖 state.config，
  // 顺序反了会在首帧抛 TypeError 并阻断后面的配置加载。
  for (const id of ["cta-start", "cta-start-2", "cta-start-3"]) {
    const node = $(id);
    if (node) {
      node.addEventListener("click", startFlow);
    }
  }
  render();
  try {
    const response = await fetch("/api/config");
    state.config = await response.json();
    if (LOCAL_UI_FIXTURE && state.config.mode === "mock") {
      state.config = { ...state.config, deadline_options: LOCAL_DEADLINES, fixture_notice: "本地 UI 夹具：未联调新版接入 API" };
    }
  } catch (err) {
    state.error = { kind: "error", errors: [{ code: "CONFIG_UNAVAILABLE", message: "无法读取接入层配置，请确认服务已启动。" }] };
    render();
    return;
  }
  const previousRun = sessionStorage.getItem("gw_last_run");
  if (previousRun) {
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(previousRun)}`);
      if (response.status === 404) {
        state.restoreNotice = "空状态：上一次的任务记录已不存在（接入层为内存实现，服务重启即失效），请重新填写需求。";
      }
    } catch (err) {
      /* 忽略：不影响主流程 */
    }
  }
  render();
}

bootstrap();
