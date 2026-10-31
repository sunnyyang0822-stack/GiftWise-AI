/**
 * GiftWise AI · 第 1 步「自然语言 ⇒ 现有 intake 字段」的纯函数层。
 *
 * 职责边界：
 *   · 本文件**不发起任何请求**、不读全局状态、不含任何兜底假数据；
 *   · 只做两件事：① 把 `POST /api/intake/parse` 的响应落到对话表单的**现有**字段上；
 *     ② 生成给用户看的文案（用户输入的原值回显 / 覆盖提示 / 原文 / 必答追问）。
 *   · 字段清单与契约一个字都不改：本文件只写 `state.form` 里已有的键，
 *     外加两个**前端内部**记账键（budget_amount / budget_phrase / city_answer），
 *     它们要么映射到已有契约字段（budget_amount、additional_context），要么不下发。
 *   · 产品裁定（后端报告 `docs/architecture/第一步接入大模型解析-2026-10-31.md` §2.1）：
 *     金额显示 `echo.budget_amount`、时间显示 `echo.deadline_days`；⛔ 界面不显示 `0–×××` 区间，
 *     区间只留在数据层（`parse.constraints.*_band`）。
 */

/** 只在「覆盖提示」里出现的中文字段名。不是契约、不下发，纯粹给人看。 */
export const FIELD_ZH = {
  recipient_relation: "送礼对象",
  recipient_relation_custom: "自定义关系",
  closeness: "熟悉程度",
  occasion: "送礼场合",
  occasion_custom: "自定义场合",
  budget_amount: "预算金额",
  budget_mode: "预算方式",
  budget_range: "预算区间",
  deadline_days: "准备时间",
  interests: "喜好",
  interest_confidence: "确定程度",
  gift_styles: "礼物感觉",
  dislikes: "需要避开的",
  previous_gifts: "以前送过",
  hard_exclusions: "需要避开的",
  additional_context: "补充说明",
};

const FALLBACK_TIMEOUT_MS = 60000;

/** 客户端超时取服务端自报的 intake_parse.client_timeout_ms，缺省 60 秒。 */
export function parseTimeoutMs(config) {
  const value = Number(config?.intake_parse?.client_timeout_ms);
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_TIMEOUT_MS;
}

/** 解析是否可用（能力由 /api/config 自报；不猜、不硬编码）。 */
export function parseEnabled(config) {
  return config?.intake_parse?.enabled !== false;
}

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

export const echoBudgetAmount = (parse) => text(parse?.echo?.budget_amount);
export const echoBudgetPhrase = (parse) => text(parse?.echo?.budget_phrase);
export const echoDeadlinePhrase = (parse) => text(parse?.echo?.deadline_phrase);

/** 用户输入的原值（天数）。只有整数才算，其它一律不采信。 */
export function echoDeadlineDays(parse) {
  const value = parse?.echo?.deadline_days;
  return Number.isInteger(value) ? value : null;
}

/** 用户原话（逐字保留，后端已限长；这里只过滤空串）。 */
export function literalPreferences(parse) {
  const list = Array.isArray(parse?.literal_preferences) ? parse.literal_preferences : [];
  return list.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
}

/** `required: true` 的必答追问（city / deadline_confirm / exclusion_analysis）。 */
export function requiredFollowups(parse) {
  const list = Array.isArray(parse?.required_followups) ? parse.required_followups : [];
  return list.filter((item) => item && item.required === true && typeof item.id === "string");
}

/** 相对时间被代码级交叉校验判为不可信（例：「下个月」被算成 1 天）。 */
export function deadlineUnconfirmed(parse) {
  const check = parse?.deadline_check;
  return Boolean(check && check.ok === false);
}

const amountText = (value) => (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? value : null);

