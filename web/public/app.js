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
  busy: false,
  error: null,
  timeout: false,
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
    budget_range: null,
    budget_amount: "",
    budget_confirmed: false,
    deadline_range: null,
    deadline_days: "",
    deadline_confirmed: false,
    interests: [],
    interest_confidence: {},
    interests_unknown: false,
    gift_styles: [],
    styles_unknown: false,
    exclusion_tags: [],
    exclusion_terms: "",
    exclusion_unresolved: "",
    additional_context: "",
  },
};

const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;

const demoOptions = [
  { value: "", label: "关闭（正常路径）" },
  { value: "model_error", label: "错误：模拟模型输出损坏 JSON" },
  { value: "partial_fail", label: "部分通过：一个候选修订修不好" },
  { value: "presentation_over_budget", label: "呈现：首次复核超预算" },
  { value: "stress", label: "压力：超长文案 + emoji + 不可断行长串" },
  { value: "slow", label: "超时：服务端延迟 45 秒" },
];

/* ------------------------------------------------------------------ 渲染 */

function renderBadges() {
  const slot = $("badges");
  slot.replaceChildren();
  if (!state.config) return;
  const mock = state.config.mode === "mock";
  // 吸顶常驻标识：滚动到任何位置、任何窄屏宽度都看得见数据来源
  const flag = $("mode-flag");
  if (flag) {
    flag.hidden = false;
    flag.textContent = mock ? "模拟数据 · 未接真实模型" : "真实 Dify";
    flag.classList.toggle("mode-flag--real", !mock);
    flag.title = mock
      ? "当前候选与呈现内容来自接入层内置模拟数据；Dify 礼赠工作流未发布，这不是模型真实输出。"
      : "当前由服务端调用真实 Dify 工作流；结果仍以服务端独立规则校验为准。";
  }
  const heroFlag = $("hero-flag");
  if (heroFlag) {
    heroFlag.hidden = !mock;
    if (mock) {
      heroFlag.textContent =
        "⚠ 界面预览用的是模拟数据：Dify 礼赠工作流尚未发布，下面三个方案与呈现内容都不是模型真实输出。" +
        "独立规则校验、选择门槛与修订计数是真实实现。";
    }
  }
  slot.append(
    el("span", { class: "badge badge--mock", text: state.config.mode === "mock" ? "模拟数据模式" : "真实 Dify 模式" }),
    el("span", { class: "badge", text: `币种：${state.config.limits.currency}（首版不换汇）` }),
    el("span", { class: "badge", text: `全局自动修订上限：${state.config.limits.global_repair_limit} 次` }),
    el("span", {
      class: `badge ${state.config.pursuit_contract_ready ? "badge--ok" : "badge--err"}`,
      text: state.config.pursuit_contract_ready ? "追求对象契约：已落地（工作区）" : "追求对象契约：未落地",
    }),
    el("span", {
      class: "badge",
      text: `Dify 真实调用：${state.config.dify_configured ? "已配置但未确认发布" : "未配置"}`,
    }),
  );
}

function renderBanners() {
  const slot = $("banner-slot");
  slot.replaceChildren();
  if (!state.config) return;
  const banners = [];
  if (state.config.mode === "mock") {
    banners.push({ class: "banner", text: state.config.notices.mock_mode });
  }
  banners.push({
    class: "banner banner--neutral",
    text:
      "「约 60 秒完成输入」是待测目标，当前没有真实用户测量数据，本项目未宣称已达成。" +
      "本页所有方案与呈现内容均为演示用途，未核实真实价格、库存或送达。",
  });
  banners.push({
    class: state.config.pursuit_contract_ready ? "banner banner--info" : "banner banner--warn",
    text: `关系契约：${state.config.pursuit_notice}`,
  });
  if (state.restoreNotice) banners.push({ class: "banner banner--warn", text: state.restoreNotice });
  for (const item of banners) slot.append(el("div", { class: item.class, text: item.text }));
  // 演示开关随每次重绘一起恢复，避免被 banner-slot 清空后消失
  renderDemoPanel();
}

