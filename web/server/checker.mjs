/**
 * 独立规则校验（JS 侧镜像 + 呈现阶段复核）。
 *
 * 镜像对象：validator/rules.py（公开接口 validate(request_json, candidates_json)）
 * ——字段、错误码、路径、判定优先级保持一致，便于用同一虚构样例做语义比对。
 * 一致性证据：`node web/tools/parity-check.mjs` 会把本镜像与 Python 参考实现在
 * workflow/examples/intake.json + candidates.json（以及若干边界样例）上的输出逐项比对。
 *
 * 呈现阶段复核（P3 职责）是本接入层新增的实现，字段沿用 workflow/workflow-spec.md
 * 的「建议 presentation_json 结构」：校验必填结构、禁忌、费用算术、全量总费用与准备时间。
 * 其中 TOTAL_MISMATCH / PRESENTATION_INVALID / REPAIR_LIMIT_REACHED 三个码在
 * workflow-spec.md:166 被标注为「代码中不存在（设计预留）」；此处是本接入层**新实现**，
 * 不改变 validator/rules.py 的既有能力，也不得被读成校验器已具备该错误处理。
 */

import { JsonFloat, codePointLength } from "./jsonstrict.mjs";
import { TAGS } from "./labels.mjs";
import { LIMITS, SHIPPING_CONFIG, PRESALE_CONFIG, PURCHASE_WINDOW_CONFIG, FULFILLMENT_CONFIG } from "./config.mjs";

const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?(?![\s\S])/;
export const CONTRACT_VERSION = "giftwise-20261031-v2";

export function error(errors, code, path, message) {
  errors.push({ code, path, message });
}

/* 接入层时间提示与独特性启发式均为 warning，不改变底层镜像规则。 */

/**
 * 从页面原文里解析时长（天）。中文电商的写法很多，这里只做**保守**解析：
 *   - 「预计 3–5 天」取**上限 5 天**（不确定区间一律取最坏情况）；
 *   - 「48 小时内发货」「24 小时」按 24 小时 = 1 天**向上取整**；
 *   - 「7 天内发货」「预售 15 天」直接取数字；
 *   - 解析不出来返回 `null`，由调用方按「未知 + 保守默认」处理，
 *     ⛔ 绝不把「没解析出来」当成「没有预售」。
 * @returns {{days: number|null, source_text: string|null, upper_bound: boolean}}
 */
export function parseDurationDays(text) {
  if (typeof text !== "string" || !text.trim()) return { days: null, source_text: null, upper_bound: false };
  const raw = text.trim();
  // 区间：取上限（保守）
  const range = raw.match(/(\d+(?:\.\d+)?)\s*[-–~至到]\s*(\d+(?:\.\d+)?)\s*(天|日)/);
  if (range) {
    const upper = Number(range[2]);
    if (Number.isFinite(upper)) return { days: Math.ceil(upper), source_text: raw, upper_bound: true };
  }
  const hours = raw.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*小时/);
  if (hours) {
    const value = Number(hours[1]);
    if (Number.isFinite(value)) return { days: Math.ceil(value / 24), source_text: raw, upper_bound: true };
  }
  const days = raw.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:工作)?\s*(天|日)/);
  if (days) {
    const value = Number(days[1]);
    if (Number.isFinite(value)) return { days: Math.ceil(value), source_text: raw, upper_bound: false };
  }
  const weeks = raw.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(周|星期)/);
  if (weeks) {
    const value = Number(weeks[1]);
    if (Number.isFinite(value)) return { days: Math.ceil(value * 7), source_text: raw, upper_bound: true };
  }
  return { days: null, source_text: raw, upper_bound: false };
}

/** 物流观察值与估算区间。days 仅为区间上界，不能当作实测时长。 */
export function resolvePurchaseWindow({
  ships_within_days = null, shipping_days = null, purchase_days = null,
  is_preorder = null, presale_days = null,
} = {}) {
  const known = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const base = { tier_inclusive: false, default: null, detail: {} };
  if (known(purchase_days)) return { ...base, days: purchase_days, min: purchase_days, max: purchase_days, source: "page_observed", detail: { purchase_days } };
  const dispatch = known(ships_within_days) ? ships_within_days : known(presale_days) ? presale_days : null;
  if (dispatch !== null && known(shipping_days)) {
    const days = dispatch + shipping_days;
    return { ...base, days, min: days, max: days, source: "page_observed", detail: { ships_within_days: dispatch, shipping_days, summed: true } };
  }
  // 发货已知、配送未知：在发货之后估算快递3~5天。
  // 仅配送已知时不猜发货等待时长，完整时长保留未知。
  const observed = dispatch ?? (known(shipping_days) ? shipping_days : null);
  const onlyShipping = dispatch === null && known(shipping_days);
  const min = onlyShipping ? null : (dispatch ?? 0) + PURCHASE_WINDOW_CONFIG.min;
  const max = onlyShipping ? null : (dispatch ?? 0) + PURCHASE_WINDOW_CONFIG.max;
  return { ...base, days: max, min, max, source: "default_estimate", default: { ...PURCHASE_WINDOW_CONFIG },
    detail: { observed, only: dispatch !== null ? "ships_within_days" : known(shipping_days) ? "shipping_days" : null, presale_unknown: is_preorder === true && dispatch === null, reason: observed === null ? "no_page_duration" : "partial_page_duration", used_upper_bound: max } };
}

