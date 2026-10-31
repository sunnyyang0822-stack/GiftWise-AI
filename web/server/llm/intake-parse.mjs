/**
 * 第 1 步 · 自然语言 ⇒ **现有 intake 字段**（唯一职责）。
 *
 * 产品负责人 2026-10-31 定调：「你不需要完全自由的与用户沟通，保持我们现有的固定字段，
 * 接入是为了读取用户的输入需求以进行之后的返回。」因此本模块：
 *
 *   - **字段清单与取值范围由代码固定**（`INTAKE_FIELDS`：web/server/intake.mjs，
 *     标签枚举：web/server/labels.mjs）。模型只能"把用户的话对应到这些字段上"，
 *     清单外的键、枚举外的值、超范围的数量**一律丢弃并如实记账**（`parse.dropped`）；
 *   - **不做多轮自由对话**：一次调用、一个严格 JSON、没有会话状态；
 *   - **用户没提到的字段不填**：模型输出里"没出现的键"＝用户没提到 ⇒ 保持表单原值或空/默认，
 *     绝不用"常见值"补齐；
 *   - **推断必须如实标记**：兴趣用契约里已有的 `interest_confidence: "inferred"`；
 *     契约里没有推断标记的字段，用一个**不进入 intake 对象**的 `parse.inferred_fields`
 *     如实登记（最小改动，不改字段清单）；
 *   - **失败一律回落**：解析失败/超时/输出非法 ⇒ 用用户原样提交的表单字段继续跑，
 *     并把降级原因写进响应与账本（账本由 provider 的 `kind: "intake_parse"` 记录）；
 *   - **不成为后门**：产出仍旧是普通 intake 对象，必须再过 `adaptIntakeObject()`
 *     与 `checker.mjs` 的同一套硬校验；模型输出不能绕过任何规则。
 *
 * 四条产品裁定的落地位置（逐条）：
 *   1. 「同时输入文本又选了选项 ⇒ 以用户输入为主」→ 模型**只看到用户原话**（根本看不到
 *      表单选项），合并顺序固定为「文本 > 表单」，冲突写进 `parse.overridden_from_form`；
 *   2. 「确定金额/时间 ⇒ 展示用户输入的那个值」→ `parse.echo` 原样回显用户数值与说法片段；
 *      「价格约束 ±50 / 天数约束 ±1 天」→ `parse.constraints` 的 budget_band / days_band，
 *      并由 pipeline.mjs 用同一份常量做候选侧 gate；
 *   3. 「喜好填了文本 ⇒ 直接抓原文，不与预设选项匹配」→ `literal_preferences` 原样保留，
 *      写进 `additional_context` 并作为硬约束随推荐请求发给模型；
 *   4. 「体验类 ⇒ 必须问城市 / 考虑地域价格」→ `experiential_mentioned` + `city` +
 *      `required_followups`（缺城市时必答）+ `region_price` 口径。
 */

import { createHash } from "node:crypto";

import { RELATIONS_FULL, CLOSENESS_TABLE, OCCASION_TABLE, INTEREST_TABLE, GIFT_STYLE_TABLE, EXCLUSION_TABLE, PRODUCT_RELATIONS } from "../labels.mjs";
import { INTAKE_FIELDS, adaptIntakeObject } from "../intake.mjs";
import { CONTRACT_VERSION, amountToCents } from "../checker.mjs";
import { LIMITS, INTAKE_PARSE_CONFIG, REGION_PRICE_CONFIG } from "../config.mjs";
import { strictParse, dump } from "../jsonstrict.mjs";
import { llmError, isLlmError } from "./errors.mjs";
import { loadPromptBody } from "./prompt.mjs";
import { llmProvider } from "./provider.mjs";

/** 解析结果的结构版本：任何字段语义变化都必须递增（写进响应，便于前端与复核对齐）。 */
export const INTAKE_PARSE_SCHEMA = "intake-parse-v1";

/** 解析结果的状态。⛔ 不使用「成功」以外的模糊词：每种状态都能对应到一句可核验的中文。 */
export const PARSE_STATUS = Object.freeze({
  /** 解析成功，且合并后的 intake 通过现有校验。 */
  READY: "ready",
  /** 解析出了字段，但合并后的 intake 缺少必填项（由现有校验给出 needs_input + 中文错误）。 */
  NEEDS_INPUT: "needs_input",
  /** 解析成功但**没有识别出任何可落地字段**（含糊/无关输入）⇒ 明确标记，不瞎猜。 */
  EMPTY: "empty",
  /** 调用或输出失败 ⇒ 已回落到用户提交的表单字段继续。 */
  DEGRADED: "degraded",
  /** 未启用，或本次没有提供自由文本。 */
  DISABLED: "disabled",
});

/** 关系白名单：产品面 8 项 + unknown（"暂不确定"，提交后必须澄清）。⛔ 不含仅技术回归的 colleague。 */
export function relationIds() {
  return [...PRODUCT_RELATIONS.map((item) => item.id), "unknown"];
}

/** 目标金额/天数约束带宽（与 pipeline 的候选侧 gate 共用同一份常量）。 */
export const BANDS = Object.freeze({
  budgetCny: INTAKE_PARSE_CONFIG.budgetBandCny,
  days: INTAKE_PARSE_CONFIG.daysBand,
});

const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;
const MAX_CENTS = 10000n * 100n;

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** 分 → 十进制字符串（与契约的 AMOUNT_RE 同形：无前导零、至多两位小数）。 */
function amountOfCents(cents) {
  const int = cents / 100n;
  const frac = cents % 100n;
  return frac === 0n ? String(int) : `${int}.${String(frac).padStart(2, "0")}`;
}

function codePointLength(value) {
  return [...String(value)].length;
}

/** 文本片段（evidence / phrase）：去掉控制字符、限长，绝不回显超长原文。 */
function snippet(value, max = 60) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!cleaned) return null;
  return codePointLength(cleaned) > max ? `${[...cleaned].slice(0, max).join("")}…` : cleaned;
}

/** Asia/Shanghai 的今天（相对时间必须由服务端给基准，不能让模型自己猜日期）。 */
export function shanghaiToday(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "long" }).format(now);
  return { date, weekday };
}

/**
 * 代码固定的字段清单与取值范围。
 * `fields` 直接取自 intake.mjs 的 `INTAKE_FIELDS`，避免"文档一套、代码另一套"。
 */