/** 把契约里的值翻成给人看的中文片段（仅用于覆盖提示与回显）。 */
export function valueZh(field, value) {
  if (value === null || value === undefined) return "（空）";
  if (field === "budget_range" && typeof value === "object" && value !== null) {
    const min = amountText(value.min);
    const max = amountText(value.max);
    return min !== null && max !== null ? `¥${min} – ¥${max}` : JSON.stringify(value);
  }
  if (field === "budget_amount") {
    const amount = amountText(value);
    return amount !== null ? `¥${amount}` : String(value);
  }
  if (field === "deadline_days") {
    const days = Number(value);
    return Number.isInteger(days) ? `${days} 天` : String(value);
  }
  if (Array.isArray(value)) return value.length ? value.join("、") : "（空）";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * 覆盖提示的行（“你填的选项已被你的原话覆盖”）。
 * 预算相关的若干条（budget_mode / budget_range / budget_amount）合并成一行，并且
 * **只显示用户输入的原值**：契约区间（值−50…值）是服务端约束用的，⛔ 不拿到界面上来。
 */
/** 表单里原本就没有值：这种情况不算“被覆盖”，不提示。 */
const isBlank = value => value === null || value === undefined || (typeof value === "string" && !value.trim())
  || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
/** 枚举字段对应的配置标签表（用于把机器值换成中文；不在浏览器重建业务映射）。 */
const LABEL_LISTS = { recipient_relation: "relations", closeness: "closeness", occasion: "occasions", interests: "interests", gift_styles: "gift_styles" };
const labelZh = (labels, field, value) => {
  const list = labels?.[LABEL_LISTS[field]];
  if (!Array.isArray(list)) return null;
  const one = id => list.find(x => x.id === id)?.zh || id;
  return Array.isArray(value) ? (value.length ? value.map(one).join("、") : null) : typeof value === "string" ? one(value) : null;
};

export function overriddenRows(parse, labels = null) {
  const list = Array.isArray(parse?.overridden_from_form) ? parse.overridden_from_form : [];
  const amount = echoBudgetAmount(parse);
  const rows = [];
  const seen = new Set();
  for (const row of list) {
    if (!row || typeof row.field !== "string") continue;
    const isBudget = row.field === "budget_range" || row.field === "budget_amount" || row.field === "budget_mode";
    if (row.field === "budget_mode" || row.field === "interest_confidence") continue;
    // 只有用户之前真的选过/填过，才叫“被你的原话覆盖”。
    if (isBlank(row.from_form)) continue;
    const label = isBudget ? "预算" : FIELD_ZH[row.field] || row.field;
    if (seen.has(label)) continue;
    seen.add(label);
    const fromRaw = row.from_form && typeof row.from_form === "object" ? row.from_form.max ?? row.from_form.min : row.from_form;
    rows.push({
      field: row.field,
      label,
      from: isBudget ? valueZh("budget_amount", fromRaw) : labelZh(labels, row.field, row.from_form) ?? valueZh(row.field, row.from_form),
      to: isBudget && amount !== null ? `¥${amount}` : labelZh(labels, row.field, row.to_text) ?? valueZh(row.field, row.to_text),
      rule: typeof row.rule === "string" ? row.rule : "",
    });
  }
  return rows;
}

/** 配置里的六档天数（兼容 days / value / available_days；不在浏览器重建业务映射）。 */
export function deadlineDayOptions(config) {
  const list = config?.ranges?.deadline;
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => (Number.isInteger(row?.days) ? row.days : Number.isInteger(row?.value) ? row.value : Number.isInteger(row?.available_days) ? row.available_days : null))
    .filter((days) => days !== null && days >= 0 && days <= 365);
}

/** 把天数贴到最近的可用档位（追问确认时给用户一个能点的真实选项，不编造档位）。 */
export function nearestDeadlineOption(days, options) {
  if (!Array.isArray(options) || options.length === 0) return null;
  if (!Number.isFinite(days)) return null;
  return [...options].sort((a, b) => Math.abs(a - days) - Math.abs(b - days) || a - b)[0];
}

/**
 * 金额展示：**用户输入的原值优先**。
 *   · 在正文里说了确定金额 ⇒ 显示 `¥800`（`echo.budget_amount`），⛔ 不显示 ±50 区间；
 *   · 在正文里说了明确区间 ⇒ 显示用户自己那个区间（`800 – 1000`），这仍然是用户原值，不是服务端带宽；
 *   · 没解析过 ⇒ 沿用滑条自己的取值（用户自己拖出来的区间）。
 */
export function budgetDisplayText(form, parse) {
  const mode = form?.budget_mode;
  const amount = echoBudgetAmount(parse);
  if (amount === null || !form?.budget_amount) {
    if (mode === "zero") return "不花钱的心意";
    // ⛔ 铁律：界面不显示区间。other 模式下 min/max 是**服务端契约带宽**（值−50…值），
    // 下界不许见人，宁可只显示用户自己给的那个金额（上界）。
    if (mode === "other") return `¥${form?.budget_max}`;
    return `¥${form?.budget_min} – ¥${form?.budget_max}`;
  }
  if (mode === "zero" || amountText(amount) === "0") return "不花钱的心意";
  const isRange = parse?.budget_check?.kind === "amount_range";
  const base = isRange ? `¥${form.budget_min} – ¥${form.budget_max}` : `¥${amount}`;
  const phrase = echoBudgetPhrase(parse);
  return phrase ? `${base}（按你的原话：${phrase}）` : base;
}

