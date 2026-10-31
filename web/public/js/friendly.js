/* 面向用户的提示语：把服务端的校验结果转成大白话。
   界面上不显示错误码、字段路径和内部参数（如 shipping_days_source=…）；纯内部条目不显示。 */

/** 用户看得懂、且对挑选有用的提示：按错误码给出大白话。 */
const FRIENDLY = {
  OVER_BUDGET: "价格超出了你的预算。",
  BELOW_BUDGET_RANGE: "估价低于你的预算下限，仍可选择。",
  PREPARATION_TOO_LONG: "准备时间超过了你留出的天数。",
  DELIVERY_TOO_LONG: "算上快递时间，可能赶不上你想送出的时间。",
  FORBIDDEN_TAG: "和你要避开的东西有冲突。",
  FORBIDDEN_TERM: "和你要避开的东西有冲突。",
  EXCLUSION_CONFLICT: "和你要避开的东西有冲突。",
  CLIENT_TIMEOUT: "等了太久还没有结果，可以再试一次。",
  NETWORK_ERROR: "网络好像断开了，稍后再试一次。",
};
/** 只对系统有意义、对用户没有帮助的条目：不展示。 */
const INTERNAL = new Set(["REPAIR_NOT_ALLOWED", "MISSING_RESULT", "AI_OUTPUT_INVALID", "AI_OUTPUT_LIMIT", "AI_OUTPUT_UNANCHORED"]);
/** 用户可见的卡片提示只保留这些（其余多为数据来源、默认估算之类的内部说明）。 */
const CARD_WARNINGS = new Set(["BELOW_BUDGET_RANGE"]);

/** 去掉消息里的内部参数（括号里含英文标识、等号、下划线的部分）。 */
function plain(message) {
  const text = String(message || "").replace(/[（(][^（）()]*[A-Za-z_=][^（）()]*[）)]/g, "").replace(/\s{2,}/g, " ").trim();
  return /[A-Za-z]+_[A-Za-z_]+|=/.test(text) ? "" : text;
}

/** 一条校验结果 ⇒ 用户可见的一句话；返回空串表示不展示。 */
export function friendlyMessage(item) {
  const code = typeof item?.code === "string" ? item.code : "";
  if (INTERNAL.has(code)) return "";
  return FRIENDLY[code] || plain(item?.message) || "";
}

/** 一组校验结果 ⇒ 去重后的用户可见句子；全部被过滤时给一句通用说明。 */
export function friendlyMessages(items, fallback = "有一项条件不太符合。") {
  const list = Array.isArray(items) ? items : [];
  const out = [...new Set(list.map(friendlyMessage).filter(Boolean))];
  return out.length || !list.length ? out : [fallback];
}

/** 卡片上的提示：只留对用户有用的那几类。 */
export function cardWarnings(items) {
  return [...new Set((Array.isArray(items) ? items : []).filter(w => CARD_WARNINGS.has(w?.code)).map(friendlyMessage).filter(Boolean))];
}