export function fieldCatalogue() {
  return {
    schema_version: INTAKE_PARSE_SCHEMA,
    intake_fields: [...INTAKE_FIELDS].sort(),
    /** 解析器**允许**产出的键（比 intake_fields 更窄，由本模块逐条判定）。 */
    parseable_keys: [
      "recipient_relation",
      "closeness",
      "occasion",
      "budget",
      "deadline",
      "interests",
      "gift_styles",
      "exclusion_terms",
      "exclusion_tags",
      "dislikes",
      "previous_gifts",
      "additional_context",
      "city",
      "experiential_mentioned",
      "literal_preferences",
      "unmapped",
    ],
    enums: {
      recipient_relation: relationIds().map((id) => ({ id, zh: RELATIONS_FULL[id] ?? id })),
      closeness: Object.keys(CLOSENESS_TABLE).map((id) => ({ id, zh: CLOSENESS_TABLE[id] })),
      occasion: Object.keys(OCCASION_TABLE).map((id) => ({ id, zh: OCCASION_TABLE[id] })),
      interests: Object.keys(INTEREST_TABLE).map((id) => ({ id, zh: INTEREST_TABLE[id] })),
      gift_styles: Object.keys(GIFT_STYLE_TABLE).map((id) => ({ id, zh: GIFT_STYLE_TABLE[id] })),
      exclusion_tags: Object.keys(EXCLUSION_TABLE).map((id) => ({ id, zh: EXCLUSION_TABLE[id] })),
    },
    ranges: { budget_amount: "1 至 10000 的十进制字符串（0 仅用于「不花钱」）", deadline_days: "0 至 365 的整数" },
    bands: { ...BANDS },
  };
}

/** 清单的稳定指纹：写进响应，便于复核「这次解析用的是哪一版清单」。 */
export function catalogueRevision() {
  return createHash("sha256").update(dump(fieldCatalogue())).digest("hex").slice(0, 16);
}

/** 消息构造：系统提示词来自 workflow/prompts/intake-parse.md，清单由**代码**追加。 */
export function buildIntakeParseMessages({ text, now = new Date() }) {
  const catalogue = fieldCatalogue();
  const body = loadPromptBody("parse");
  const today = shanghaiToday(now);
  const lines = [
    "# 服务端固定清单（由代码生成，是唯一事实来源；与上文一致时以上文为准）",
    `- 允许出现的键：${catalogue.parseable_keys.join("、")}`,
    "- 关系 ID：" + catalogue.enums.recipient_relation.map((item) => `${item.id}=${item.zh}`).join("、"),
    "- 熟悉程度 ID：" + catalogue.enums.closeness.map((item) => `${item.id}=${item.zh}`).join("、"),
    "- 场合 ID：" + catalogue.enums.occasion.map((item) => `${item.id}=${item.zh}`).join("、"),
    "- 兴趣 ID：" + catalogue.enums.interests.map((item) => `${item.id}=${item.zh}`).join("、"),
    "- 风格 ID：" + catalogue.enums.gift_styles.map((item) => `${item.id}=${item.zh}`).join("、"),
    "- 禁忌类别 ID：" + catalogue.enums.exclusion_tags.map((item) => `${item.id}=${item.zh}`).join("、"),
    `- 金额范围：${catalogue.ranges.budget_amount}；天数范围：${catalogue.ranges.deadline_days}`,
    "",
    "# 今天（Asia/Shanghai，用于把「明天 / 下周 / 下个月」换算成天数）",
    `${today.date}（${today.weekday}）`,
  ];
  const system = `${body ?? FALLBACK_BODY}\n\n${lines.join("\n")}`;
  return [
    { role: "system", content: system },
    // 用户原话放在 user 消息里、且是 JSON 的一个字段：它是**数据**，不是指令。
    { role: "user", content: JSON.stringify({ action: "parse_intake", user_text: text, today: today.date }) },
  ];
}

const FALLBACK_BODY =
  "你是 GiftWise AI 第 1 步的输入解析器。只输出一个严格 JSON 对象，把用户原话对应到固定字段清单上；" +
  "用户没提到的字段不要出现；不许新增字段或枚举值；不确定的值宁可不输出。";

/* ── 用户原文里的**明确金额区间**（代码级识别，与 deadlineCrossCheck 同一思路）──
   2026-11-01 缺陷 A 的相关口径：用户写「预算 800–1000」时，**区间本身就是他输入的东西**，
   产品裁定要求"展现给用户的就是他输入的东西"⇒ 该区间必须原样保留（不能压成一个数、
   更不能变成 0–×××）。提示词要求模型只给单个金额（`budget.amount`），模型对区间的处理
   实测不稳定，因此这里用**用户原话**做一次代码级判定（用户原文 > 模型输出）。

   两条正则都要求金额语境词在附近，避免把日期（2026-11-01）、编号、电话误判成金额：
     1. 语境词在前：预算/价格/价位/花费/¥/RMB/人民币 + 6 个字符内 + 数字-数字；
     2. 单位词在后：数字-数字 + 元/块/人民币/以内/左右。
   分隔符只认 - – — ~ ～ 至 到（不认逗号，避免把「800, 1000」这种列举当成区间）。

   🔴 优先级规则（实测过的一条误判）：用户原话里**已经出现金额语境词**时，只认「贴着语境词」的区间（正则 1）；
   只有原话里没有语境词时，才允许「800-1000 元」这种单位在后的写法（正则 2）。
   为什么：否则「预算 200，运费 10-20 元」会被读成 10–20，把用户真正说的 200 抹掉 ——
   宁可少认一个区间（退回模型给的单个金额，仍是用户说的那个数），也不能认错。 */
const BUDGET_KEYWORD_RE = /预算|价格|价位|花费|¥|￥|RMB|人民币/u;
const BUDGET_RANGE_RES = [
  /(?:预算|价格|价位|花费|大概|大约|¥|￥|RMB|人民币)[^\d\n]{0,6}(\d{1,6}(?:\.\d{1,2})?)\s*[-–—~～至到]\s*(\d{1,6}(?:\.\d{1,2})?)/u,
  /(\d{1,6}(?:\.\d{1,2})?)\s*[-–—~～至到]\s*(\d{1,6}(?:\.\d{1,2})?)\s*(?:元|块|人民币|以内|左右)/u,
];

/** 从用户原话里提取明确金额区间；不是区间就返回 null（绝不猜）。 */
export function budgetRangeFromText(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  // 有语境词 ⇒ 只认正则 1（避免把「运费 10-20 元」这种别的区间当预算）。
  const candidates = BUDGET_KEYWORD_RE.test(text) ? [BUDGET_RANGE_RES[0]] : BUDGET_RANGE_RES;
  for (const re of candidates) {
    const match = re.exec(text);
    if (!match) continue;
    const lowCents = amountToCents(match[1]);
    const highCents = amountToCents(match[2]);
    if (lowCents === null || highCents === null) continue;
    if (lowCents >= highCents) continue; // 同一个数 / 倒序 ⇒ 不是区间
    if (highCents > MAX_CENTS) continue; // 超出契约上限 ⇒ 交给模型单值路径去 drop 并记账
    return { min: amountOfCents(lowCents), max: amountOfCents(highCents), phrase: snippet(match[0], 40), lowCents, highCents };
  }
  return null;
}