const DAY_ZH = { 0: "当天", 1: "一天", 5: "3–5天", 7: "一周", 30: "一月", 90: "一季度", 365: "一年" };

/** 准备时间展示：原值优先（`echo.deadline_days`），并带上用户原话片段。 */
export function deadlineDisplayText(form, parse) {
  const raw = form?.deadline_days;
  // 未作答时 deadline_days 是空串；Number("") === 0 会伪造出「当天（0 天）」，必须先挡住。
  if (raw === "" || raw === null || raw === undefined) return "";
  const days = echoDeadlineDays(parse);
  const active = days !== null && String(raw) === String(days) ? days : Number(raw);
  if (!Number.isInteger(active)) return "";
  const base = DAY_ZH[active] ? `${DAY_ZH[active]}（${active} 天）` : `${active} 天`;
  const phrase = echoDeadlinePhrase(parse);
  return days !== null && phrase ? `${base}（按你的原话：${phrase}）` : base;
}

const zhOf = (list, id) => (Array.isArray(list) ? list.find((item) => item.id === id)?.zh || id : id);
const hasId = (list, id) => Array.isArray(list) && list.some((item) => item.id === id);

/**
 * 把解析出来的 intake 落到对话表单的**现有**字段上。
 * 只写「解析确实提到了」的字段；文本没提到的字段原样保留（与后端 mergeIntake 同口径）。
 *
 * @returns {{qids: string[], notes: string[], dropped: string[]}}
 *   qids   —— 因此可以跳过的问题 ID（调用方据此推进对话）
 *   notes  —— 如实说明做了什么的短句，直接展示给用户
 *   dropped—— 后端给了、但前端按契约无法落地的项（如实列出，不静默吞掉）
 */