/** 时间只提供比较信息，绝不影响可选性。数值字段合法性仍由独立规则检查。 */
export function deliveryDeadline({
  prep_days = null, presale_days = null, ships_within_days = null,
  shipping_days = null, purchase_days = null, available_days = null,
  is_preorder = null, fulfillment = 'online', path = "candidates[0]",
} = {}) {
  const errors = [];
  const warnings = [];
  const known = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const online = fulfillment !== 'offline' && fulfillment !== 'experience';
  const window = online ? resolvePurchaseWindow({ ships_within_days, shipping_days, purchase_days, is_preorder, presale_days }) : null;
  const effective = window?.days ?? null;
  const total = known(prep_days) && (!online || known(effective)) ? prep_days + (online ? effective : 0) : null;
  const totalMin = total === null ? null : prep_days + (window?.min ?? 0);
  if (window?.source === "default_estimate") {
    const message = window.detail.only === "shipping_days"
      ? `页面配送约${window.detail.observed}天，发货时间未知，请向商家确认完整到货时间。`
      : "快递暂按3~5天估算，是否赶得上由你判断。" + (window.detail.observed !== null ? `页面发货时长约${window.detail.observed}天，估算合计还包含这段等待时间。` : "");
    error(warnings, "SHIPPING_TIME_UNKNOWN", `${path}.estimated_shipping_days`, message);
  }
  if (window?.detail.presale_unknown) error(warnings, "PRESALE_TIME_UNKNOWN", `${path}.presale_days`, "预售发货时间未知，请向商家确认。当前快递估算不含未知预售等待时间。");
  if (is_preorder === true) error(warnings, "PRESALE_ITEM", `${path}.is_preorder`, "这是预售商品，请确认发货时间。");
  if (known(prep_days) && known(available_days) && prep_days > available_days) {
    error(warnings, "PREPARATION_TOO_LONG", `${path}.estimated_preparation_days`, `准备时间约${prep_days}天，你的计划为${available_days}天，是否合适由你判断。`);
  } else if (total !== null && known(available_days) && total > available_days) {
    error(warnings, "DELIVERY_TOO_LONG", `${path}.estimated_shipping_days`, `准备与物流估算合计${totalMin === total ? total : `${totalMin}~${total}`}天，你的计划为${available_days}天，是否赶得上由你判断。`);
  }
  return { errors, warnings, effective_shipping_days: effective, effective_presale_days: known(presale_days) ? presale_days : null, shipping_basis: window?.source ?? "not_applicable", shipping_days_source: window?.source ?? "not_applicable", fulfillment, fulfillment_confidence: FULFILLMENT_CONFIG.confidence, tier_inclusive: false, total_days: total, purchase_window: window };
}

/** 大众品类黑名单（命中即 warning，不硬错）。 */
export const GENERIC_CATEGORIES = Object.freeze([
  { id: "fragrance", zh: "香水/香氛/香薰蜡烛", terms: ["香水", "香氛", "香薰", "蜡烛", "精油", "diffuser"] },
  { id: "chocolate", zh: "巧克力/糖果", terms: ["巧克力", "糖果", "曲奇", "点心礼盒"] },
  { id: "drinkware", zh: "保温杯/马克杯/杯具", terms: ["保温杯", "马克杯", "水杯", "杯子", "随行杯"] },
  { id: "cosmetics", zh: "口红/彩妆/常规护肤礼盒", terms: ["口红", "彩妆", "化妆品", "护肤", "面霜", "面膜", "精华"] },
  { id: "flowers", zh: "鲜花/花束", terms: ["鲜花", "花束", "玫瑰", "向日葵"] },
  { id: "plush", zh: "毛绒玩偶/公仔", terms: ["毛绒玩偶", "毛绒玩具", "公仔", "抱枕", "玩偶"] },
  { id: "speaker", zh: "通用蓝牙音箱", terms: ["蓝牙音箱", "音箱", "蓝牙耳机"] },
  { id: "desk_plant", zh: "常规桌面绿植", terms: ["桌面绿植", "多肉", "绿植", "盆栽", "发财树", "龟背竹"] },
  { id: "calendar", zh: "台历/日历/相框", terms: ["台历", "日历", "相框", "摆件"] },
  { id: "generic_giftbox", zh: "通用礼盒/礼包", terms: ["通用礼盒", "大礼包", "伴手礼盒", "礼品卡", "购物卡"] },
]);

/** 空洞修饰词：三个候选都靠这些词撑场面，就说明是"按字段填空"。 */
const VAGUE_CONNECTORS = Object.freeze(["小物", "桌面", "简约", "基础", "常规", "通用", "组合", "礼盒", "套装", "实用小", "小件"]);

function textOfCandidate(item) {
  const parts = [];
  for (const field of ["name", "description", "reason", "presentation"]) {
    if (item && typeof item[field] === "string") parts.push(item[field]);
  }
  if (item && Array.isArray(item.inferences)) parts.push(item.inferences.filter((x) => typeof x === "string").join(" "));
  return parts.join(" ");
}

/** 单个候选的大众化/接地性 warning。 */
export function uniquenessWarningsFor(item, index) {
  const warnings = [];
  const path = `candidates[${index}]`;
  const name = norm(typeof item?.name === "string" ? item.name : "");
  const text = norm(textOfCandidate(item));
  for (const category of GENERIC_CATEGORIES) {
    const hit = category.terms.find((term) => text.includes(norm(term)));
    if (hit) {
      error(warnings, "TOO_GENERIC", `${path}.name`, `命中大众品类「${category.zh}」（“${hit}”）；建议改成更具体、更小众的东西与用法，或说明为什么非它不可`);
      break;
    }
  }
  /* 要求 2b：必须具体到「东西 + 用法/场景」，不能只给品类名。
     判据：名字里只有空洞修饰词（小物/桌面/简约/基础/通用/组合/套装…），
     且全文找不到任何用法或场景标记 ⇒ 视为"按字段填空"式产出。 */
  const vagueInName = VAGUE_CONNECTORS.filter((word) => name.includes(norm(word)));
  const scenarioMarkers = ["配合", "搭配", "用于", "场景", "适合", "一起", "场合", "上课", "体验课", "定制", "刻", "手工", "下班", "熬夜", "办公", "通勤", "旅行", "厨房", "阳台", "工位", "周末", "睡前"];
  if (vagueInName.length > 0 && !scenarioMarkers.some((marker) => text.includes(norm(marker)))) {
    error(warnings, "TOO_GENERIC", `${path}.name`, `只有「${vagueInName.join("、")}」这类笼统说法，缺少「东西 + 用法/场景」的具体落点`);
  }
  const refs = Array.isArray(item?.fact_refs) ? item.fact_refs.filter((x) => typeof x === "string" && x.trim()) : [];
  const inferences = Array.isArray(item?.inferences) ? item.inferences.filter((x) => typeof x === "string" && x.trim()) : [];
  if (refs.length === 0 && inferences.length === 0) {
    error(warnings, "NOT_GROUNDED", `${path}.fact_refs`, "该方案没有指回用户任何一条具体输入（事实引用与推断都为空）⇒ 换一个人也成立，不算独特");
  }
  return warnings;
}