function renderSteps() {
  const nav = $("steps");
  nav.replaceChildren();
  const inForm = !state.report && !state.presentation && !state.error;
  nav.hidden = !inForm;
  if (!inForm) return;
  const titles = ["第一步 · 关系与硬约束", "第二步 · 兴趣与风格", "第三步 · 排除与补充"];
  titles.forEach((title, index) => {
    const stepNo = index + 1;
    nav.append(
      el("span", {
        class: `step-pill ${stepNo < state.step ? "step-pill--done" : ""}`,
        "aria-current": stepNo === state.step ? "true" : "false",
        text: `${title}${stepNo < state.step ? " ✓" : ""}`,
      }),
    );
  });
}

/** landing 区（hero + 三步说明）只在还没开始填写时出现，避免挤压操作区。 */
function renderLandingVisibility() {
  const inForm = !state.report && !state.presentation && !state.error && !state.busy;
  const atStart = inForm && state.step === 1;
  const hero = $("hero");
  const how = $("how");
  if (hero) hero.hidden = !atStart;
  if (how) how.hidden = !atStart;
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
  const input = el("input", { type: extra.type || "checkbox", checked: selected, "aria-label": label });
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
          "恋人与追求对象是两个独立选项，不会互相替代。追求对象默认低压力表达，不假定对方已接受或存在双向好感。" +
          "本产品界面不提供「同事」场景。",
      }),
      el(
        "div",
        { class: "chips" },
        cfg.labels.relations.map((item) =>
          chip(item.zh, f.recipient_relation === item.id, () => {
            f.recipient_relation = item.id;
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
            f.occasion = item.id;
            render();
          }, { class: "chip--radio", type: "radio" }),
        ),
      ),
    ]),
  );

  const rangeMax = (() => {
    const range = cfg.ranges.budget.find((r) => r.id === f.budget_range);
    return range && range.max ? range.max : null;
  })();

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "预算（人民币 CNY）" }),
      el("p", {
        class: "field__hint",
        text: "区间只是输入快捷方式；最终以你确认的明确上限提交，系统不会替你补默认值。含礼物、包装、贺卡、装饰和配送的估算总费用。",
      }),
      el(
        "div",
        { class: "chips" },
        cfg.ranges.budget.map((range) =>
          chip(range.label, f.budget_range === range.id, () => {
            f.budget_range = range.id;
            f.budget_confirmed = false;
            render();
          }, { class: "chip--radio", type: "radio" }),
        ),
      ),
      f.budget_range
        ? el("div", {}, [
            el("div", { class: "suggest-row" }, [
              rangeMax
                ? el("button", {
                    class: "suggest",
                    type: "button",
                    text: `按此区间的上限填写：${rangeMax} 元`,
                    onclick: () => {
                      f.budget_amount = `${rangeMax}.00`;
                      f.budget_confirmed = false;
                      render();
                    },
                  })
                : el("span", { class: "field__hint", text: "该区间没有固定上限，请直接填写你确认的金额。" }),
            ]),
            el("p", { class: "field__hint", text: "最终确认的全量预算上限（单位：元，最多两位小数）" }),
            el("input", {
              type: "text",
              inputmode: "decimal",
              placeholder: "例如 200.00",
              value: f.budget_amount,
              "aria-label": "预算上限金额",
              "data-field": "budget_amount",
              oninput: (event) => {
                f.budget_amount = event.target.value.trim();
                f.budget_confirmed = false;
                render();
              },
            }),
            el("label", { class: "confirm-row" }, [
              el("input", {
                type: "checkbox",
                checked: f.budget_confirmed,
                onchange: (event) => {
                  f.budget_confirmed = event.target.checked;
                  render();
                },
              }),
              el("span", {
                text:
                  AMOUNT_RE.test(f.budget_amount)
                    ? `我确认「${f.budget_amount} 元」就是本次礼物＋包装＋贺卡＋装饰＋配送的全量上限（不再改由模型决定）。`
                    : "请先填写合法的金额（有限、非负、最多两位小数），再勾选确认。",
              }),
            ]),
          ])
        : el("p", { class: "field__error", text: "请先选择一个预算区间，再确认明确上限。" }),
    ]),
  );

  const daysSuggest = (() => {
    const map = { d0: [0, 1], d1: [3, 5, 7], d2: [7, 10, 14], d3: [] };
    return map[f.deadline_range] || [];
  })();

  body.push(
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "准备时间" }),
      el("p", {
        class: "field__hint",
        text: "时间是可用准备天数，不是送达承诺，按 Asia/Shanghai 计算。0 天表示当天可用。区间只是快捷入口，最终以你确认的天数提交。",
      }),
      el(
        "div",
        { class: "chips" },
        cfg.ranges.deadline.map((range) =>
          chip(`${range.label}（${range.hint}）`, f.deadline_range === range.id, () => {
            f.deadline_range = range.id;
            f.deadline_confirmed = false;
            render();
          }, { class: "chip--radio", type: "radio" }),
        ),
      ),
      f.deadline_range
        ? el("div", {}, [
            daysSuggest.length > 0
              ? el(
                  "div",
                  { class: "suggest-row" },
                  daysSuggest.map((day) =>
                    el("button", {
                      class: "suggest",
                      type: "button",
                      text: `使用 ${day} 天`,
                      onclick: () => {
                        f.deadline_days = String(day);
                        f.deadline_confirmed = false;
                        render();
                      },
                    }),
                  ),
                )
              : null,
            el("p", { class: "field__hint", text: "最终确认的可用准备天数（整数，0 允许）" }),
            el("input", {
              type: "number",
              min: "0",
              step: "1",
              inputmode: "numeric",
              placeholder: "例如 2",
              value: f.deadline_days,
              "aria-label": "可用准备天数",
              "data-field": "deadline_days",
              oninput: (event) => {
                f.deadline_days = event.target.value.trim();
                f.deadline_confirmed = false;
                render();
              },
            }),
            el("label", { class: "confirm-row" }, [
              el("input", {
                type: "checkbox",
                checked: f.deadline_confirmed,
                onchange: (event) => {
                  f.deadline_confirmed = event.target.checked;
                  render();
                },
              }),
              el("span", {
                text:
                  /^[0-9]+$/.test(f.deadline_days)
                    ? `我确认可用的完整准备时间是 ${f.deadline_days} 天（礼物＋包装＋贺卡＋配送合计），不是模糊期限。`
                    : "请先填写 0 或正整数天数，再勾选确认。",
              }),
            ]),
          ])
        : el("p", { class: "field__error", text: "请先选择一个时间区间，再确认最终天数。" }),
    ]),
  );

  return {
    body,
    actions: [
      el("button", {
        class: "btn btn--primary",
        type: "button",
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

function validateStep1() {
  const f = state.form;
  const problems = [];
  if (!f.recipient_relation) problems.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请选择送礼对象的关系。" });
  if (!f.occasion) problems.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请选择送礼场合。" });
  if (!f.budget_range) problems.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请选择预算区间。" });
  if (!AMOUNT_RE.test(f.budget_amount)) {
    problems.push({ code: "INVALID_AMOUNT", message: "预算上限必须是有限、非负、最多两位小数的金额（如 200.00）。" });
  }
  if (!f.budget_confirmed) problems.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请勾选确认预算上限就是全量上限。" });
  if (!f.deadline_range) problems.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请选择时间区间。" });
  if (!/^[0-9]+$/.test(f.deadline_days)) {
    problems.push({ code: "INVALID_TYPE", message: "可用准备天数必须是非负整数（0 表示当天）。" });
  }
  if (!f.deadline_confirmed) problems.push({ code: "INTAKE_CLARIFICATION_REQUIRED", message: "请勾选确认最终可用天数。" });
  return problems.length > 0 ? problems : null;
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
            }, { disabled: f.interests_unknown }),
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
            }, { disabled: f.styles_unknown }),
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
        text: "返回第一步",
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
        text: "下一步：排除与补充",
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

function parseTerms(raw) {
  return [...new Set(raw.split(/[、,，;；\s]+/).map((t) => t.trim()).filter((t) => t !== ""))];
}

function renderStep3() {
  const f = state.form;
  const cfg = state.config;
  const terms = parseTerms(f.exclusion_terms);
  const unresolved = parseTerms(f.exclusion_unresolved);

  const body = [
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "不喜欢或不适合的类型（硬约束）" }),
      el("p", { class: "field__hint", text: "按固定类别选择；这些类别会被独立代码检查，模型不能绕过。" }),
      el(
        "div",
        { class: "chips" },
        cfg.labels.exclusions.map((item) =>
          chip(item.zh, f.exclusion_tags.includes(item.id), (checked) => {
            if (checked && !f.exclusion_tags.includes(item.id)) f.exclusion_tags.push(item.id);
            if (!checked) f.exclusion_tags = f.exclusion_tags.filter((x) => x !== item.id);
            render();
          }),
        ),
      ),
      el("p", {
        class: "field__hint",
        text: "「其他类别」只拦截被标注为该类别的候选，不代表覆盖所有未知禁忌。",
      }),
    ]),
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "明确禁忌的字面词" }),
      el("p", {
        class: "field__hint",
        text: "填你确认要按字面拦截的词（例如：酒）。原文会被保留，类别与字面词分别保存、互不推断。",
      }),
      el("input", {
        type: "text",
        placeholder: "例如：酒、香水（用顿号或逗号分隔）",
        value: f.exclusion_terms,
        "aria-label": "明确禁忌的字面词",
        "data-field": "exclusion_terms",
        oninput: (event) => {
          f.exclusion_terms = event.target.value;
          render();
        },
      }),
      terms.length > 0 ? el("p", { class: "field__hint", text: `将按字面拦截：${terms.join("、")}` }) : null,
    ]),
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "还不能确定怎么表达的禁忌（可选）" }),
      el("p", {
        class: "field__hint",
        text: "无法可靠转成类别或字面词的硬约束不要静默忽略：填在这里，提交时会被要求先澄清，不会自动当成已覆盖。",
      }),
      el("input", {
        type: "text",
        placeholder: "例如：不要看起来像在暗示关系（需先确认如何拦截）",
        value: f.exclusion_unresolved,
        "aria-label": "待澄清的禁忌",
        "data-field": "exclusion_unresolved",
        oninput: (event) => {
          f.exclusion_unresolved = event.target.value;
          render();
        },
      }),
      unresolved.length > 0
        ? el("p", { class: "field__error", text: `这 ${unresolved.length} 项会被服务端要求先澄清（INTAKE_CLARIFICATION_REQUIRED），不会静默忽略。` })
        : null,
    ]),
    el("section", { class: "card" }, [
      el("h2", { class: "card__title", text: "补充说明（可选，可不填）" }),
      el("p", { class: "field__hint", text: "这里的内容视为数据，不会被当成指令执行，也不能覆盖上面任何硬约束。" }),
      el("textarea", {
        placeholder: "例如：完全虚构的演示请求；希望表达祝福，不造成关系压力。",
        "aria-label": "补充说明",
        "data-field": "additional_context",
        oninput: (event) => {
          f.additional_context = event.target.value;
        },
      }, [document.createTextNode(f.additional_context)]),
    ]),
  ];

  return {
    body,
    actions: [
      el("button", {
        class: "btn btn--ghost",
        type: "button",
        text: "返回第二步",
        onclick: () => {
          state.step = 2;
          state.error = null;
          render();
        },
      }),
      el("button", {
        class: "btn btn--primary",
        type: "button",
        text: state.busy ? "正在提交…" : "生成三个方案",
        disabled: state.busy,
        onclick: () => submitIntake(),
      }),
    ],
  };
}

