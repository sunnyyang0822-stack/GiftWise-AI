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
  LLM_NOT_CONFIGURED: "服务端未配置直连大模型凭证，无法发起真实调用；未生成任何候选，也没有用模拟数据顶替。",
  LLM_HTTP: "大模型接口返回非 2xx 状态，未采用该次输出。",
  LLM_TIMEOUT: "大模型接口在超时上限内未返回，未采用该次输出。这是**超时**，不是业务失败，也不是模型答错。",
  LLM_REQUEST_FAILED: "大模型接口调用失败（网络或服务不可用），未采用该次输出。",
  LLM_BAD_RESPONSE: "大模型接口响应不是符合 OpenAI 兼容约定的严格 JSON，未采用该次输出。",
  LLM_OUTPUT_INVALID: "大模型输出的内容不是合法且无重复键的严格 JSON，未采用该次输出。",
  /**
   * 「被截断」与「非法 JSON」是**两种不同的故障**，必须分成两个码：
   *   - LLM_OUTPUT_TRUNCATED：finish_reason=length 且还留有一部分正文 ⇒ 上限偏小；
   *   - LLM_OUTPUT_REASONING_EXHAUSTED：finish_reason=length 且正文为空 ⇒ 推理模型的
   *     reasoning_tokens 把 max_tokens 全部吃掉（本机实测 completion=8192、reasoning=7205）。
   * 两者都不是「接口坏了」，也都不是业务失败；分开才能一眼看出该调哪个旋钮。
   */
  LLM_OUTPUT_TRUNCATED:
    "大模型输出被输出上限（max_tokens）截断（finish_reason=length），本次输出不完整、未采用；请调大 LLM_MAX_TOKENS 后重试。这不是超时，也不是接口失败。",
  LLM_OUTPUT_REASONING_EXHAUSTED:
    "大模型的最大输出额度被推理过程（reasoning_tokens）全部吃光，正文为空（finish_reason=length）⇒ 判定为**被截断**而不是「接口返回损坏」；更不是超时或业务失败。请调大 LLM_MAX_TOKENS（本机默认已提到 16384）后重试，本次输出未采用。",
  LLM_BUDGET_EXHAUSTED: "真实调用次数已达到本次设定的额度上限，已拒绝继续发起调用；本次没有发出请求，也没有用模拟数据顶替。",
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