export function applyParsedToForm({ form, config, result }) {
  const intake = result?.intake;
  const parse = result?.parse;
  const notes = [];
  const dropped = [];
  const qids = new Set();
  if (!intake || typeof intake !== "object") return { qids: [], notes: ["解析没有返回可用的 intake，继续用你原来的填写。"], dropped };

  const labels = config?.labels || {};

  /* ---------- 关系 / 场合 / 熟悉程度 ---------- */
  if (typeof intake.recipient_relation === "string" && hasId(labels.relations, intake.recipient_relation)) {
    form.recipient_relation = intake.recipient_relation;
    if (intake.recipient_relation === "other") {
      form.recipient_relation_other = String(intake.recipient_relation_custom || "").slice(0, 1000);
      if (form.recipient_relation_other) qids.add("relation_other");
      qids.add("relation");
    } else {
      form.recipient_relation_other = "";
      qids.add("relation");
    }
    notes.push(`送礼对象：${zhOf(labels.relations, form.recipient_relation)}`);
  }
  if (typeof intake.occasion === "string" && hasId(labels.occasions, intake.occasion)) {
    form.occasion = intake.occasion;
    if (intake.occasion === "other") {
      form.occasion_other = String(intake.occasion_custom || "").slice(0, 1000);
      if (form.occasion_other) qids.add("occasion_other");
      qids.add("occasion");
    } else {
      form.occasion_other = "";
      qids.add("occasion");
    }
    notes.push(`送礼场合：${zhOf(labels.occasions, form.occasion)}`);
  }
  if (typeof intake.closeness === "string" && hasId(labels.closeness, intake.closeness)) {
    form.closeness = intake.closeness;
    qids.add("closeness");
  }

  /* ---------- 预算：原值 + 契约区间（max 必须等于 budget_amount） ---------- */
  const amount = echoBudgetAmount(parse);
  const range = intake.budget_range;
  if (amount !== null && range && typeof range === "object" && amountText(range.min) !== null && amountText(range.max) !== null) {
    const mode = ["slider", "zero", "other"].includes(intake.budget_mode) ? intake.budget_mode : "other";
    form.budget_mode = mode;
    form.budget_min = range.min;
    form.budget_max = range.max;
    form.budget_amount = amount;
    form.budget_phrase = echoBudgetPhrase(parse) || "";
    qids.add("budget");
    notes.push(`预算按你说的原值：${mode === "zero" ? "不花钱的心意" : `¥${amount}`}`);
  } else if (amount !== null) {
    dropped.push("budget_amount（后端没给出与之匹配的契约区间，为避免预算上下限不自洽，未写回表单）");
  }

  /* ---------- 用户主动提到的时间只作参考；未知不补值、不强制选档 ---------- */
  const days = echoDeadlineDays(parse);
  if (days !== null && days >= 0 && days <= 365 && !deadlineUnconfirmed(parse)) {
    form.deadline_days = String(days);
    qids.add("deadline");
    notes.push(`时间参考：${days} 天`);
  } else if (echoDeadlinePhrase(parse) || days !== null) {
    form.deadline_days = "";
    qids.add("deadline");
  }

  /* ---------- 喜好 / 风格：只落配置里真实存在的 ID ---------- */
  const interestIds = Array.isArray(intake.interests) ? intake.interests.filter((id) => hasId(labels.interests, id)) : [];
  if (interestIds.length > 0) {
    const unknownIds = (intake.interests || []).filter((id) => !hasId(labels.interests, id));
    if (unknownIds.length) dropped.push(`interests=${unknownIds.join("、")}（不在当前选项表里）`);
    form.interests_unknown = false;
    form.interests = [...interestIds];
    const conf = intake.interest_confidence && typeof intake.interest_confidence === "object" ? intake.interest_confidence : {};
    form.interest_confidence = Object.fromEntries(interestIds.map((id) => [id, conf[id] === "confirmed" ? "confirmed" : "inferred"]));
    qids.add("interests");
    qids.add("confidence");
  }
  /* 用户只说了选项之外的喜好（例：「喜欢某幻君」）：原话就是答案（用户输入为准），这题视为已答；
     原话由解析结果的 literal_preferences 保留并展示，ID 留空，不拿最接近的类目去替换它。 */
  if (interestIds.length === 0 && literalPreferences(parse).length > 0) {
    form.interests_unknown = false;
    form.interests = [];
    form.interest_confidence = {};
    qids.add("interests");
  }
  const styleIds = Array.isArray(intake.gift_styles) ? intake.gift_styles.filter((id) => hasId(labels.gift_styles, id)) : [];
  if (styleIds.length > 0) {
    form.styles_unknown = false;
    form.gift_styles = [...styleIds];
    qids.add("styles");
  }

  /* ---------- 禁忌字面词：映射到**已有**字段 hard_exclusions.terms ---------- */
  const terms = Array.isArray(intake.hard_exclusions?.terms)
    ? intake.hard_exclusions.terms.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
  if (terms.length > 0) {
    form.exclusion_terms = [...new Set([...(form.exclusion_terms || []), ...terms])];
    notes.push(`要按字面避开的：${form.exclusion_terms.join("、")}`);
  }
  /* 用户原话里关于“要避开什么”的那句：写进既有字段 dislikes（之后仍走既有的逐条确认流程）。 */
  if (typeof intake.dislikes === "string" && intake.dislikes.trim()) {
    form.dislikes = intake.dislikes.slice(0, 1000);
    qids.add("avoid");
  }
  /* 以前送过：写进既有字段 previous_gifts（独立选填，不拼入 dislikes）。 */
  if (typeof intake.previous_gifts === "string" && intake.previous_gifts.trim()) {
    form.previous_gifts = intake.previous_gifts.slice(0, 1000);
    qids.add("previous");
  }

  /* ---------- 原话与城市：落到**现有**字段 additional_context ---------- */
  /* 服务端拼进 additional_context 的内容（例：「用户原话（硬约束…）：…」）是给推荐看的约束说明，
     不是用户写的补充 ⇒ 存进内部键 parsed_context，提交时再与用户自己的补充合并；
     ⛔ 不写进用户可见、可编辑的「补充」输入框。 */
  if (typeof intake.additional_context === "string" && intake.additional_context.trim()) {
    const own = String(form.additional_context || "").trim();
    let parsed = intake.additional_context.trim();
    if (own && parsed.startsWith(own)) parsed = parsed.slice(own.length).trim();
    form.parsed_context = parsed.slice(0, 1000);
  }

  return { qids: [...qids], notes, dropped };
}

/** 把「解析结果 + 用户后来改动」合成最终下发的 additional_context（含城市，仍是既有字段）。 */
export function composeAdditionalContext({ base, parsed, city }) {
  const parts = [];
  if (typeof base === "string" && base.trim()) parts.push(base.trim());
  if (typeof parsed === "string" && parsed.trim() && !parts.join("\n").includes(parsed.trim())) parts.push(parsed.trim());
  const clean = typeof city === "string" ? city.trim() : "";
  if (clean && !parts.join("\n").includes(`所在城市：${clean}`)) parts.push(`所在城市：${clean}`);
  const merged = parts.join("\n");
  return [...merged].length > 1000 ? [...merged].slice(0, 999).join("") + "…" : merged;
}