/**
 * 归一化：把模型输出**逐键**对照固定清单判定，能留的留、不能留的丢并记账。
 * 纯函数，不调用模型 —— 单测可以直接喂各种脏输出。
 *
 * @returns {{patch: object, meta: object}}
 */
export function normalizeParseOutput(raw, { text = "", form = {}, now = new Date(), config = INTAKE_PARSE_CONFIG } = {}) {
  const dropped = [];
  const unmapped = [];
  const meta = {
    mentioned_text_fields: [],
    explicit_fields: [],
    inferred_fields: [],
    literal_preferences: [],
    proposed_tags: [],
    city: null,
    experiential_mentioned: false,
    echo: { budget_amount: null, budget_range: null, budget_phrase: null, deadline_days: null, deadline_phrase: null },
    constraints: { budget_band: null, days_band: null },
    unmapped: [],
    dropped: [],
    notes: [],
  };
  const patch = {};
  const drop = (field, value, reason) => dropped.push({ field, value: snippet(typeof value === "string" ? value : safeJson(value), 40), reason });

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    drop("<root>", raw, "解析结果不是对象");
    meta.dropped = dropped;
    return { patch, meta };
  }

  /* ---------- 枚举字段：只认清单里的 ID ---------- */
  const enumField = (key, allowed, intakeKey = key) => {
    const entry = raw[key];
    if (entry === undefined || entry === null) return null;
    const value = typeof entry === "object" && !Array.isArray(entry) ? entry.value : entry;
    if (typeof value !== "string" || !allowed.includes(value)) {
      drop(key, value, `不在代码固定的取值清单内（${allowed.join("/")}）`);
      return null;
    }
    if (typeof entry === "object") {
      const evidence = snippet(entry.evidence);
      if (evidence) meta.notes.push(`${intakeKey} ← “${evidence}”`);
      if (entry.explicit === true) meta.explicit_fields.push(intakeKey);
      else meta.inferred_fields.push(intakeKey);
    }
    return value;
  };

  const relation = enumField("recipient_relation", relationIds());
  if (relation) {
    patch.recipient_relation = relation;
    meta.mentioned_text_fields.push("recipient_relation");
  }
  const closeness = enumField("closeness", Object.keys(CLOSENESS_TABLE));
  if (closeness) {
    patch.closeness = closeness;
    meta.mentioned_text_fields.push("closeness");
  }
  const occasion = enumField("occasion", Object.keys(OCCASION_TABLE));
  if (occasion) {
    patch.occasion = occasion;
    meta.mentioned_text_fields.push("occasion");
  }
  // 自定义关系/场合：模型不给（它只能选固定 ID）；other 时由前端补充自定义文本。

  /* ---------- 预算：用户给的**那个值** + 上下 50 的约束带宽 ----------
     🔴 2026-11-01 缺陷 A 修复（独立验收 §1.4「预算金额冲突时 budget_amount 跟随文本」没做到）：
        本块曾经**只**写 `patch.budget_mode` / `patch.budget_range`，从不写 `patch.budget_amount`。
        于是「表单填了 budget_amount=100 + 文本说预算 800」时，合并后的 intake 是
        `budget_amount: "100"` + `budget_range: {min:750,max:850}` ⇒ `intake.mjs:100` 的
        `BUDGET_RANGE_MISMATCH`（契约要求 `budget_amount === budget_range.max`）⇒ 解析结果
        **过不了自己的硬校验**（实测 status=needs_input）。
        现在按产品负责人 2026-10-31 裁定 2「用户输入确定金额 ⇒ 展现给用户的就是他输入的东西；
        之后约束价格时控制在这个值的上下区间不超过 50」落地：
          · `budget_amount` = 用户文本给的那个确定值（跟随文本，不再被表单旧值粘住）；
          · `budget_range` = {min: 值−50, max: 值}（契约要求 max === budget_amount，
            所以上界只能取用户原值；+50 那一侧保留在 constraints.budget_band 里，
            实际使用时被 checker 的 OVER_BUDGET（≤ 用户所给值）兜住 ⇒ 生效区间 [值−50, 值]，
            与 pipeline.mjs:applyInputParseGates 的既有口径完全一致）； */
  const budgetEntry = raw.budget;
  /* (a) 区间输入：「预算 800–1000」这种。用户给的**区间本身**就是他输入的东西，
         因此原样展示、原样作为契约区间；容差带宽仍是两端各不超过 50。
         识别优先级：**用户原文里的明确区间**（代码级，权威）> 模型显式给的 min/max。 */
  const textRange = budgetRangeFromText(text);
  const modelRange = (() => {
    if (budgetEntry === null || typeof budgetEntry !== "object" || Array.isArray(budgetEntry)) return null;
    if (budgetEntry.min === undefined || budgetEntry.max === undefined) return null;
    const asAmount = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null);
    const low = amountToCents(asAmount(budgetEntry.min) ?? "\u0000");
    const high = amountToCents(asAmount(budgetEntry.max) ?? "\u0000");
    if (low === null || high === null || low >= high || high > MAX_CENTS) return null;
    return { min: amountOfCents(low), max: amountOfCents(high), lowCents: low, highCents: high, source: "model_range" };
  })();
  const range = textRange ? { ...textRange, source: "user_text_range" } : modelRange;
  if (range) {
    const low = range.lowCents;
    const high = range.highCents;
    const bandLow = clamp(low - BigInt(config.budgetBandCny) * 100n, 0n, MAX_CENTS);
    const bandHigh = clamp(high + BigInt(config.budgetBandCny) * 100n, 0n, MAX_CENTS);
    patch.contract_version = CONTRACT_VERSION;
    patch.budget_mode = low === 0n && high === 0n ? "zero" : "other";
    patch.budget_amount = amountOfCents(high);
    patch.budget_range = { min: amountOfCents(low), max: amountOfCents(high) };
    meta.mentioned_text_fields.push("budget_amount");
    if (range.source === "user_text_range" || (typeof budgetEntry === "object" && budgetEntry !== null && budgetEntry.explicit === true)) {
      meta.explicit_fields.push("budget_amount");
    }
    meta.echo.budget_amount = amountOfCents(high);
    meta.echo.budget_range = { min: amountOfCents(low), max: amountOfCents(high) };
    meta.echo.budget_phrase = snippet(typeof budgetEntry === "object" && budgetEntry !== null ? budgetEntry.phrase : range.phrase, 40);
    meta.constraints.budget_band = {
      min: amountOfCents(bandLow),
      max: amountOfCents(bandHigh),
      user_min: amountOfCents(low),
      user_max: amountOfCents(high),
      user_amount: amountOfCents(high),
      band_cny: config.budgetBandCny,
      contract_range: { min: amountOfCents(low), max: amountOfCents(high) },
      basis: `用户给出金额区间 ${amountOfCents(low)}–${amountOfCents(high)} ⇒ 界面显示用户输入的原区间（不显示 0–×××）；候选价格约束带宽为区间两端各不超过 ${config.budgetBandCny} 元（产品负责人 2026-10-31 裁定）`,
      display: `界面显示用户输入的原区间：${amountOfCents(low)}–${amountOfCents(high)}`,
    };
    meta.budget_check = {
      kind: "amount_range",
      source: range.source,
      range: { min: amountOfCents(low), max: amountOfCents(high) },
      phrase: range.phrase ?? null,
      model_amount: typeof budgetEntry === "object" && budgetEntry !== null && budgetEntry.amount !== undefined ? String(budgetEntry.amount) : null,
      note:
        range.source === "user_text_range"
          ? "用户原话里是明确金额区间（代码级识别，优先级高于模型给的单个金额）：budget_amount 取区间上界（契约要求 budget_amount === budget_range.max），budget_range 保留用户自己的区间。"
          : "模型显式给出了金额区间：原样作为契约区间，budget_amount 取区间上界（契约要求 budget_amount === budget_range.max）。",
    };
    if (range.source === "user_text_range" && meta.budget_check.model_amount !== null) {
      meta.notes.push(`⚠ 模型把「${range.phrase ?? "区间"}」读成单个金额 ${meta.budget_check.model_amount}；按用户原文的区间为准（budget_amount=${amountOfCents(high)}，区间 ${amountOfCents(low)}–${amountOfCents(high)}）。`);
    }
  } else if (budgetEntry !== undefined && budgetEntry !== null) {
    const amountRaw = typeof budgetEntry === "object" ? budgetEntry.amount : budgetEntry;
    const amount = typeof amountRaw === "string" ? amountRaw.trim() : typeof amountRaw === "number" && Number.isFinite(amountRaw) ? String(amountRaw) : null;
    const cents = amount === null ? null : amountToCents(amount);
    if (cents === null) {
      drop("budget.amount", amountRaw, "不是合法的十进制金额字符串");
    } else if (cents > MAX_CENTS) {
      drop("budget.amount", amountRaw, "金额超过契约上限 10000");
    } else {
      const zero = cents === 0n;
      // 契约的预算区间要求 max === budget_amount（checker.mjs:BUDGET_RANGE_MISMATCH）；
      // 因此把**用户给的那个确定值**同时写进 budget_amount 与 budget_range.max：
      //   budget_amount = 值（跟随用户文本，界面/后续价格约束都用它）
      //   budget_range   = {min: 值 − 50, max: 值}（下界给 BELOW_BUDGET_RANGE，上界是 OVER_BUDGET 硬门）
      // ±50 的容差带完整记在 meta.constraints.budget_band（min 值−50 / max 值+50），
      // 与 pipeline.mjs 的候选侧 gate 共用同一份常量。
      const low = clamp(cents - BigInt(config.budgetBandCny) * 100n, 0n, MAX_CENTS);
      const high = clamp(cents + BigInt(config.budgetBandCny) * 100n, 0n, MAX_CENTS);
      patch.contract_version = CONTRACT_VERSION;
      patch.budget_mode = zero ? "zero" : "other";
      patch.budget_amount = amountOfCents(cents);
      patch.budget_range = { min: amountOfCents(zero ? 0n : low), max: amountOfCents(zero ? 0n : cents) };
      meta.mentioned_text_fields.push("budget_amount");
      if (typeof budgetEntry === "object" && budgetEntry.explicit === true) meta.explicit_fields.push("budget_amount");
      meta.echo.budget_amount = amountOfCents(cents);
      meta.echo.budget_range = { min: amountOfCents(zero ? 0n : low), max: amountOfCents(cents) };
      meta.echo.budget_phrase = snippet(typeof budgetEntry === "object" ? budgetEntry.phrase : null, 40);
      meta.constraints.budget_band = {
        min: amountOfCents(zero ? 0n : low),
        max: amountOfCents(zero ? 0n : high),
        user_amount: amountOfCents(cents),
        band_cny: config.budgetBandCny,
        contract_range: { min: amountOfCents(zero ? 0n : low), max: amountOfCents(cents) },
        basis: zero ? "用户明确说「不花钱」⇒ 预算固定为 0" : `用户给出确定金额 ${amountOfCents(cents)} ⇒ 价格约束带宽为上下不超过 ${config.budgetBandCny} 元（产品负责人 2026-10-31 裁定）`,
        display: `界面显示用户输入的原值：${amountOfCents(cents)}（不显示区间）`,
      };
    }
  }

  /* ---------- 时间：确定天数 + 上下 1 天的约束带宽 ---------- */
  const deadlineEntry = raw.deadline;
  if (deadlineEntry !== undefined && deadlineEntry !== null) {
    const daysRaw = typeof deadlineEntry === "object" ? deadlineEntry.days : deadlineEntry;
    const days = typeof daysRaw === "number" && Number.isInteger(daysRaw) ? daysRaw : typeof daysRaw === "string" && /^\d{1,3}$/.test(daysRaw.trim()) ? Number(daysRaw.trim()) : null;
    if (days === null || days < 0 || days > 365) {
      drop("deadline.days", daysRaw, "不是 0–365 的整数");
    } else {
      patch.deadline_days = days;
      meta.mentioned_text_fields.push("deadline_days");
      if (typeof deadlineEntry === "object" && deadlineEntry.explicit === true) meta.explicit_fields.push("deadline_days");
      meta.echo.deadline_days = days;
      meta.echo.deadline_phrase = snippet(typeof deadlineEntry === "object" ? deadlineEntry.phrase : null, 40);
      // 相对时间词的代码级交叉校验：矛盾时**要求确认**（不静默改写模型给的天数）。
      meta.deadline_check = deadlineCrossCheck({ phrase: typeof deadlineEntry === "object" ? deadlineEntry.phrase : null, days });
      if (meta.deadline_check && meta.deadline_check.ok === false) {
        meta.notes.push(`⚠ 期限需要确认：${meta.deadline_check.reason}`);
      }
      meta.constraints.days_band = {
        min: clamp(days - config.daysBand, 0, 365),
        max: clamp(days + config.daysBand, 0, 365),
        user_days: days,
        band_days: config.daysBand,
        basis: `用户给出确定天数 ${days} 天 ⇒ 时间约束带宽为上下不超过 ${config.daysBand} 天（产品负责人 2026-10-31 裁定）`,
        display: `界面显示用户输入的原值：${days} 天（不显示区间）`,
      };
    }
  }

  /* ---------- 兴趣：ID 只是"便于检索"的附加物，原话才是硬约束 ---------- */
  const interestEntries = Array.isArray(raw.interests) ? raw.interests : raw.interests === undefined || raw.interests === null ? [] : [raw.interests];
  const interestIds = [];
  const confidence = {};
  for (const entry of interestEntries) {
    const id = typeof entry === "object" && entry !== null ? entry.id : entry;
    if (typeof id !== "string" || !(id in INTEREST_TABLE)) {
      drop("interests", entry, "兴趣 ID 不在固定清单内");
      continue;
    }
    if (interestIds.includes(id)) continue;
    if (interestIds.length >= LIMITS.maxArrayItems) {
      drop("interests", id, `兴趣数组超过 ${LIMITS.maxArrayItems} 项上限`);
      continue;
    }
    interestIds.push(id);
    // 契约里已有的「推断」标记：用户明说 ⇒ confirmed，其余一律 inferred（不能默认当事实）。
    const explicit = typeof entry === "object" && entry !== null && entry.explicit === true;
    confidence[id] = explicit ? "confirmed" : "inferred";
    const evidence = typeof entry === "object" && entry !== null ? snippet(entry.evidence) : null;
    if (evidence) meta.notes.push(`interests.${id} ← “${evidence}”`);
    meta[explicit ? "explicit_fields" : "inferred_fields"].push(`interests.${id}`);
  }
  if (interestIds.length > 0) {
    patch.interests = interestIds;
    patch.interest_confidence = confidence;
    meta.mentioned_text_fields.push("interests");
  } else if (raw.interests !== undefined && raw.interests !== null) {
    drop("interests", raw.interests, "没有任何兴趣 ID 通过清单校验（原话保留在 literal_preferences 里）");
  }

  /* ---------- 风格 ---------- */
  const styleEntries = Array.isArray(raw.gift_styles) ? raw.gift_styles : raw.gift_styles === undefined || raw.gift_styles === null ? [] : [raw.gift_styles];
  const styleIds = [];
  for (const entry of styleEntries) {
    const id = typeof entry === "object" && entry !== null ? entry.id : entry;
    if (typeof id !== "string" || !(id in GIFT_STYLE_TABLE)) {
      drop("gift_styles", entry, "风格 ID 不在固定清单内");
      continue;
    }
    if (styleIds.includes(id)) continue;
    if (styleIds.length >= LIMITS.maxArrayItems) {
      drop("gift_styles", id, `风格数组超过 ${LIMITS.maxArrayItems} 项上限`);
      continue;
    }
    styleIds.push(id);
    const evidence = typeof entry === "object" && entry !== null ? snippet(entry.evidence) : null;
    if (evidence) meta.notes.push(`gift_styles.${id} ← “${evidence}”`);
    const explicit = typeof entry === "object" && entry !== null && entry.explicit === true;
    meta[explicit ? "explicit_fields" : "inferred_fields"].push(`gift_styles.${id}`);
  }
  if (styleIds.length > 0) {
    patch.gift_styles = styleIds;
    meta.mentioned_text_fields.push("gift_styles");
  } else if (raw.gift_styles !== undefined && raw.gift_styles !== null) {
    drop("gift_styles", raw.gift_styles, "没有任何风格 ID 通过清单校验");
  }

  /* ---------- 禁忌：字面词可以用（用户原话），**类别必须由用户确认** ---------- */
  const terms = [];
  for (const item of Array.isArray(raw.exclusion_terms) ? raw.exclusion_terms : []) {
    const text2 = typeof item === "object" && item !== null ? item.text : item;
    if (typeof text2 !== "string" || !text2.trim()) {
      drop("exclusion_terms", item, "禁忌字面词必须是非空字符串");
      continue;
    }
    const cleaned = text2.trim();
    if (codePointLength(cleaned) > LIMITS.maxStringCodePoints || terms.length >= LIMITS.maxArrayItems) {
      drop("exclusion_terms", cleaned, "超过契约上限（20 项 / 每项 1000 码点）");
      continue;
    }
    if (!terms.includes(cleaned)) terms.push(cleaned);
  }
  if (terms.length > 0) meta.mentioned_text_fields.push("hard_exclusions.terms");
  // 类别：**不**写进 intake（契约明确「词不自动推断类别」），只作为待用户确认的建议返回。
  for (const item of Array.isArray(raw.exclusion_tags) ? raw.exclusion_tags : []) {
    const id = typeof item === "object" && item !== null ? item.id : item;
    const evidence = typeof item === "object" && item !== null ? snippet(item.evidence) : null;
    if (typeof id !== "string" || !(id in EXCLUSION_TABLE)) {
      drop("exclusion_tags", item, "禁忌类别不在固定清单内");
      continue;
    }
    meta.proposed_tags.push({ id, zh: EXCLUSION_TABLE[id], evidence, needs_user_confirmation: true, reason: "契约要求类别由用户确认：词不自动推断类别" });
  }
  meta.proposed_tags = dedupeBy(meta.proposed_tags, (item) => item.id);

  /* ---------- 自由文本字段 ---------- */
  const freeText = (key, intakeKey, max = 1000) => {
    const value = raw[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !value.trim()) {
      drop(key, value, "必须是非空字符串");
      return null;
    }
    const cleaned = value.trim();
    if (codePointLength(cleaned) > max) {
      drop(key, cleaned, `超过 ${max} 码点上限`);
      return null;
    }
    return cleaned;
  };
  const dislikes = freeText("dislikes", "dislikes");
  if (dislikes) {
    patch.dislikes = dislikes;
    meta.mentioned_text_fields.push("dislikes");
  }
  const previousGifts = freeText("previous_gifts", "previous_gifts");
  if (previousGifts) {
    patch.previous_gifts = previousGifts;
    meta.mentioned_text_fields.push("previous_gifts");
  }
  const additional = freeText("additional_context", "additional_context", 600);
  if (additional) {
    patch.additional_context = additional;
    meta.mentioned_text_fields.push("additional_context");
  }

  /* ---------- 体验类：城市 ---------- */
  const cityEntry = raw.city;
  if (cityEntry !== undefined && cityEntry !== null) {
    const value = typeof cityEntry === "object" ? cityEntry.value : cityEntry;
    if (typeof value === "string" && value.trim() && codePointLength(value.trim()) <= 20) {
      meta.city = value.trim();
    } else {
      drop("city", value, "城市名必须是不超过 20 码点的非空字符串");
    }
  }
  meta.experiential_mentioned = raw.experiential_mentioned === true;

  /* ---------- 用户原文（硬约束） ---------- */
  const literals = [];
  for (const item of Array.isArray(raw.literal_preferences) ? raw.literal_preferences : []) {
    if (typeof item !== "string" || !item.trim()) {
      drop("literal_preferences", item, "必须是非空字符串");
      continue;
    }
    const cleaned = item.trim();
    if (codePointLength(cleaned) > 200) {
      drop("literal_preferences", cleaned, "单条原文超过 200 码点");
      continue;
    }
    if (literals.length >= LIMITS.maxArrayItems) {
      drop("literal_preferences", cleaned, `超过 ${LIMITS.maxArrayItems} 项上限`);
      continue;
    }
    if (!literals.includes(cleaned)) literals.push(cleaned);
  }
  meta.literal_preferences = literals;
  if (literals.length > 0) meta.mentioned_text_fields.push("literal_preferences");

  for (const item of Array.isArray(raw.unmapped) ? raw.unmapped : []) {
    if (typeof item === "string" && item.trim()) {
      const cleaned = snippet(item, 120);
      if (cleaned && !unmapped.includes(cleaned)) unmapped.push(cleaned);
    } else if (typeof item === "object" && item !== null && typeof item.text === "string") {
      const cleaned = snippet(item.text, 120);
      if (cleaned && !unmapped.includes(cleaned)) unmapped.push(cleaned);
    }
  }
  meta.unmapped = unmapped.slice(0, LIMITS.maxArrayItems);

  /* ---------- 模型输出里"多出来的键"必须如实记账（不许悄悄忽略） ---------- */
  for (const key of Object.keys(raw)) {
    if (!fieldCatalogue().parseable_keys.includes(key)) drop(key, raw[key], "不在服务端允许的解析键清单内（字段清单由代码固定）");
  }

  meta.dropped = dropped;
  meta.notes = meta.notes.slice(0, 40);
  return { patch, meta };
}