/** 批次级同质性 warning。 */
export function homogeneousWarning(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length < 2) return [];
  const signatures = list.map((item) => {
    const text = norm(textOfCandidate(item));
    return GENERIC_CATEGORIES.filter((category) => category.terms.some((term) => text.includes(norm(term)))).map((category) => category.id);
  });
  const nonEmpty = signatures.filter((entry) => entry.length > 0);
  if (nonEmpty.length === list.length) {
    const key = (entry) => [...entry].sort().join(",");
    if (new Set(nonEmpty.map(key)).size === 1) {
      return [{ code: "HOMOGENEOUS_CANDIDATES", path: "candidates", message: "三个方案落在同一个大众品类里（同品类换皮），请拉开品类或形态差异" }];
    }
  }
  const vague = list.map((item) => VAGUE_CONNECTORS.filter((word) => norm(textOfCandidate(item)).includes(norm(word))));
  if (vague.every((entry) => entry.length > 0)) {
    const common = vague[0].filter((word) => vague.every((entry) => entry.includes(word)));
    const union = [...new Set(vague.flat())];
    return [{
      code: "HOMOGENEOUS_CANDIDATES",
      path: "candidates",
      message: common.length > 0
        ? `三个方案都只停留在「${common.join("、")}」这类空洞修饰上，缺乏可区分的具体形态`
        : `三个方案都只停留在「${union.join("、")}」这类笼统说法上（没有可指认的具体东西与用法），属于同质化输出`,
    }];
  }
  return [];
}

/**
 * 把独特性 warning 追加到既有的 candidate_results[].warnings 上（与 BELOW_BUDGET_RANGE 同一机制），
 * 并在 validation.warnings 里汇总一份便于前端与报告直接读。
 */
export function attachUniquenessWarnings(validation, candidates) {
  if (!validation || !Array.isArray(validation.candidate_results)) return validation;
  const items = Array.isArray(candidates) ? candidates : [];
  const all = [];
  validation.candidate_results.forEach((result, index) => {
    const found = uniquenessWarningsFor(items[index], index);
    result.warnings = [...(result.warnings ?? []), ...found];
    all.push(...found);
  });
  const homogeneous = homogeneousWarning(items);
  if (homogeneous.length) {
    for (const result of validation.candidate_results) result.warnings = [...(result.warnings ?? []), ...homogeneous];
    all.push(...homogeneous);
  }
  validation.warnings = [...(validation.warnings ?? []), ...all];
  return validation;
}

/* ------------------------------------------------------------------ 工具 */

/** NFKC + 大小写折叠（对齐 Python unicodedata.normalize("NFKC", v).casefold()）。 */
export function norm(value) {
  return value.normalize("NFKC").toLowerCase();
}

function tag(value) {
  return norm(value).trim();
}

function contentText(value) {
  return norm(value)
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(" ");
}

function stringValue(value) {
  return typeof value === "string";
}

/** 金额字符串 → 以分为单位的 BigInt；不合法返回 null（错误由 _amount 负责）。 */
export function amountToCents(value) {
  if (!stringValue(value) || !AMOUNT_RE.test(value)) return null;
  const [intPart, fracPart = ""] = value.split(".");
  const cents = BigInt(intPart) * 100n + BigInt((fracPart + "00").slice(0, 2));
  return cents;
}

function limits(value, path, errors) {
  const stack = [[value, path]];
  while (stack.length > 0) {
    const [item, current] = stack.pop();
    if (stringValue(item)) {
      if (codePointLength(item) > LIMITS.maxStringCodePoints) {
        error(errors, "LIMIT_EXCEEDED", current, "字段字符串超过 1000 个 Unicode 码点");
      }
    } else if (Array.isArray(item)) {
      if (item.length > LIMITS.maxArrayItems) {
        error(errors, "LIMIT_EXCEEDED", current, "业务数组超过 20 项");
      }
      for (let i = item.length - 1; i >= 0; i -= 1) {
        stack.push([item[i], `${current}[${i}]`]);
      }
    } else if (item !== null && typeof item === "object" && !(item instanceof JsonFloat)) {
      const keys = Object.keys(item);
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        stack.push([item[keys[i]], current ? `${current}.${keys[i]}` : keys[i]]);
      }
    }
  }
}

function required(obj, fields, path, errors) {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(obj, field)) {
      error(errors, "MISSING_FIELD", `${path}.${field}`, "缺少必填字段");
    }
  }
}

function text(value, path, errors, empty = false) {
  if (!stringValue(value) || (!empty && value.trim() === "")) {
    error(errors, "INVALID_TYPE", path, empty ? "必须为字符串" : "必须为非空字符串");
    return false;
  }
  return codePointLength(value) <= LIMITS.maxStringCodePoints;
}

function strings(value, path, errors) {
  if (!Array.isArray(value)) {
    error(errors, "INVALID_TYPE", path, "必须为字符串数组");
    return [];
  }
  return value.map((item, i) => (text(item, `${path}[${i}]`, errors) ? item : ""));
}

function amount(value, path, errors) {
  if (!stringValue(value)) {
    error(errors, "INVALID_TYPE", path, "金额必须为十进制字符串");
    return null;
  }
  if (!AMOUNT_RE.test(value)) {
    error(errors, "INVALID_AMOUNT", path, "金额必须为有限非负、至多两位小数的 ASCII 十进制字符串");
    return null;
  }
  if (codePointLength(value) > LIMITS.maxStringCodePoints) return null;
  return amountToCents(value);
}

