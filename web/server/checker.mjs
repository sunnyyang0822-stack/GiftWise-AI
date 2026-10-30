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
import { LIMITS } from "./config.mjs";

const AMOUNT_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/;

export function error(errors, code, path, message) {
  errors.push({ code, path, message });
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
  limits(request, "request", errors);
  required(request, ["recipient_relation", "occasion", "budget_amount", "currency", "available_days"], "request", errors);
  for (const field of ["recipient_relation", "occasion", "currency", "notes"]) {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      text(request[field], `request.${field}`, errors, field === "notes");
    }
  }
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
  if (budget !== null && (budget < 100n || budget > 1000000n)) {
    error(errors, "LIMIT_EXCEEDED", "request.budget_amount", "预算须在 1 至 10000 之间");
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

/* ------------------------------------------------- 呈现阶段复核（P3，本层新增） */

/**
 * 复核选后呈现内容：必填结构、费用算术、全量总费用、准备时间、禁忌。
 * 不修改任何用户约束，也不因为包装「换简单一点」就放过超支。
 */
export function checkPresentation(request, candidate, presentation) {
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