function dedupeBy(items, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* ── 相对时间词的**代码级**交叉校验（2026-10-31 实测：同一句「下个月」被模型算出 30 天，也被算成 1 天）──
   模型对相对时间不稳定。这里**不静默改写**模型给的天数（那等于猜），只做两件事：
     1. 矛盾时把结论标出来，并要求用户确认期限；
     2. 记进 parse.deadline_check，让界面有据可依。
   宁可多问一句，也不能拿一个 1 天的期限去生成方案（会把用户直接卡死）。 */
const DEADLINE_UNIT_RULES = [
  { re: /(\d+)\s*个月|下个?月|下月|来月/, unit: "月", approx: 30 },
  { re: /(\d+)\s*(周|个?星期)|下周|下个?星期/, unit: "周", approx: 7 },
  { re: /后天/, unit: "天", approx: 2 },
  { re: /明天|次日/, unit: "天", approx: 1 },
  { re: /(\d+)\s*天|今天|当天/, unit: "天", approx: null },
];

export function deadlineCrossCheck({ phrase, days }) {
  if (typeof phrase !== "string" || !phrase.trim() || !Number.isInteger(days)) return null;
  for (const rule of DEADLINE_UNIT_RULES) {
    const match = rule.re.exec(phrase);
    if (!match) continue;
    if (rule.unit === "天") {
      if (rule.approx !== null && days !== rule.approx) {
        return { phrase, days, unit: rule.unit, expected: rule.approx, ok: false, reason: `原话「${phrase}」指的是 ${rule.approx} 天，模型算出 ${days} 天` };
      }
      return { phrase, days, unit: rule.unit, expected: days, ok: true };
    }
    const expected = match[1] ? Number(match[1]) * rule.approx : rule.approx;
    // 月的容差放宽（有的月 28/31 天）；周的容差放宽（「下周」也可能是 3–10 天）。
    const tolerance = rule.unit === "月" ? Math.max(3, Math.round(expected * 0.2)) : 3;
    const ok = Math.abs(days - expected) <= tolerance;
    return { phrase, days, unit: rule.unit, expected, tolerance, ok, reason: ok ? null : `原话「${phrase}」约等于 ${expected} 天（容差 ${tolerance} 天），模型算出 ${days} 天，偏差过大` };
  }
  return null;
}

/** 把确定性派生的文本拼进 additional_context（不改字段清单，只是填现有字段）。 */
export function composeAdditionalContext({ formValue, meta, config = INTAKE_PARSE_CONFIG }) {
  const parts = [];
  const literals = Array.isArray(meta?.literal_preferences) ? meta.literal_preferences.filter((item) => typeof item === "string" && item.trim()) : [];
  if (typeof formValue === "string" && formValue.trim()) parts.push(formValue.trim());
  if (meta?.city) parts.push(`所在城市：${meta.city}`);
  if (literals.length > 0) {
    parts.push(`用户原话（硬约束，不得用预设类目替代）：${literals.join(" / ")}`);
  }
  if (parts.length === 0) return null;
  let text = parts.join("\n");
  const max = Math.min(config.literalContextCodePoints ?? 600, LIMITS.maxStringCodePoints);
  if (codePointLength(text) > max) {
    text = `${[...text].slice(0, max - 1).join("")}…`;
  }
  return text;
}

/**
 * 合并：**用户文本优先于表单选项**（裁定 1），表单补文本没说到的部分。
 * 冲突逐条记账，绝不静默覆盖。
 */
export function mergeIntake({ form = {}, patch = {}, meta = {} }) {
  const intake = { ...(form && typeof form === "object" && !Array.isArray(form) ? form : {}) };
  const overridden = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "hard_exclusions") continue;
    const had = Object.hasOwn(intake, key);
    if (had && safeJson(intake[key]) !== safeJson(value)) {
      // additional_context 是"用户文本 + 表单备注"的合并（原文不丢），不算互相覆盖。
      const isAppend = key === "additional_context" && typeof value === "string" && typeof intake[key] === "string" && value.startsWith(intake[key]);
      if (!isAppend) overridden.push({ field: key, from_form: intake[key], to_text: value, rule: "用户输入优先于选项（产品负责人 2026-10-31 裁定 1）" });
    }
    intake[key] = value;
  }
  // 禁忌：把文本里的字面词并入表单里已有的禁忌，绝不覆盖用户已确认的类别。
  const terms = meta.termList ?? [];
  if (terms.length > 0) {
    const prior = intake.hard_exclusions && typeof intake.hard_exclusions === "object" && !Array.isArray(intake.hard_exclusions) ? intake.hard_exclusions : {};
    const priorTerms = Array.isArray(prior.terms) ? prior.terms : [];
    intake.hard_exclusions = {
      tags: Array.isArray(prior.tags) ? prior.tags : [],
      terms: dedupeBy([...priorTerms, ...terms], (item) => String(item)),
      unresolved: Array.isArray(prior.unresolved) ? prior.unresolved : [],
    };
    meta.mentioned_text_fields.push("hard_exclusions.terms");
  }
  return { intake, overridden };
}