/** 天数字段：只接受非负 JSON 整数（float / bool / 字符串都拒绝，与 Python 一致）。 */
function days(value, path, errors) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value instanceof JsonFloat) {
    error(errors, "INVALID_TYPE", path, "天数必须为非负 JSON 整数，不能为布尔值");
    return null;
  }
  return value;
}

export function checkBudgetRange(value, path, errors, mode = undefined) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || value instanceof JsonFloat ||
      Object.keys(value).some((key) => !["min", "max"].includes(key))) {
    error(errors, "INVALID_BUDGET_RANGE", path, "预算区间须为仅含 min、max 的对象");
    return null;
  }
  const start = errors.length;
  const amounts = ["min", "max"].map((key) => {
    const endpoint = `${path}.${key}`;
    if (!Object.hasOwn(value, key)) {
      error(errors, "INVALID_BUDGET_RANGE", endpoint, "预算区间两端均须填写");
      return null;
    }
    if (typeof value[key] === "string" && codePointLength(value[key]) > 1000) {
      error(errors, "LIMIT_EXCEEDED", endpoint, "字段字符串超过 1000 个 Unicode 码点");
      return null;
    }
    const parsed = amount(value[key], endpoint, errors);
    if (parsed !== null && parsed > 1000000n) {
      error(errors, "LIMIT_EXCEEDED", endpoint, "预算区间端点须在 0 至 10000 之间");
    }
    return parsed;
  });
  if (errors.length !== start) return null;
  const [low, high] = amounts;
  if (low > high) {
    error(errors, "INVALID_BUDGET_RANGE", path, "预算区间下限不能超过上限");
    return null;
  }
  if (mode !== undefined) {
    const modePath = path.slice(0, path.lastIndexOf(".")) + ".budget_mode";
    if (typeof mode !== "string" || !["slider", "zero", "other"].includes(mode)) {
      error(errors, "INVALID_BUDGET_RANGE", modePath, "预算模式须为 slider、zero 或 other");
      return null;
    }
    if (mode === "slider" && (high > 100000n || low % 5000n !== 0n || high % 5000n !== 0n)) {
      error(errors, "INVALID_BUDGET_RANGE", path, "滑条两端须在 0 至 1000 之间，步长为 50 元");
      return null;
    }
    if (mode === "zero" && (low !== 0n || high !== 0n)) {
      error(errors, "INVALID_BUDGET_RANGE", path, "不花钱模式的预算两端均须为 0");
      return null;
    }
  }
  return amounts;
}

/** 严格 JSON 字符串解析（对齐 validator 的 _parse）。 */
function parseJson(raw, path, errors, strictParseFn) {
  if (typeof raw !== "string") {
    error(errors, "INVALID_TYPE", path, "接口输入必须为 JSON 字符串");
    return undefined;
  }
  try {
    return strictParseFn(raw, LIMITS.requestBytes);
  } catch (err) {
    const code = /字节上限/.test(String(err.message)) ? "LIMIT_EXCEEDED" : "INVALID_JSON";
    error(
      errors,
      code,
      path,
      code === "LIMIT_EXCEEDED" ? "JSON 参数超过 32768 UTF-8 字节上限" : "JSON 无效，可能含重复键、非标准常量或嵌套过深",
    );
    return undefined;
  }
}

/* --------------------------------------------------------------- request */

function request(request, errors) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    error(errors, "INVALID_REQUEST", "request", "请求根节点必须为对象");
    return null;
  }
  limits(Object.fromEntries(Object.entries(request).filter(([key]) => key !== "budget_range")), "request", errors);
  required(request, ["recipient_relation", "occasion", "budget_amount", "currency", "available_days"], "request", errors);
  for (const field of ["recipient_relation", "occasion", "currency", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      text(request[field], `request.${field}`, errors, field === "notes");
    }
  }
  for (const field of ["recipient_relation_custom", "occasion_custom"]) {
    if (Object.hasOwn(request, field) && request[field] !== null) {
      text(request[field], `request.${field}`, errors);
    }
  }
  const interval = Object.hasOwn(request, "budget_range") ? checkBudgetRange(request.budget_range, "request.budget_range", errors) : null;
  const budget = Object.prototype.hasOwnProperty.call(request, "budget_amount")
    ? amount(request.budget_amount, "request.budget_amount", errors)
    : null;
  const availableDays = Object.prototype.hasOwnProperty.call(request, "available_days")
    ? days(request.available_days, "request.available_days", errors)
    : null;
  // 请求侧范围**只在调用点**检查：amount()/days() 与候选侧共用，范围约束不得进入共用函数
  // （对齐 validator/rules.py:131-134 的同名注释与判定位置）。
  // amount() 返回**分**（BigInt），故区间以分书写：1 元 = 100n，10000 元 = 1000000n。
  // 仅在 amount()/days() 成功（非 null）时判定，与 Python 的 `is not None` 守卫一致；
  // 放在货币检查之前，以保持与 Python 完全相同的错误顺序。
  if (budget !== null && budget > 1000000n) {
    error(errors, "LIMIT_EXCEEDED", "request.budget_amount", "预算须在 0 至 10000 之间");
  } else if (interval !== null && budget !== null && budget !== interval[1]) {
    error(errors, "BUDGET_RANGE_MISMATCH", "request.budget_amount", "预算上限须与区间 max 数值一致");
  }
  if (availableDays !== null && availableDays > 365) {
    error(errors, "LIMIT_EXCEEDED", "request.available_days", "可用天数须在 0 至 365 天之间");
  }
  if (stringValue(request.currency) && request.currency !== "CNY") {
    error(errors, "UNSUPPORTED_CURRENCY", "request.currency", "首版仅支持 CNY，不执行换汇");
  }
  const facts = Object.prototype.hasOwnProperty.call(request, "facts") ? request.facts : [];
  const factIds = new Set();
  if (!Array.isArray(facts)) {
    error(errors, "INVALID_TYPE", "request.facts", "事实必须为对象数组");
  } else {
    facts.forEach((fact, i) => {
      const path = `request.facts[${i}]`;
      if (fact === null || typeof fact !== "object" || Array.isArray(fact)) {
        error(errors, "INVALID_TYPE", path, "事实必须为对象");
        return;
      }
      required(fact, ["id", "text"], path, errors);
      for (const field of ["id", "text"]) {
        if (Object.prototype.hasOwnProperty.call(fact, field) && text(fact[field], `${path}.${field}`, errors) && field === "id") {
          if (factIds.has(fact[field])) error(errors, "DUPLICATE_ID", `${path}.id`, "事实 ID 不得重复");
          factIds.add(fact[field]);
        }
      }
    });
  }
  const forbiddenTags = strings(
    Object.prototype.hasOwnProperty.call(request, "forbidden_tags") ? request.forbidden_tags : [],
    "request.forbidden_tags",
    errors,
  );
  const forbiddenTerms = strings(
    Object.prototype.hasOwnProperty.call(request, "forbidden_terms") ? request.forbidden_terms : [],
    "request.forbidden_terms",
    errors,
  );
  forbiddenTags.forEach((item, i) => {
    if (item && !TAGS.has(tag(item))) {
      error(errors, "UNKNOWN_TAG", `request.forbidden_tags[${i}]`, "未知禁忌标签，请确认禁忌类别");
    }
  });
  if (errors.length > 0) return null;
  return {
    budget,
    budgetMin: interval !== null ? interval[0] : null,
    days: availableDays,
    factIds,
    forbiddenTags: new Set(forbiddenTags.map(tag)),
    forbiddenTerms: forbiddenTerms.map(norm),
    currency: request.currency,
  };
}

