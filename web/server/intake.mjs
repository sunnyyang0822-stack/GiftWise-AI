/**
 * 三步输入的确定性适配（JS 侧镜像，对齐 workflow/intake.py 的 adapt_intake）。
 *
 * 职责：把浏览器提交的 intake 字段整理成不可变 request_json，不调用模型、
 * 不推断预算与天数、不生成事实；unknown 只表示「待澄清」，不是推荐输入。
 *
 * 与参考实现的语义一致性由 web/tools/parity-check.mjs 在实际样例上比对。
 * 前端提交的派生字段（facts / available_days / repair_count / passed 等）都会被
 * INTAKE_UNKNOWN_FIELD 拒绝——这正是「浏览器不能篡改可信状态」的第一道闸门。
 *
 * 本层新增（相对 Python 参考实现）：
 *   - 关系 `pursuit` 的契约闸门 PURSUIT_CONTRACT_READY（见 config.mjs）。
 *     未落地时返回 PURSUIT_CONTRACT_NOT_READY 并拒绝，绝不做关系改写。
 */

import { strictParse, dump, byteLength } from "./jsonstrict.mjs";
import { RELATIONS_FULL, CLOSENESS_TABLE, OCCASION_TABLE, INTEREST_TABLE, GIFT_STYLE_TABLE, EXCLUSION_TABLE } from "./labels.mjs";
import { LIMITS, PURSUIT_CONTRACT_READY, PURSUIT_NOT_READY_MESSAGE } from "./config.mjs";
import { validate, checkBudgetRange, CONTRACT_VERSION, amountToCents } from "./checker.mjs";

export const INTAKE_FIELDS = new Set([
  "recipient_relation",
  "recipient_relation_custom",
  "closeness",
  "occasion",
  "occasion_custom",
  "budget_amount",
  "currency",
  "deadline_days",
  "interests",
  "interest_confidence",
  "gift_styles",
  "hard_exclusions",
  "additional_context",
  "contract_version", "budget_mode", "budget_range", "dislikes", "previous_gifts",
]);

/**
 * @param {string} intakeJson 严格 JSON 字符串
 * @param {{pursuitReady?: boolean}} [options]
 * @returns {{status: "ready"|"needs_input", errors: Array<{code:string,path:string,message:string}>, request_json: string|null}}
 */