/** 文本没提到、表单也没提供的字段（"保持空/默认"的可核对清单）。 */
export function untouchedFields({ form = {}, patch = {}, meta = {} }) {
  const provided = new Set([...Object.keys(form ?? {}), ...Object.keys(patch ?? {})]);
  if (patch?.budget_range || patch?.budget_mode) provided.add("budget_amount");
  if (Array.isArray(meta?.termList) && meta.termList.length > 0) provided.add("hard_exclusions");
  if (meta?.city) provided.add("additional_context");
  return [...INTAKE_FIELDS].filter((key) => !provided.has(key) && key !== "contract_version").sort();
}

/* --------------------------------------------------------------- 调用与编排 */

const CACHE_LIMIT = 50;
const CACHE_TTL_MS = 10 * 60 * 1000;
const parseCache = new Map();
const pendingParses = new Map();

function parseCacheKey({ text, form, model }) {
  return createHash("sha256").update(safeJson([INTAKE_PARSE_SCHEMA, catalogueRevision(), model ?? null, text, form ?? {}])).digest("hex");
}

/** 仅供测试与人工复核：清空解析缓存（不涉及任何持久化证据）。 */
export function clearParseCache() {
  parseCache.clear();
  pendingParses.clear();
}

/**
 * 主入口：一次解析（最多 1 次输出格式重试，见 provider.requestIntakeParse）。
 *
 * @param {{text?: string, form?: object, provider?: object, now?: Date, enabled?: boolean, useCache?: boolean, config?: object}} input
 */