/* ------------------------------------------------------------- candidate */

function candidate(item, index, context) {
  const path = `candidates[${index}]`;
  const errors = [];
  const result = { id: null, passed: false, errors, warnings: [] };
  limits(item, path, errors);
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    error(errors, "INVALID_TYPE", path, "候选必须为对象");
    return result;
  }
  required(
    item,
    [
      "id",
      "name",
      "description",
      "estimated_total",
      "currency",
      "estimated_preparation_days",
      "tags",
      "reason",
      "fact_refs",
      "inferences",
      "unknowns",
    ],
    path,
    errors,
  );
  const texts = [];
  for (const field of ["name", "description", "currency", "reason", "presentation"]) {
    if (Object.prototype.hasOwnProperty.call(item, field) && text(item[field], `${path}.${field}`, errors)) {
      if (["name", "description", "reason", "presentation"].includes(field)) {
        texts.push([`${path}.${field}`, item[field]]);
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(item, "id")) {
    const cid = item.id;
    if (!stringValue(cid)) {
      error(errors, "INVALID_TYPE", `${path}.id`, "候选 ID 必须为字符串");
    } else {
      result.id = cid;
      if (!["c1", "c2", "c3"].includes(cid)) {
        error(errors, "INVALID_CANDIDATE_ID", `${path}.id`, "候选 ID 必须为 c1、c2 或 c3，区分大小写");
      }
    }
  }
  const total = Object.prototype.hasOwnProperty.call(item, "estimated_total")
    ? amount(item.estimated_total, `${path}.estimated_total`, errors)
    : null;
  const prep = Object.prototype.hasOwnProperty.call(item, "estimated_preparation_days")
    ? days(item.estimated_preparation_days, `${path}.estimated_preparation_days`, errors)
    : null;
  const arrays = {};
  for (const field of ["tags", "fact_refs", "inferences", "unknowns"]) {
    arrays[field] = Object.prototype.hasOwnProperty.call(item, field) ? strings(item[field], `${path}.${field}`, errors) : [];
  }
  if (Array.isArray(item.tags) && item.tags.length === 0) {
    error(errors, "INVALID_TYPE", `${path}.tags`, "候选类别至少需要一个已知标签");
  }
  arrays.tags.forEach((item2, j) => {
    if (item2 && !TAGS.has(tag(item2))) {
      error(errors, "UNKNOWN_TAG", `${path}.tags[${j}]`, "未知候选标签，请使用约定类别");
    }
  });
  arrays.inferences.forEach((item2, j) => {
    if (item2) texts.push([`${path}.inferences[${j}]`, item2]);
  });
  if (context !== null) {
    if (total !== null && total > context.budget) {
      error(errors, "OVER_BUDGET", `${path}.estimated_total`, "估算总费用超过预算");
    }
    if (total !== null && context.budgetMin !== null && total < context.budgetMin) {
      error(result.warnings, "BELOW_BUDGET_RANGE", `${path}.estimated_total`, "礼物估价低于预算区间下限，仍可选择");
    }
    if (prep !== null && prep > context.days) {
      error(errors, "PREPARATION_TOO_LONG", `${path}.estimated_preparation_days`, "估算准备时间超过可用天数");
    }
    if (stringValue(item.currency) && item.currency !== context.currency) {
      error(errors, "CURRENCY_MISMATCH", `${path}.currency`, "候选币种与请求币种不一致，不执行换汇");
    }
    arrays.tags.forEach((item2, j) => {
      if (item2 && context.forbiddenTags.has(tag(item2))) {
        error(errors, "FORBIDDEN_TAG", `${path}.tags[${j}]`, "候选包含明确禁止的类别");
      }
    });
    arrays.fact_refs.forEach((ref, j) => {
      if (ref && !context.factIds.has(ref)) {
        error(errors, "UNKNOWN_FACT_REF", `${path}.fact_refs[${j}]`, "引用的事实 ID 不存在于原始请求");
      }
    });
    for (const [textPath, value] of texts) {
      if (context.forbiddenTerms.some((term) => norm(value).includes(term))) {
        error(errors, "FORBIDDEN_TERM", textPath, "文本包含明确禁止的字面词");
      }
    }
  }
  return result;
}

function batch(value, context, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    error(errors, "INVALID_TYPE", "candidates", "候选根节点必须为对象");
    return [];
  }
  const rest = {};
  for (const key of Object.keys(value)) {
    if (key !== "candidates") rest[key] = value[key];
  }
  limits(rest, "", errors);
  if (!Object.prototype.hasOwnProperty.call(value, "candidates")) {
    error(errors, "MISSING_FIELD", "candidates", "缺少候选数组");
    return [];
  }
  const items = value.candidates;
  if (!Array.isArray(items)) {
    error(errors, "INVALID_TYPE", "candidates", "候选必须为数组");
    return [];
  }
  if (items.length !== LIMITS.candidatesPerBatch) {
    error(errors, "INVALID_CANDIDATE_COUNT", "candidates", "必须恰好提供三个候选");
  }
  const results = items.map((item, i) => candidate(item, i, context));
  const seen = new Set();
  const contents = new Map();
  items.forEach((item, i) => {
    const cid = results[i].id;
    if (stringValue(cid)) {
      if (seen.has(cid)) error(errors, "DUPLICATE_ID", `candidates[${i}].id`, "候选 ID 不得重复");
      seen.add(cid);
    }
    if (
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      ["name", "description"].every(
        (f) => stringValue(item[f]) && item[f].trim() !== "" && codePointLength(item[f]) <= LIMITS.maxStringCodePoints,
      )
    ) {
      const key = ["name", "description"].map((f) => contentText(item[f])).join("|");
      if (!contents.has(key)) contents.set(key, []);
      contents.get(key).push(i);
    }
  });
  for (const indices of contents.values()) {
    const ids = new Set(indices.map((i) => results[i].id).filter((id) => id !== null));
    if (ids.size > 1) {
      for (const i of indices) {
        error(results[i].errors, "DUPLICATE_CANDIDATE_CONTENT", `candidates[${i}]`, "不同候选的名称和描述标准化后重复");
      }
    }
  }
  for (const result of results) {
    result.passed = context !== null && result.errors.length === 0;
  }
  return results;
}

