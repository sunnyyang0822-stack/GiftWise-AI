/**
 * 直连大模型 provider 的稳定错误码与失败封装。
 *
 * 纪律：
 *   - 机器码是英文大写且保持稳定；给用户的消息是简体中文，不回显密钥、
 *     原始提示词、请求头或第三方异常原文（避免把用户文字或凭证带进响应）；
 *   - 消息里不出现「api_key」这类字面量：GET /api/config 的响应会被
 *     web/tools/smoke-http.mjs 扫描，命中即视为泄露密钥字段；
 *   - 任何失败都必须返回 ok=false，绝不用默认值或模拟结果顶替真实输出。
 */

/** 稳定错误码 → 面向用户的中文说明。 */
export const LLM_ERROR_MESSAGES = Object.freeze({
  LLM_NOT_CONFIGURED: "服务端尚未配置文本模型，请配置后重试。",
  RETRIEVAL_NO_MATERIAL: "暂时没找到可用的参考资料，请稍后再试。",
  RETRIEVAL_BASIS_UNCONFIRMED: "这次推荐的参考依据尚未确认，请重试。",
  LLM_HTTP: "模型服务暂时不可用，请稍后重试。",
  LLM_TIMEOUT: "模型响应超时，请稍后重试。",
  LLM_REQUEST_FAILED: "无法连接模型服务，请稍后重试。",
  LLM_BAD_RESPONSE: "模型服务返回格式异常，请重试。",
  LLM_OUTPUT_INVALID: "模型返回的内容格式有误，请重试。",
  /**
   * 「被截断」与「非法 JSON」是**两种不同的故障**，必须分成两个码：
   *   - LLM_OUTPUT_TRUNCATED：finish_reason=length 且还留有一部分正文 ⇒ 上限偏小；
   *   - LLM_OUTPUT_REASONING_EXHAUSTED：finish_reason=length 且正文为空 ⇒ 推理模型的
   *     reasoning_tokens 把 max_tokens 全部吃掉（本机实测 completion=8192、reasoning=7205）。
   * 两者都不是「接口坏了」，也都不是业务失败；分开才能一眼看出该调哪个旋钮。
   */
  LLM_OUTPUT_TRUNCATED:
    "模型返回的内容不完整，请提高输出额度后重试。",
  LLM_OUTPUT_REASONING_EXHAUSTED:
    "模型推理已用完输出额度，尚未返回正文，请提高输出额度后重试。",
  LLM_BUDGET_EXHAUSTED: "本次模型调用额度已用完，请调整额度后重试。",
  LLM_RETRY_EXHAUSTED: "大模型接口连续失败，已用尽重试上限。",
  LLM_INTAKE_DERIVED_FIELD: "拒绝把适配层派生字段（收礼关系机器值/可用天数/facts 等）当作原始输入发送；这些字段只能由服务端适配层产出。",
  LLM_MODE_INVALID: "运行模式不合法。",
  /* ---- 第 1 步自然语言解析（intake-parse）专用：解析失败一律回落，绝不卡住用户 ---- */
  LLM_PARSE_OUTPUT_INVALID:
    "自然语言解析没有得到可用的严格 JSON，已停止解析并**回落到你提交的表单字段**继续；没有用猜测值顶替。",
  LLM_PARSE_EMPTY: "自然语言解析没有识别出任何可落地的字段（用户输入过于含糊或与送礼无关）；已回落，未编造任何字段。",
  LLM_PARSE_DISABLED: "服务端未启用自然语言解析（或本次未提供自由文本）；已直接使用表单字段继续。",
});

/** 可重试的 HTTP 状态：限流、超时类与 5xx。其余 4xx 视为不可重试。 */
export const RETRYABLE_STATUS = Object.freeze(new Set([408, 409, 425, 429, 500, 502, 503, 504]));

/**
 * 构造失败结果。extra 只允许放结构性信息（status/attempts/elapsed_ms 等），
 * 不得放入密钥、请求体或响应体原文。
 */
export function llmError(code, extra = {}) {
  return {
    ok: false,
    code,
    message: LLM_ERROR_MESSAGES[code] || LLM_ERROR_MESSAGES.LLM_REQUEST_FAILED,
    ...extra,
  };
}

export function isLlmError(value) {
  return Boolean(value) && typeof value === "object" && value.ok === false && typeof value.code === "string";
}