export async function parseIntakeText(input = {}) {
  const started = Date.now();
  const config = input.config ?? INTAKE_PARSE_CONFIG;
  const form = input.form && typeof input.form === "object" && !Array.isArray(input.form) ? input.form : {};
  const text = typeof input.text === "string" ? input.text : "";
  const provider = input.provider ?? llmProvider;
  const notices = [];

  const baseMeta = {
    schema_version: INTAKE_PARSE_SCHEMA,
    catalogue_revision: catalogueRevision(),
    text_present: text.trim() !== "",
    text_code_points: codePointLength(text),
    text_sha256_12: createHash("sha256").update(text).digest("hex").slice(0, 12),
  };

  /** 收尾：统一走现有校验，并把「回落」如实写进响应。 */
  const finish = ({ status, reasonCode = null, patch = {}, meta = {}, llm = null, degraded = false, cached = false, extraNotices = [] }) => {
    const mergedMeta = {
      // 降级/关闭路径也让响应结构保持稳定（前端不必为每种 status 写一套解析）。
      mentioned_text_fields: [],
      explicit_fields: [],
      inferred_fields: [],
      literal_preferences: [],
      proposed_tags: [],
      unmapped: [],
      dropped: [],
      notes: [],
      echo: { budget_amount: null, budget_range: null, budget_phrase: null, deadline_days: null, deadline_phrase: null },
      deadline_check: null,
      constraints: { budget_band: null, days_band: null },
      city: null,
      experiential_mentioned: false,
      ...meta,
      termList: meta.termList ?? [],
    };
    /* 裁定 3：用户原文是硬约束 ⇒ 必须落到**现有**字段上带去后续步骤（用 additional_context，
       不新增字段）。城市同理（裁定 4）。这样 request_json.notes 里就带着用户原话，
       第 2 步的推荐提示词与候选侧 gate 都看得到它。 */
    const composed = composeAdditionalContext({ formValue: patch.additional_context ?? form.additional_context, meta: mergedMeta });
    if (composed) patch = { ...patch, additional_context: composed };
    const { intake, overridden } = mergeIntake({ form, patch, meta: mergedMeta });
    // 体验类必须问城市（裁定 4）：缺城市时给出**必答**追问项。
    const followups = [];
    const wantsExperience =
      mergedMeta.experiential_mentioned === true ||
      (Array.isArray(intake.interests) && intake.interests.includes("experiences_activities")) ||
      (Array.isArray(intake.gift_styles) && intake.gift_styles.includes("experiential"));
    if (wantsExperience && !mergedMeta.city) {
      followups.push({
        id: "city",
        field: "additional_context",
        question: "这个体验打算在哪个城市使用？（不同城市价格差别很大，估价与推荐会按这个城市来）",
        required: true,
        reason: "产品负责人 2026-10-31 裁定 4：体验类必须提问所在城市",
      });
    }
    if (typeof intake.dislikes === "string" && intake.dislikes.trim()) {
      followups.push({
        id: "exclusion_analysis",
        field: "dislikes",
        question: "你提到「不喜欢」的内容需要先识别并逐项确认，才能进入生成方案。",
        required: true,
        endpoint: "POST /api/exclusions/analyze",
        reason: "现有契约要求排除项必须由用户确认",
      });
    }
    if (mergedMeta.deadline_check && mergedMeta.deadline_check.ok === false) {
      followups.push({
        id: "deadline_confirm",
        field: "deadline_days",
        question: `你说的是「${mergedMeta.deadline_check.phrase}」，但解析出的可用天数是 ${mergedMeta.deadline_check.days} 天，请确认期限（按原话大约是 ${mergedMeta.deadline_check.expected} 天）。`,
        required: true,
        current_value: mergedMeta.deadline_check.days,
        suggested_value: mergedMeta.deadline_check.expected,
        reason: "相对时间由模型换算，实测不稳定（同一句「下个月」曾算出 30 天与 1 天）；这里只提示确认，服务端不擅自改写模型给的值",
      });
    }
    const regionPrice =
      wantsExperience || mergedMeta.city
        ? {
            applicable: wantsExperience,
            city: mergedMeta.city,
            tier: cityTier(mergedMeta.city),
            note: REGION_PRICE_CONFIG.note,
            source: REGION_PRICE_CONFIG.source,
            is_estimate: true,
            enforced_by: "提示词硬约束 + 响应标注；本地库没有买家城市维度，无法按城市过滤或比价",
          }
        : null;

    const validation = adaptIntakeObject(intake);
    // mentioned_text_fields 去重（同一个字段可能被归一化与合并两处各记一次）。
    mergedMeta.mentioned_text_fields = [...new Set(mergedMeta.mentioned_text_fields)];
    const untouched = untouchedFields({ form, patch, meta: mergedMeta });
    const unknownFormKeys = Object.keys(form).filter((key) => !INTAKE_FIELDS.has(key));
    if (unknownFormKeys.length > 0) {
      notices.push(`⚠ 表单里有未声明的字段：${unknownFormKeys.join("、")}。已**原样**提交给现有校验（不做静默删除），校验会按契约拒绝它们。`);
    }
    return {
      status: status === PARSE_STATUS.READY && validation.status !== "ready" ? PARSE_STATUS.NEEDS_INPUT : status,
      source: degraded || status === PARSE_STATUS.DISABLED ? "form" : "llm",
      intake,
      intake_validation: { status: validation.status, errors: validation.errors },
      parse: {
        ...baseMeta,
        ...mergedMeta,
        untouched_fields: untouched,
        overridden_from_form: overridden,
        required_followups: followups,
        region_price: regionPrice,
        candidate_gates: {
          budget_band: mergedMeta.constraints?.budget_band ?? null,
          days_band: mergedMeta.constraints?.days_band ?? null,
          literal_preference_gate: config.literalPreferenceGate ? "gate" : "warning",
        },
        cache: { used: cached, key_window_ms: CACHE_TTL_MS },
      },
      llm,
      degraded: degraded || status === PARSE_STATUS.DEGRADED,
      reason_code: reasonCode,
      notices: [...notices, ...extraNotices],
      elapsed_ms: Date.now() - started,
    };
  };

  if (!config.enabled) {
    return finish({
      status: PARSE_STATUS.DISABLED,
      reasonCode: "LLM_PARSE_DISABLED",
      extraNotices: ["自然语言解析已被服务端开关关闭（GIFTWISE_INTAKE_PARSE=0）；直接使用表单字段。本次没有发起任何模型调用。"],
    });
  }
  if (!text.trim()) {
    return finish({
      status: PARSE_STATUS.DISABLED,
      reasonCode: "LLM_PARSE_DISABLED",
      extraNotices: ["本次没有提供自由文本，跳过解析；直接使用表单字段。本次没有发起任何模型调用。"],
    });
  }

  const useCache = input.useCache !== false;
  const key = parseCacheKey({ text, form, model: provider?.available?.() ? "configured" : "unconfigured" });
  if (useCache) {
    const hit = parseCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.value, parse: { ...hit.value.parse, cache: { used: true, key_window_ms: CACHE_TTL_MS } }, cached: true };
    }
    if (pendingParses.has(key)) {
      // 并发去重：同一段文本同时到达时只发一次真实调用（额度与账本都不重复）。
      return pendingParses.get(key);
    }
  }

  const run = (async () => {
    if (!provider || typeof provider.requestIntakeParse !== "function") {
      return finish({
        status: PARSE_STATUS.DEGRADED,
        reasonCode: "LLM_NOT_CONFIGURED",
        degraded: true,
        llm: { attempted: false, calls: 0 },
        extraNotices: ["服务端没有可用的直连模型 provider，已**回落到你提交的表单字段**继续；没有用模拟解析结果顶替。"],
      });
    }
    if (typeof provider.available === "function" && !provider.available()) {
      return finish({
        status: PARSE_STATUS.DEGRADED,
        reasonCode: "LLM_NOT_CONFIGURED",
        degraded: true,
        llm: { attempted: false, calls: 0 },
        extraNotices: ["服务端未配置直连大模型凭证，未发起任何真实调用；已**回落到你提交的表单字段**继续。"],
      });
    }

    let call;
    try {
      call = await provider.requestIntakeParse({ messages: buildIntakeParseMessages({ text, now: input.now ?? new Date() }) });
    } catch (error) {
      return finish({
        status: PARSE_STATUS.DEGRADED,
        reasonCode: error?.code ?? "LLM_REQUEST_FAILED",
        degraded: true,
        llm: { attempted: true, calls: 1, error: String(error?.message ?? error).slice(0, 200) },
        extraNotices: ["自然语言解析调用抛出异常，已**回落到你提交的表单字段**继续；未采用任何模型输出。"],
      });
    }
    const llm = {
      attempted: true,
      calls: call.ok ? 1 : 1,
      code: call.ok ? null : call.code,
      transport: call.transport ?? null,
      attempts: call.attempts ?? null,
      output_attempts: call.output_attempts ?? null,
      model: call.model ?? null,
      finish_reason: call.finish_reason ?? null,
      usage: call.usage ?? null,
      max_tokens: call.max_tokens ?? null,
      elapsed_ms: call.elapsed_ms ?? null,
    };
    if (!call.ok) {
      return finish({
        status: PARSE_STATUS.DEGRADED,
        reasonCode: call.code,
        degraded: true,
        llm,
        extraNotices: [
          `自然语言解析失败（${call.code}），已**回落到你提交的表单字段**继续；没有用猜测值顶替、也没有把失败伪装成成功。`,
          call.message ?? "",
        ].filter(Boolean),
      });
    }

    const raw = call.parse ?? (() => {
      try {
        return strictParse(call.outputs?.parse_json ?? "null", 65536);
      } catch {
        return null;
      }
    })();
    const { patch, meta } = normalizeParseOutput(raw, { text, form, now: input.now ?? new Date() });
    // 禁忌字面词要参与合并，因此显式带进 meta（归一化阶段已逐项校验过）。
    meta.termList = Array.isArray(meta.termList) && meta.termList.length ? meta.termList : collectTermsFromPatch(raw);
    const recognized = meta.mentioned_text_fields.filter((field) => field !== "literal_preferences");
    if (recognized.length === 0 && meta.literal_preferences.length === 0 && !meta.experiential_mentioned) {
      return finish({
        status: PARSE_STATUS.EMPTY,
        reasonCode: "LLM_PARSE_EMPTY",
        patch,
        meta,
        llm,
        extraNotices: [
          "这次输入**没有识别出任何可落地的字段**（过于含糊或与送礼无关）：已如实留空并标记，没有猜测、没有填默认值；请补充关系/场合/预算/时间中的任意一项。",
        ],
      });
    }
    return finish({ status: PARSE_STATUS.READY, patch, meta, llm });
  })();

  if (useCache) {
    pendingParses.set(key, run);
    try {
      const value = await run;
      parseCache.set(key, { at: Date.now(), value });
      if (parseCache.size > CACHE_LIMIT) {
        const oldest = [...parseCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) parseCache.delete(oldest[0]);
      }
      return value;
    } finally {
      pendingParses.delete(key);
    }
  }
  return run;
}