/**
 * 公开接口，与 validator/rules.py 的 validate() 同形同义。
 * @param {string} requestJson
 * @param {string} candidatesJson
 * @param {(raw: string, maxBytes?: number) => any} strictParseFn
 */
export function validate(requestJson, candidatesJson, strictParseFn) {
  const result = {
    status: "failed",
    all_passed: false,
    errors: [],
    candidate_results: [],
    business_data_verification: "not_verified",
  };
  try {
    const requestErrors = [];
    const batchErrors = [];
    const parsedRequest = parseJson(requestJson, "request_json", requestErrors, strictParseFn);
    const parsedBatch = parseJson(candidatesJson, "candidates_json", batchErrors, strictParseFn);
    const context = parsedRequest !== undefined ? request(parsedRequest, requestErrors) : null;
    if (parsedBatch !== undefined) {
      result.candidate_results = batch(parsedBatch, context, batchErrors);
    }
    result.errors = [...requestErrors, ...batchErrors];
    if (result.errors.some((e) => e.code === "INVALID_JSON")) {
      result.status = "error";
      for (const item of result.candidate_results) item.passed = false;
    } else if (requestErrors.length > 0) {
      result.status = "needs_input";
    } else if (
      batchErrors.length === 0 &&
      result.candidate_results.length === LIMITS.candidatesPerBatch &&
      result.candidate_results.every((item) => item.passed)
    ) {
      result.status = "passed";
      result.all_passed = true;
    }
  } catch (err) {
    return {
      status: "error",
      all_passed: false,
      errors: [{ code: "INTERNAL_ERROR", path: "$", message: "暂时无法完成检查，请稍后重试" }],
      candidate_results: [],
      business_data_verification: "not_verified",
    };
  }
  return result;
}

/** 纯请求检查，用于把「输入问题」与「候选问题」分开（对齐 workflow/runtime.py:14）。 */
export function validateRequestOnly(requestJson, strictParseFn) {
  return validate(requestJson, "{}", strictParseFn);
}

export function requestIsValid(requestCheck) {
  return (
    requestCheck.status === "failed" &&
    !requestCheck.errors.some((e) => e.path.startsWith("request") || e.code === "INTERNAL_ERROR")
  );
}

/** 服务端时间策略：保留原始规则结果，仅把准备超期降为提示。
 * 字段缺失、类型错误、预算与批次错误仍是硬错误；不修改 Python/JS 镜像规则。
 */
export function withTimeAdvisories(raw) {
  const result = structuredClone(raw);
  result.raw_validation = structuredClone(raw);
  const soften = (item) => {
    const timed = item.errors.filter((e) => e.code === "PREPARATION_TOO_LONG" &&
      /^(?:candidates\[\d+\]\.estimated_preparation_days|presentation\.revised_estimated_preparation_days)$/.test(e.path));
    item.errors = item.errors.filter((e) => !timed.includes(e));
    item.warnings = [...(item.warnings ?? []), ...timed.map((e) => ({ ...e, message: "估算准备时间超过你的计划时间，是否合适由你判断。" }))];
    return timed.length;
  };
  if (Array.isArray(result.candidate_results)) {
    for (const item of result.candidate_results) {
      if (soften(item)) item.passed = item.errors.length === 0 && result.errors.length === 0;
    }
    result.all_passed = result.errors.length === 0 && result.candidate_results.length === LIMITS.candidatesPerBatch && result.candidate_results.every((item) => item.passed);
    if (!["error", "needs_input"].includes(result.status)) result.status = result.all_passed ? "passed" : "failed";
  } else if (soften(result)) {
    result.passed = result.errors.length === 0;
  }
  return result;
}

/* ------------------------------------------------- 呈现阶段复核（P3，本层新增） */

/**
 * 复核选后呈现内容：必填结构、费用算术、全量总费用、准备时间、禁忌。
 * 不修改任何用户约束，也不因为包装「换简单一点」就放过超支。
 */