/* ------------------------------------------------------------- 状态页 */

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
        el("h2", { class: "state__title" }, [el("span", { class: "spinner", "aria-hidden": "true" }), "正在生成三个不同思路…"]),
        el("p", { text: "服务端正在做确定性适配 → 生成三候选 → 独立规则校验；如有可修订项，最多自动修订一次并重新校验。" }),
        el("p", { class: "field__hint", text: "请不要重复点击；推荐阶段不会生成任何包装、贺卡或赠送话术。" }),
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
        el("dd", { text: `${report.request.budget_amount} ${report.request.currency} · ${report.request.available_days} 天（仅估算，不是送达承诺）` }),
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
          el("dt", { text: "全量估算费用" }),
          el("dd", { text: `${candidate.estimated_total} ${candidate.currency}（含包装、贺卡与配送估算）` }),
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
      el("h2", { class: "card__title", text: "选择后复核：礼物＋包装＋贺卡＋装饰＋配送" }),
      el("dl", { class: "kv" }, [
        el("dt", { text: "原估算" }),
        el("dd", { text: `${s.original_total} ${s.currency}` }),
        el("dt", { text: "新增费用" }),
        el("dd", { text: `${s.additional_cost} ${s.currency}` }),
        el("dt", { text: "全量总费用" }),
        el("dd", { text: `${s.revised_estimated_total} ${s.currency}（上限 ${s.budget_amount} ${s.currency}）` }),
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

/* --------------------------------------------------------------- 流程 */

function resetToForm() {
  state.report = null;
  state.presentation = null;
  state.error = null;
  state.timeout = false;
  state.step = 1;
  render();
}

function buildIntake() {
  const f = state.form;
  const intake = {
    recipient_relation: f.recipient_relation,
    occasion: f.occasion,
    budget_amount: f.budget_amount,
    currency: "CNY",
    deadline_days: Number(f.deadline_days),
    interests: f.interests_unknown ? [] : [...f.interests],
    interest_confidence: f.interests_unknown ? {} : { ...f.interest_confidence },
    gift_styles: f.styles_unknown ? [] : [...f.gift_styles],
    hard_exclusions: {
      tags: [...f.exclusion_tags],
      terms: parseTerms(f.exclusion_terms),
      unresolved: parseTerms(f.exclusion_unresolved),
    },
    additional_context: f.additional_context || "",
  };
  if (f.closeness) intake.closeness = f.closeness;
  return intake;
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
  const problems = validateStep1();
  if (problems) {
    state.step = 1;
    state.error = { kind: "needs_input", errors: problems };
    render();
    return;
  }
  const intake = buildIntake();
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
    const response = await apiFetch("/api/recommendations", { intake, demo: state.demo || null });
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
  } else if (state.busy && !state.report && !state.presentation) {
    rendered = renderGenerating();
  } else if (state.timeout) {
    rendered = stateView(
      "超时：没有在设定时间内拿到结果",
      [
        state.error && state.error.errors[0] ? state.error.errors[0].message : "请求超时。",
        "超时不会被当作成功，也没有生成任何方案或呈现内容。",
      ],
      [
        el("button", { class: "btn btn--primary", type: "button", text: "重试上一次动作", onclick: () => selectLast() }),
        el("button", { class: "btn", type: "button", text: "回到表单", onclick: () => resetToForm() }),
      ],
      state.error ? [errorBox(state.error.errors, "错误码")] : [],
    );
  } else if (state.error && state.error.kind === "error") {
    rendered = stateView(
      "错误：这次请求没有成功",
      ["服务端返回错误，未把任何内容标记为通过。请稍后重试或检查接入层是否已启动。"],
      [
        el("button", { class: "btn btn--primary", type: "button", text: "重试上一次动作", onclick: () => selectLast() }),
        el("button", { class: "btn", type: "button", text: "回到表单", onclick: () => resetToForm() }),
      ],
      [errorBox(state.error.errors, "错误详情")],
    );
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

  const actions = $("actions") || (() => {
    const bar = el("div", { class: "actions", id: "actions" });
    document.body.append(bar);
    return bar;
  })();
  actions.replaceChildren(...[].concat(rendered.actions || []).filter(Boolean));
  restoreFocus(focused);

  $("footer-meta").textContent = state.config
    ? `模式：${state.config.mode} · 追求对象契约：${state.config.pursuit_contract_ready ? "已落地" : "未落地"} · 演示开关：${state.demo || "关闭"} · 接入层 http://${location.host}`
    : "";
}

function selectLast() {
  if (state.pending && state.pending.kind === "present" && state.pending.candidateId) {
    return selectCandidate(state.pending.candidateId);
  }
  return submitIntake();
}

function renderDemoPanel() {
  const slot = $("banner-slot");
  const details = el("details", { class: "banner banner--info" }, [
    el("summary", { text: `演示开关（仅用于验证失败与超时路径，当前：${state.demo || "关闭"}）` }),
    el(
      "div",
      { class: "chips", style: "margin-top:8px" },
      demoOptions.map((option) =>
        chip(option.label, state.demo === option.value, () => {
          state.demo = option.value;
          render();
        }, { class: "chip--radio", type: "radio" }),
      ),
    ),
    el("p", {
      class: "field__hint",
      text: "也可以在地址栏加 ?demo=slow / ?demo=model_error / ?demo=partial_fail / ?demo=presentation_over_budget / ?demo=stress。",
    }),
  ]);
  slot.append(details);
}

async function bootstrap() {
  // 先绑定入口与读取配置，再渲染：渲染依赖 state.config，
  // 顺序反了会在首帧抛 TypeError 并阻断后面的配置加载。
  for (const id of ["cta-start", "cta-start-2"]) {
    const node = $(id);
    if (node) {
      node.addEventListener("click", () => {
        state.step = 1;
        state.error = null;
        render();
        $("view").scrollIntoView({ block: "start" });
        $("view").focus({ preventScroll: true });
      });
    }
  }
  render();
  try {
    const response = await fetch("/api/config");
    state.config = await response.json();
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
