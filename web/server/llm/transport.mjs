/**
 * OpenAI 兼容 transport：POST {base}/chat/completions。
 *
 * 对齐 web/server/media/seedream.mjs 的写法（本仓库已有的 provider 接缝范例）：
 *   - 只从调用方传入的配置里读地址与密钥，本模块不读环境变量；
 *   - redirect: "error"，不跟随跳转；
 *   - 明确超时（每次尝试独立 AbortController）、明确重试上限、明确错误码；
 *   - 密钥只放进 Authorization 头，绝不进日志、绝不进返回值。
 *
 * 真实调用次数由 provider 记账（见 ledger.mjs），transport 只报 attempts。
 */

import { llmError, RETRYABLE_STATUS } from "./errors.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 从 base 拼出 chat/completions 端点；base 允许带或不带 /v1。 */
export function chatCompletionsUrl(base) {
  const trimmed = String(base || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** 只保留协议与主机名，用于 fixture 与账本记录；不落完整 base，避免夹带查询串或凭证。 */
export function hostOf(base) {
  try {
    return new URL(String(base || "")).host;
  } catch {
    return null;
  }
}

/**
 * 校验 OpenAI 兼容响应，取出 choices[0].message.content。
 *
 * 只做「结构检查 + 抽取」，不做语义兼容：结构不符一律 LLM_BAD_RESPONSE。
 * 一个例外必须放过：**推理模型**的 content 可能是空串（输出 token 全被推理吃掉），
 * 此时若 finish_reason === "length"，那是被 max_tokens 截断而不是接口坏，
 * 因此放行空文本、交由上层判成 LLM_OUTPUT_TRUNCATED，避免误判成「接口失败」。
 */
export function extractContent(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return llmError("LLM_BAD_RESPONSE");
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return llmError("LLM_BAD_RESPONSE");
  const first = choices[0];
  const finish = first && typeof first.finish_reason === "string" ? first.finish_reason : null;
  const content = first?.message?.content;
  const calls = first?.message?.tool_calls;
  const validCalls = Array.isArray(calls) && calls.length > 0 && calls.length <= 32
    && calls.every(call => call && typeof call.id === 'string' && call.id && call.type === 'function'
      && typeof call.function?.name === 'string' && call.function.name && typeof call.function.arguments === 'string')
    && new Set(calls.map(call => call.id)).size === calls.length;
  if (calls != null && !(Array.isArray(calls) && calls.length === 0) && !validCalls) return llmError('LLM_BAD_RESPONSE');
  if (typeof content !== 'string' && !(content === null && validCalls)) return llmError('LLM_BAD_RESPONSE');
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text && finish !== 'length' && !validCalls) return llmError('LLM_BAD_RESPONSE');
  return {
    ok: true,
    text,
    ...(validCalls ? {tool_calls: structuredClone(calls), assistant_message: {role:'assistant', content, tool_calls:structuredClone(calls)}} : {}),
    finish_reason: typeof first.finish_reason === "string" ? first.finish_reason : null,
    model: typeof payload.model === "string" ? payload.model : null,
    usage: payload.usage && typeof payload.usage === "object" ? payload.usage : null,
  };
}

export class OpenAiCompatibleTransport {
  /** transport 名，写进响应与账本，便于区分真实调用与回放。 */
  name = "live";

  /**
   * @param {{fetchImpl?: Function, sleepImpl?: Function, now?: Function}} deps
   */
  constructor(deps = {}) {
    const { fetchImpl = globalThis.fetch, sleepImpl = sleep, now = () => Date.now() } = deps;
    this.fetchImpl = fetchImpl;
    this.sleep = sleepImpl;
    this.now = now;
    // 记账口径的判据：只有**没被注入 fetch 的**默认 transport 才算真实出站调用。
    // 注入假 fetch 的（单元测试、本机假端点自检）一律标记为 synthetic：不写账本、不计数，
    // 否则账本会被测试污染，「真实调用次数」这个证据就不可信了
    // （本任务实测到过 246 条污染记录，见报告「记账口径」一节）。
    this.synthetic = Object.hasOwn(deps, "fetchImpl");
  }

  /**
   * @param {{baseUrl: string, apiKey: string, model: string, messages: Array<object>,
   *          timeoutMs?: number, maxRetries?: number, maxTokens?: number, temperature?: number}} call
   */
  async chat(call) {
    const base = String(call.baseUrl || "").trim();
    const apiKey = String(call.apiKey || "").trim();
    const url = chatCompletionsUrl(base);
    if (!url || !apiKey || !String(call.model || "").trim()) {
      return llmError("LLM_NOT_CONFIGURED", { attempts: 0, transport: this.name });
    }
    const timeoutMs = Number.isFinite(call.timeoutMs) && call.timeoutMs > 0 ? Math.floor(call.timeoutMs) : 60000;
    const rawRetries = Number.isFinite(call.maxRetries) && call.maxRetries >= 0 ? Math.floor(call.maxRetries) : 2;
    // 硬上限 3 次重试：防止误配置把额度打光。
    const maxRetries = Math.min(rawRetries, 3);
    const body = JSON.stringify({
      model: String(call.model).trim(),
      messages: call.messages,
      stream: false,
      ...(Array.isArray(call.tools) && call.tools.length ? {tools:call.tools, tool_choice:call.tool_choice ?? 'auto'} : {}),
      ...(Number.isFinite(call.maxTokens) && call.maxTokens > 0 ? { max_tokens: Math.floor(call.maxTokens) } : {}),
      ...(Number.isFinite(call.temperature) ? { temperature: call.temperature } : {}),
    });

    const started = this.now();
    let attempts = 0;
    let lastCode = "LLM_REQUEST_FAILED";
    let lastStatus = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      attempts += 1;
      if (call.signal?.aborted) return llmError('LLM_CANCELLED',{attempts:attempt,transport:this.name});
      const controller = new AbortController();
      const cancel = () => controller.abort();
      call.signal?.addEventListener('abort',cancel,{once:true});
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method: "POST",
          redirect: "error",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body,
          signal: controller.signal,
        });
        if (!response.ok) {
          lastCode = "LLM_HTTP";
          lastStatus = response.status;
          // 响应体不读、不回显：第三方错误常夹带请求原文。
          if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) {
            return llmError(lastCode, {
              status: response.status,
              attempts,
              transport: this.name,
              elapsed_ms: this.now() - started,
              retries_exhausted: RETRYABLE_STATUS.has(response.status) && attempt === maxRetries,
            });
          }
        } else {
          const payload = await response.json().catch(() => null);
          const extracted = extractContent(payload);
          if (!extracted.ok) {
            // 2xx 但结构不符：不重试，重试也只会再花一次额度。
            return llmError(extracted.code, {
              status: response.status,
              attempts,
              transport: this.name,
              elapsed_ms: this.now() - started,
            });
          }
          return {
            ok: true,
            text: extracted.text,
            ...(extracted.tool_calls ? {tool_calls:extracted.tool_calls,assistant_message:extracted.assistant_message} : {}),
            usage: extracted.usage,
            model: extracted.model,
            finish_reason: extracted.finish_reason,
            http_status: response.status,
            attempts,
            transport: this.name,
            elapsed_ms: this.now() - started,
          };
        }
      } catch (err) {
        if (call.signal?.aborted) return llmError('LLM_CANCELLED',{attempts,transport:this.name,elapsed_ms:this.now()-started});
        if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
          lastCode = "LLM_TIMEOUT";
        } else {
          lastCode = "LLM_REQUEST_FAILED";
        }
        if (attempt === maxRetries) {
          return llmError(lastCode, {
            attempts,
            transport: this.name,
            elapsed_ms: this.now() - started,
            retries_exhausted: true,
          });
        }
      } finally {
        clearTimeout(timer);
        call.signal?.removeEventListener('abort',cancel);
      }
      // 线性退避：250ms * (attempt+1)。测试里注入 sleepImpl，不阻塞。
      await this.sleep(250 * (attempt + 1));
    }

    return llmError("LLM_RETRY_EXHAUSTED", {
      attempts,
      status: lastStatus,
      transport: this.name,
      elapsed_ms: this.now() - started,
      retries_exhausted: true,
      last_code: lastCode,
    });
  }
}

export { llmError };