function checkLegacyPresentation(request, candidate, presentation) {
  const errors = [];
  const ctx = request && typeof request === "object" ? request : {};
  const budget = amountToCents(ctx.budget_amount);
  const availableDays = typeof ctx.available_days === "number" ? ctx.available_days : null;
  const forbiddenTags = new Set((Array.isArray(ctx.forbidden_tags) ? ctx.forbidden_tags : []).map(tag));
  const forbiddenTerms = (Array.isArray(ctx.forbidden_terms) ? ctx.forbidden_terms : []).map(norm);

  if (presentation === null || typeof presentation !== "object" || Array.isArray(presentation)) {
    error(errors, "PRESENTATION_INVALID", "presentation", "呈现内容必须为对象");
    return { passed: false, errors };
  }
  limits(presentation, "presentation", errors);

  const packaging = presentation.packaging;
  if (packaging === null || typeof packaging !== "object" || Array.isArray(packaging)) {
    error(errors, "PRESENTATION_INVALID", "presentation.packaging", "缺少包装材料结构");
    return { passed: false, errors };
  }
  const materials = strings(packaging.materials, "presentation.packaging.materials", errors);
  const steps = strings(packaging.steps, "presentation.packaging.steps", errors);
  const palette = strings(packaging.color_palette, "presentation.packaging.color_palette", errors);
  const materialTags = strings(
    Object.prototype.hasOwnProperty.call(packaging, "material_tags") ? packaging.material_tags : [],
    "presentation.packaging.material_tags",
    errors,
  );
  if (materials.filter(Boolean).length === 0 && steps.filter(Boolean).length === 0 && palette.filter(Boolean).length === 0) {
    error(errors, "PRESENTATION_INVALID", "presentation.packaging", "包装材料、步骤、配色至少提供一项");
  }
  if (!text(presentation.card_text, "presentation.card_text", errors)) {
    // 错误已记录
  }
  const advice = presentation.giving_advice;
  if (advice === null || typeof advice !== "object" || Array.isArray(advice)) {
    error(errors, "PRESENTATION_INVALID", "presentation.giving_advice", "缺少赠送时机与话术");
  } else {
    text(advice.timing, "presentation.giving_advice.timing", errors);
    text(advice.wording, "presentation.giving_advice.wording", errors);
    strings(
      Object.prototype.hasOwnProperty.call(advice, "relationship_cautions") ? advice.relationship_cautions : [],
      "presentation.giving_advice.relationship_cautions",
      errors,
    );
  }
  strings(presentation.unknowns, "presentation.unknowns", errors);

  const additional = amount(presentation.additional_cost, "presentation.additional_cost", errors);
  const revisedTotal = amount(presentation.revised_estimated_total, "presentation.revised_estimated_total", errors);
  const originalTotal = amountToCents(candidate.estimated_total);
  if (additional !== null && revisedTotal !== null && originalTotal !== null && additional + originalTotal !== revisedTotal) {
    error(errors, "TOTAL_MISMATCH", "presentation.revised_estimated_total", "修订后总费用必须等于原估算加新增费用，不能通过下调原价腾出预算");
  }
  if (revisedTotal !== null && budget !== null && revisedTotal > budget) {
    error(errors, "OVER_BUDGET", "presentation.revised_estimated_total", "礼物、包装、贺卡、装饰与配送的全量估算超过预算上限");
  }
  if (stringValue(presentation.currency) && presentation.currency !== "CNY") {
    error(errors, "UNSUPPORTED_CURRENCY", "presentation.currency", "首版仅支持 CNY，不执行换汇");
  }
  const revisedDays = days(presentation.revised_estimated_preparation_days, "presentation.revised_estimated_preparation_days", errors);
  if (revisedDays !== null && availableDays !== null && revisedDays > availableDays) {
    error(errors, "PREPARATION_TOO_LONG", "presentation.revised_estimated_preparation_days", "完整方案准备时间超过可用天数");
  }
  materialTags.forEach((item, i) => {
    if (item && forbiddenTags.has(tag(item))) {
      error(errors, "FORBIDDEN_TAG", `presentation.packaging.material_tags[${i}]`, "包装或装饰材料触发明确禁忌类别");
    }
  });
  const scanned = [
    ...materials.map((v, i) => [`presentation.packaging.materials[${i}]`, v]),
    ...steps.map((v, i) => [`presentation.packaging.steps[${i}]`, v]),
    [ "presentation.card_text", stringValue(presentation.card_text) ? presentation.card_text : "" ],
    [ "presentation.giving_advice.wording", advice && stringValue(advice.wording) ? advice.wording : "" ],
  ];
  for (const [path, value] of scanned) {
    if (value && forbiddenTerms.some((term) => norm(value).includes(term))) {
      error(errors, "FORBIDDEN_TERM", path, "呈现内容触发明令禁止的字面词");
    }
  }
  return { passed: errors.length === 0, errors };
}