/** 从归一化前的原始输出里取禁忌字面词（归一化阶段已校验过，这里只是搬运）。 */
function collectTermsFromPatch(raw) {
  const terms = [];
  for (const item of Array.isArray(raw?.exclusion_terms) ? raw.exclusion_terms : []) {
    const value = typeof item === "object" && item !== null ? item.text : item;
    if (typeof value === "string" && value.trim()) {
      const cleaned = value.trim();
      if (codePointLength(cleaned) <= LIMITS.maxStringCodePoints && !terms.includes(cleaned)) terms.push(cleaned);
    }
  }
  return terms.slice(0, LIMITS.maxArrayItems);
}

export function cityTier(city) {
  if (!city) return "unknown";
  if (REGION_PRICE_CONFIG.tier1Cities.includes(city)) return "tier1";
  if (REGION_PRICE_CONFIG.newTier1Cities.includes(city)) return "new_tier1";
  return "other";
}

/**
 * 把解析结果压成随推荐请求一起发给模型的**硬约束**（裁定 2/3/4）。
 * 没有内容时返回 null ⇒ 信封里不出现该键（不用空对象掩盖缺失）。
 */
export function toRecommendConstraints(parse) {
  if (!parse || typeof parse !== "object") return null;
  const constraints = {};
  if (Array.isArray(parse.literal_preferences) && parse.literal_preferences.length) constraints.literal_preferences = parse.literal_preferences;
  if (parse.city) constraints.city = parse.city;
  if (parse.constraints?.budget_band) constraints.budget_band = parse.constraints.budget_band;
  if (parse.constraints?.days_band) constraints.days_band = parse.constraints.days_band;
  if (parse.region_price?.applicable) {
    constraints.region_price = { city: parse.region_price.city, tier: parse.region_price.tier, note: parse.region_price.note, is_estimate: true };
  }
  return Object.keys(constraints).length ? constraints : null;
}

export { llmError };