export function adaptIntake(intakeJson, options = {}) {
  const pursuitReady = options.pursuitReady === undefined ? PURSUIT_CONTRACT_READY : Boolean(options.pursuitReady);
  const errors = [];
  const err = (code, path, message) => errors.push({ code, path, message });

  let data;
  try {
    data = strictParse(intakeJson, LIMITS.intakeBytes);
  } catch (e) {
    return {
      status: "needs_input",
      errors: [{ code: "INTAKE_INVALID_JSON", path: "intake", message: "输入须为不超过 32768 UTF-8 字节的严格 JSON 对象" }],
      request_json: null,
    };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {
      status: "needs_input",
      errors: [{ code: "INVALID_TYPE", path: "intake", message: "输入根节点须为对象" }],
      request_json: null,
    };
  }

  for (const key of Object.keys(data)) {
    if (!INTAKE_FIELDS.has(key)) err("INTAKE_UNKNOWN_FIELD", `intake.${key}`, "未声明的输入字段，请确认契约版本");
  }
  const revised = ["contract_version", "budget_mode", "budget_range"].some((key) => Object.hasOwn(data, key));
  const requiredFields = revised ? ["recipient_relation", "occasion", "currency", "deadline_days"] : ["recipient_relation", "occasion", "budget_amount", "currency", "deadline_days"];
  for (const key of requiredFields) {
    if (!(key in data) || data[key] === null) {
      err("INTAKE_CLARIFICATION_REQUIRED", `intake.${key}`, "请补充明确的关系、场合、预算上限、币种及可用天数");
    }
  }
  let budget = Object.hasOwn(data, "budget_amount") ? data.budget_amount : null;
  const budgetErrors = [];
  if (revised) {
    if (!Object.hasOwn(data, "contract_version")) {
      err("INTAKE_CLARIFICATION_REQUIRED", "intake.contract_version", "请提供新版输入契约版本");
    } else if (typeof data.contract_version !== "string") {
      err("INVALID_TYPE", "intake.contract_version", "契约版本须为字符串");
    } else if (data.contract_version !== CONTRACT_VERSION) {
      err("INTAKE_UNKNOWN_LABEL", "intake.contract_version", "不支持此输入契约版本");
    }
    const interval = checkBudgetRange(Object.hasOwn(data, "budget_range") ? data.budget_range : null,
      "intake.budget_range", budgetErrors, Object.hasOwn(data, "budget_mode") ? data.budget_mode : null);
    if (interval !== null) {
      if (Object.hasOwn(data, "budget_amount")) {
        const scalar = amountToCents(budget);
        if (typeof budget !== "string") {
          budgetErrors.push({ code: "INVALID_TYPE", path: "intake.budget_amount", message: "金额必须为十进制字符串" });
        } else if (scalar === null) {
          budgetErrors.push({ code: "INVALID_AMOUNT", path: "intake.budget_amount", message: "金额必须为有限非负、至多两位小数的 ASCII 十进制字符串" });
        } else if ([...budget].length > 1000) {
          budgetErrors.push({ code: "LIMIT_EXCEEDED", path: "intake.budget_amount", message: "字段字符串超过 1000 个 Unicode 码点" });
        } else if (scalar > 1000000n) {
          budgetErrors.push({ code: "LIMIT_EXCEEDED", path: "intake.budget_amount", message: "预算须在 0 至 10000 之间" });
        } else if (scalar !== interval[1]) {
          budgetErrors.push({ code: "BUDGET_RANGE_MISMATCH", path: "intake.budget_amount", message: "预算上限须与区间 max 数值一致" });
        }
      } else {
        budget = data.budget_range.max;
      }
    }
    errors.push(...budgetErrors);
  }
  const dislikes = Object.hasOwn(data, "dislikes") ? data.dislikes : "";
  if (typeof dislikes !== "string") {
    err("INVALID_TYPE", "intake.dislikes", "不喜欢的东西须为字符串，可为空");
  } else if ([...dislikes].length > 1000) {
    err("LIMIT_EXCEEDED", "intake.dislikes", "不喜欢的东西最多 1000 个 Unicode 码点");
  }

  let previousGifts = Object.hasOwn(data, "previous_gifts") ? data.previous_gifts : "";
  if (typeof previousGifts !== "string") {
    err("INVALID_TYPE", "intake.previous_gifts", "以前送过什么须为字符串，可为空");
  } else if ([...previousGifts].length > 1000) {
    err("LIMIT_EXCEEDED", "intake.previous_gifts", "送礼历史最多 1000 个 Unicode 码点");
  } else if (/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u.test(previousGifts)) {
    previousGifts = "";
  }

  const choice = (key, table, fallback = null) => {
    const value = key in data ? data[key] : fallback;
    if (typeof value !== "string" || !(value in table)) {
      err("INTAKE_UNKNOWN_LABEL", `intake.${key}`, "请选择已声明的标签 ID");
      return fallback;
    }
    return value;
  };

  const relation = choice("recipient_relation", RELATIONS_FULL);
  const occasion = choice("occasion", OCCASION_TABLE);
  const customText = (key) => {
    if (!Object.hasOwn(data, key)) return null;
    const value = data[key];
    if (typeof value !== "string" || !value.trim()) {
      err("INVALID_TYPE", `intake.${key}`, "自定义文本必须为非空字符串");
      return null;
    }
    if ([...value].length > 1000) err("LIMIT_EXCEEDED", `intake.${key}`, "自定义文本最多 1000 个 Unicode 码点");
    return value;
  };
  const relationCustom = customText("recipient_relation_custom");
  const occasionCustom = customText("occasion_custom");
  if (relation === "other" && relationCustom === null) err("INTAKE_CLARIFICATION_REQUIRED", "intake.recipient_relation_custom", "选择其他关系时请填写自定义关系");
  if (relation !== "other" && Object.hasOwn(data, "recipient_relation_custom")) err("INTAKE_UNKNOWN_FIELD", "intake.recipient_relation_custom", "只有选择其他关系时才能填写自定义关系");
  if (occasion === "other" && occasionCustom === null) err("INTAKE_CLARIFICATION_REQUIRED", "intake.occasion_custom", "选择其他场合时请填写自定义场合");
  if (occasion !== "other" && Object.hasOwn(data, "occasion_custom")) err("INTAKE_UNKNOWN_FIELD", "intake.occasion_custom", "只有选择其他场合时才能填写自定义场合");
  const closeness = choice("closeness", CLOSENESS_TABLE, "unknown");
  for (const key of ["recipient_relation", "occasion"]) {
    if (data[key] === "unknown") {
      err("INTAKE_CLARIFICATION_REQUIRED", `intake.${key}`, "推荐前请确认关系或场合；可使用其他");
    }
  }
  // 「追求对象」契约闸门：只在契约未落地时拒绝，且绝不改写关系值。
  if (relation === "pursuit" && !pursuitReady) {
    err("PURSUIT_CONTRACT_NOT_READY", "intake.recipient_relation", PURSUIT_NOT_READY_MESSAGE);
  }

  const selections = (key, table) => {
    const values = key in data ? data[key] : [];
    if (!Array.isArray(values)) {
      err("INVALID_TYPE", `intake.${key}`, "须为标签 ID 数组");
      return [];
    }
    if (values.length > LIMITS.maxArrayItems) err("LIMIT_EXCEEDED", `intake.${key}`, "数组最多 20 项");
    const seen = new Set();
    const valid = [];
    values.forEach((value, i) => {
      const path = `intake.${key}[${i}]`;
      if (typeof value !== "string" || !(value in table)) {
        err("INTAKE_UNKNOWN_LABEL", path, "未知标签；跳过兴趣或风格请使用空数组");
      } else if (seen.has(value)) {
        err("DUPLICATE_ID", path, "标签不得重复");
      } else {
        seen.add(value);
        valid.push(value);
      }
    });
    return valid;
  };

  const interests = selections("interests", INTEREST_TABLE);
  const styles = selections("gift_styles", GIFT_STYLE_TABLE);
  let confidence = "interest_confidence" in data ? data.interest_confidence : {};
  if (confidence === null || typeof confidence !== "object" || Array.isArray(confidence)) {
    err("INVALID_TYPE", "intake.interest_confidence", "可信度须为以兴趣 ID 为键的对象");
    confidence = {};
  }
  for (const key of Object.keys(confidence)) {
    if (!interests.includes(key)) {
      err("INTAKE_CONFIDENCE_MISMATCH", "intake.interest_confidence", "可信度只能对应本次选择的兴趣");
      break;
    }
  }
  for (const key of interests) {
    const value = key in confidence ? confidence[key] : "inferred";
    if (value !== "confirmed" && value !== "inferred") {
      err(
        "INTAKE_CONFIDENCE_MISMATCH",
        `intake.interest_confidence.${key}`,
        "已选兴趣只允许 confirmed 或 inferred；未知请取消选择",
      );
    }
  }

  let exclusions = "hard_exclusions" in data ? data.hard_exclusions : { tags: [], terms: [], unresolved: [] };
  if (exclusions === null || typeof exclusions !== "object" || Array.isArray(exclusions)) {
    err("INVALID_TYPE", "intake.hard_exclusions", "禁忌须为 tags、terms、unresolved 对象");
    exclusions = {};
  }
  for (const key of Object.keys(exclusions)) {
    if (!["tags", "terms", "unresolved"].includes(key)) err("INTAKE_UNKNOWN_FIELD", `intake.hard_exclusions.${key}`, "未知禁忌字段");
  }
  for (const key of ["tags", "terms", "unresolved"]) {
    const values = key in exclusions ? exclusions[key] : [];
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string" || v.trim() === "")) {
      err("INVALID_TYPE", `intake.hard_exclusions.${key}`, "须为非空字符串数组，可为空数组");
    } else if (values.length > LIMITS.maxArrayItems || values.some((v) => [...v].length > LIMITS.maxStringCodePoints)) {
      err("LIMIT_EXCEEDED", `intake.hard_exclusions.${key}`, "禁忌数组最多 20 项，每项最多 1000 码点");
    }
  }
  if (Array.isArray(exclusions.unresolved) && exclusions.unresolved.length > 0) {
    err("INTAKE_CLARIFICATION_REQUIRED", "intake.hard_exclusions.unresolved", "请将待澄清禁忌确认为类别或明确字面词；不能静默忽略");
  }
  const tags = "tags" in exclusions ? exclusions.tags : [];
  if (Array.isArray(tags)) {
    tags.forEach((value, i) => {
      if (typeof value !== "string" || !(value in EXCLUSION_TABLE)) {
        err("INTAKE_UNKNOWN_LABEL", `intake.hard_exclusions.tags[${i}]`, "禁忌类别须使用固定 ID，不自动猜同义词");
      }
    });
  }

  const request = {
    // 两层契约：recipient_relation 是面向人与提示词的冻结中文显示文本，
    // recipient_relation_id 是供代码分支（关系优先级、追求对象低压力）使用的稳定机器值，
    // 只由服务端产出，不在输入白名单内，前端提交会被 INTAKE_UNKNOWN_FIELD 拒绝。
    recipient_relation: relation && relation in RELATIONS_FULL ? (relation === "other" ? relationCustom : RELATIONS_FULL[relation]) : "",
    recipient_relation_id: relation && relation in RELATIONS_FULL ? relation : "",
    recipient_relation_custom: relation === "other" ? relationCustom : null,
    occasion: occasion && occasion in OCCASION_TABLE ? (occasion === "other" ? occasionCustom : OCCASION_TABLE[occasion]) : "",
    occasion_custom: occasion === "other" ? occasionCustom : null,
    budget_amount: budget,
    currency: "currency" in data ? data.currency : null,
    available_days: "deadline_days" in data ? data.deadline_days : null,
    facts: interests
      .filter((key) => (key in confidence ? confidence[key] : "inferred") === "confirmed")
      .map((key) => ({
        id: `interest:${key}`,
        text: `用户明确知道：对方对“${INTEREST_TABLE[key]}”感兴趣（未确认该组内具体偏好）`,
      })),
    forbidden_tags: Array.isArray(tags) ? tags : [],
    forbidden_terms: "terms" in exclusions && Array.isArray(exclusions.terms) ? exclusions.terms : [],
    notes: "additional_context" in data ? data.additional_context : "",
    closeness,
    preference_inferences: interests
      .filter((key) => (key in confidence ? confidence[key] : "inferred") === "inferred")
      .map((key) => ({ interest_id: key, text: `用户猜测：对方可能对“${INTEREST_TABLE[key]}”感兴趣` })),
    gift_styles: styles,
    hard_exclusions_original: exclusions,
  };
  if (revised || Object.hasOwn(data, "previous_gifts")) request.previous_gifts = previousGifts;
  if (revised) {
    Object.assign(request, { contract_version: CONTRACT_VERSION, budget_range: Object.hasOwn(data, "budget_range") ? data.budget_range : null, dislikes });
  } else if (Object.hasOwn(data, "dislikes")) {
    request.dislikes = dislikes;
  }

  // 复用同一套请求检查；空批次产生的候选错误不会成为输入错误。
  const requestJson = dump(request);
  const checked = validate(requestJson, "{}", strictParse);
  errors.push(...checked.errors.filter((e) => e.path.startsWith("request") &&
    !(budgetErrors.length && (e.path.startsWith("request.budget_range") || e.path.startsWith("request.budget_amount"))) &&
    !(e.path.includes("dislikes") && errors.some((x) => x.path === "intake.dislikes"))));
  if (checked.status === "error") {
    err("INTERNAL_ERROR", "intake", "输入检查暂不可用，请稍后重试");
  }
  return {
    status: errors.length > 0 ? "needs_input" : "ready",
    errors,
    request_json: errors.length > 0 ? null : requestJson,
  };
}

/** 便于服务端与测试复用：把已解析的 intake 对象转回 JSON 字符串再适配。 */
export function adaptIntakeObject(intakeObject, options = {}) {
  let raw;
  try {
    raw = dump(intakeObject);
  } catch (e) {
    return {
      status: "needs_input",
      errors: [{ code: "INTAKE_INVALID_JSON", path: "intake", message: "输入须为不超过 32768 UTF-8 字节的严格 JSON 对象" }],
      request_json: null,
    };
  }
  if (byteLength(raw) > LIMITS.intakeBytes) {
    return {
      status: "needs_input",
      errors: [{ code: "INTAKE_INVALID_JSON", path: "intake", message: "输入须为不超过 32768 UTF-8 字节的严格 JSON 对象" }],
      request_json: null,
    };
  }
  return adaptIntake(raw, options);
}