/** 新版只复核冻结礼物价；呈现不得携带任何报价或旧包装教程。 */
export function checkPresentation(requestData, selectedCandidate, presentation) {
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonFloat);
  if (!object(presentation)) {
    return { passed: false, errors: [{ code: "PRESENTATION_INVALID", path: "presentation", message: "呈现内容必须为对象" }] };
  }
  const v2 = presentation.contract_version === CONTRACT_VERSION;
  if (!v2) {
    if (Object.hasOwn(presentation, "contract_version") || Object.hasOwn(presentation, "style") || requestData?.contract_version === CONTRACT_VERSION) {
      return { passed: false, errors: [{ code: "PRESENTATION_INVALID", path: "presentation.contract_version", message: "请使用明确的新版呈现契约，不能混读新旧结构" }] };
    }
    return checkLegacyPresentation(requestData, selectedCandidate, presentation);
  }
  const errors = [];
  const invalid = (path, message) => error(errors, "PRESENTATION_INVALID", path, message);
  const shape = (value, path, keys, optional = []) => {
    if (!object(value)) {
      invalid(path, "须为符合新版呈现契约的对象");
      return false;
    }
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, "缺少新版呈现必填字段");
    }
    for (const key of Object.keys(value)) {
      if (![...keys, ...optional].includes(key)) invalid(`${path}.${key}`, "新版呈现不接收此字段或任何报价、旧包装教程");
    }
    return true;
  };
  const string = (value, path) => {
    if (typeof value !== "string" || !value.trim()) invalid(path, "须为非空呈现文本");
  };
  const list = (value, path, nonempty = false) => {
    if (!Array.isArray(value) || (nonempty && value.length === 0)) {
      invalid(path, nonempty ? "至少需要一种包装色调" : "须为呈现文本数组，可为空");
      return;
    }
    value.forEach((v, i) => string(v, `${path}[${i}]`));
  };
  limits(presentation, "presentation", errors);
  shape(presentation, "presentation", ["contract_version", "style", "packaging", "card_text", "giving_advice", "unknowns", "currency", "revised_estimated_preparation_days"], ["selected_candidate_id"]);
  string(presentation.style, "presentation.style");
  string(presentation.card_text, "presentation.card_text");
  string(presentation.currency, "presentation.currency");
  if (shape(presentation.packaging, "presentation.packaging", ["color_palette"])) {
    list(presentation.packaging.color_palette, "presentation.packaging.color_palette", true);
  }
  if (shape(presentation.giving_advice, "presentation.giving_advice", ["timing", "wording", "relationship_cautions"])) {
    string(presentation.giving_advice.timing, "presentation.giving_advice.timing");
    string(presentation.giving_advice.wording, "presentation.giving_advice.wording");
    list(presentation.giving_advice.relationship_cautions, "presentation.giving_advice.relationship_cautions");
  }
  list(presentation.unknowns, "presentation.unknowns");
  if (Object.hasOwn(presentation, "selected_candidate_id") && presentation.selected_candidate_id !== selectedCandidate?.id) {
    invalid("presentation.selected_candidate_id", "呈现须对应用户选中的冻结候选");
  }
  const context = request(requestData, errors);
  const checkedGift = candidate(selectedCandidate, 0, context);
  errors.push(...checkedGift.errors);
  if (typeof presentation.currency === "string" && presentation.currency !== "CNY") {
    error(errors, "UNSUPPORTED_CURRENCY", "presentation.currency", "首版仅支持 CNY，不执行换汇");
  }
  const prepared = days(presentation.revised_estimated_preparation_days, "presentation.revised_estimated_preparation_days", errors);
  if (context !== null) {
    if (prepared !== null && prepared > context.days) {
      error(errors, "PREPARATION_TOO_LONG", "presentation.revised_estimated_preparation_days", "完整方案准备时间超过可用天数");
    }
    const texts = Object.fromEntries(Object.entries(presentation).filter(([key]) => !["contract_version", "currency", "selected_candidate_id", "revised_estimated_preparation_days"].includes(key)));
    const stack = [[texts, "presentation"]];
    while (stack.length) {
      const [value, path] = stack.pop();
      if (typeof value === "string") {
        if (context.forbiddenTerms.some((term) => norm(value).includes(term))) {
          error(errors, "FORBIDDEN_TERM", path, "呈现内容触发明令禁止的字面词");
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => stack.push([v, `${path}[${i}]`]));
      } else if (object(value)) {
        Object.entries(value).forEach(([key, v]) => stack.push([v, `${path}.${key}`]));
      }
    }
  }
  return { passed: errors.length === 0, errors, warnings: checkedGift.warnings };
}

/* ------------------------------------------------------------------ 履约方式 */

/**
 * 履约方式取值与追溯（受控枚举，不接受自由文本）。
 *
 * ⚠️ 为什么**不**把「缺失」做成硬错误：mock 数据与既有冻结契约里没有这个字段，
 * 硬错会让历史用例整体失败。这里按**最保守**的方式处理：缺失 ⇒ 当作 `online`
 * （一定涉及快递），并记一条 warning 如实说明「按保守值处理」。
 * 真实链路（llm/dify）的提示词里这个字段是必填。
 */
export function fulfillmentOf(item, index = 0) {
  const errors = [];
  const warnings = [];
  const path = `candidates[${index}].fulfillment`;
  const raw = item?.fulfillment;
  if (raw === undefined || raw === null || raw === '') {
    error(warnings, 'FULFILLMENT_MISSING', path, '未标注履约方式，已按最保守的 online（涉及快递）处理；真实链路里该字段应为必填枚举 offline/online/experience');
    return { value: FULFILLMENT_CONFIG.default, confidence: FULFILLMENT_CONFIG.confidence, missing: true, errors, warnings };
  }
  if (typeof raw !== 'string' || !FULFILLMENT_CONFIG.values.includes(raw)) {
    error(errors, 'FULFILLMENT_INVALID', path, `履约方式只能是 offline / online / experience 三者之一，收到 ${JSON.stringify(raw)}（不接受自由文本）`);
    return { value: FULFILLMENT_CONFIG.default, confidence: FULFILLMENT_CONFIG.confidence, missing: false, errors, warnings };
  }
  return { value: raw, confidence: FULFILLMENT_CONFIG.confidence, missing: false, errors, warnings };
}

/** 体验/线下类不得暗示已有恋爱关系（追求对象场景尤其明显，例如「情侣手作课」）。 */
export function relationAssumptionErrors(item, index = 0, { relation_id = null } = {}) {
  const errors = [];
  if (relation_id !== 'pursuit') return errors;
  const text = norm(textOfCandidate(item));
  const hit = ['情侣', '恋人专属', '情侣款', '夫妻', '我们俩的纪念'].find((word) => text.includes(norm(word)));
  if (hit) {
    error(errors, 'RELATION_ASSUMPTION_IN_CANDIDATE', `candidates[${index}].name`, `追求对象场景不得出现「${hit}」这类假定已有恋爱关系的表述`);
  }
  return errors;
}

/**
 * 履约相关措辞红线：⛔ 不许把「推测可得」说成「已确认」。
 * 返回 error（不是 warning）：这是**如实性**问题，不允许用措辞蒙混过去。
 */
export function fulfillmentWordingErrors(presentation, { path = 'presentation' } = {}) {
  const errors = [];
  const text = norm(JSON.stringify(presentation ?? {}));
  const hit = FULFILLMENT_CONFIG.forbidden_wording.find((word) => text.includes(norm(word)));
  if (hit) {
    error(errors, 'FULFILLMENT_WORDING_UNVERIFIED', path, `出现了无法核验的措辞「${hit}」：没有门店库存与排课接口，只能说「可以去商店购买」「需预约 / 可预约体验」`);
  }
  return errors;
}
