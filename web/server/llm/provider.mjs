/**
 * 直连大模型 provider（服务端唯一入口）。
 *
 * 职责边界，对齐本仓库已有的 provider 接缝（web/server/media/provider.mjs）：
 *   - provider 负责「构造请求 / 校验输出 / 记账」；
 *   - transport 只负责「发一次 HTTP」（见 transport.mjs，含超时与重试上限）；
 *   - 业务规则校验**不在**这里，仍由 checker.mjs 独立完成。
 *
 * 两个函数沿用原有契约名（pipeline.mjs:20 原来从 dify.mjs 导入的同名函数）：
 *   requestCandidates(intakeJson, retrieval) -> { action:"recommend", … }
 *   requestPresentation(requestJson, candidateJson) -> { action:"present", … }
 * 直连链路里适配已在本地跑完，因此发给模型的是冻结 request_json；
 * 若一并送原始输入，intake_json 由 assertIntakeHasNoDerivedFields() 守住派生字段
 * （facts / available_days / recipient_relation_id 等一旦混进原始输入，
 *  上游适配层会整条判 INTAKE_UNKNOWN_FIELD）。
 *
 * 纪律：
 *   - 无凭证返回 LLM_NOT_CONFIGURED，绝不假装成功、绝不静默改用模拟数据；
 *   - 每一次真实 HTTP 调用都写账本（ledger.mjs），用于"真实调用次数"举证；
 *   - 绝不在返回值、日志或错误里回显密钥、完整提示词或响应正文。
 */

import { strictParse, dump } from "../jsonstrict.mjs";
import { hasLlmConfig, llmConfig } from "../config.mjs";
import { llmError } from "./errors.mjs";
import { OpenAiCompatibleTransport, hostOf } from "./transport.mjs";
import { recordRealCall, realCallCount } from "./ledger.mjs";
import {
  assertIntakeHasNoDerivedFields,
  buildPresentEnvelope,
  buildPresentMessages,
  buildRecommendEnvelope,
  buildRecommendMessages,
  buildExclusionsMessages,
} from "./prompt.mjs";
import { buildLocalPresentation } from "./presentation.mjs";

/** 允许的 mode：mock（内置模拟）/ llm（直连）/ dify（保留的历史对照路径）。 */
export const LLM_MODES = Object.freeze(["mock", "dify", "llm"]);

/**
 * 推理模型输出清洗（只做「剥离」，不做「猜测式修补」）。
 *
 * 顺序：成对思考块 → 围栏 → 首个 { 到末个 } 的 JSON 主体。
 * 这一步是**容错**而不是放宽契约：提示词仍然要求只输出裸 JSON；
 * 清洗后仍必须是严格 JSON 对象（无重复键），否则 LLM_OUTPUT_INVALID。
 */
export function sanitizeModelText(raw) {
  let text = String(raw ?? "").replace(/^\uFEFF/, "");
  // 成对的思考/推理块（DeepSeek 系推理模型常带  thinking…<｜end▁of▁thinking｜>）。
  text = text.replace(/<(think|thinking|thought|reasoning|analysis)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "\n");
  // 未闭合的思考标签：只摘掉标签本身，剩余正文仍要能自成 JSON，否则如实失败。
  text = text.replace(/<\/?(think|thinking|thought|reasoning|analysis)\b[^>]*>/gi, "\n");
  // Markdown 代码围栏（```json … ``` 或 ``` … ```，含只有开围栏的残缺情形）。
  text = text.replace(/```[A-Za-z0-9_+-]*[ \t]*\r?\n?/g, "\n").replace(/```/g, "\n");
  return text;
}

/**
 * 输出必须是严格 JSON 对象；不满足返回错误码，绝不回显模型原文。
 *
 * @param {string} text 模型返回的正文
 * @param {{requireKey?: string|null, finishReason?: string|null, usage?: object|null, maxTokens?: number|null}} opts
 *   finishReason === "length" 表示被输出上限截断：这既不是超时也不是接口失败，
 *   单独判成截断类错误码（且不值得重试——重试同样会被截断）。
 *
 *   ⚠ 截断再分两种，排查方向完全不同（2026-10-31 独立验收实测到的缺陷）：
 *     - 还留有残缺正文   → LLM_OUTPUT_TRUNCATED      （上限偏小，正文写不完）
 *     - 正文完全为空     → LLM_OUTPUT_REASONING_EXHAUSTED（推理 token 把 max_tokens 吃光）
 *   两者都与「非法 JSON / 接口坏了 / 超时」区分开，并在附加信息里带上
 *   max_tokens 与实际 usage，避免只看到一个笼统的失败码。
 */
export function parseModelJson(text, { requireKey = null, finishReason = null, usage = null, maxTokens = null } = {}) {
  const truncated = finishReason === "length";
  const raw = typeof text === "string" ? text : "";
  const cleaned = truncated ? sanitizeModelText(raw).trim() : "";
  if (truncated) {
    const reasoning = usage && typeof usage === "object" ? usage.completion_tokens_details?.reasoning_tokens ?? null : null;
    return llmError(cleaned ? "LLM_OUTPUT_TRUNCATED" : "LLM_OUTPUT_REASONING_EXHAUSTED", {
      reason: cleaned ? "finish-reason-length-partial" : "finish-reason-length-empty-content",
      max_tokens: Number.isFinite(maxTokens) ? maxTokens : null,
      reasoning_tokens: Number.isFinite(reasoning) ? reasoning : null,
      usage: usage && typeof usage === "object" ? usage : null,
    });
  }
  if (!raw.trim()) return llmError("LLM_OUTPUT_INVALID", { reason: "empty" });
  const cleanedBody = sanitizeModelText(raw).trim();
  if (!cleanedBody) return llmError("LLM_OUTPUT_INVALID", { reason: "empty" });
  // 只取 JSON 主体：允许模型在 JSON 前后夹带少量说明文字，但不接受"没有 JSON 主体"。
  const start = cleanedBody.indexOf("{");
  const end = cleanedBody.lastIndexOf("}");
  if (start === -1 || end <= start) return llmError("LLM_OUTPUT_INVALID", { reason: "no-json-body" });
  let parsed;
  try {
    parsed = strictParse(cleanedBody.slice(start, end + 1), 65536);
  } catch {
    return llmError("LLM_OUTPUT_INVALID", { reason: "not-strict-json" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return llmError("LLM_OUTPUT_INVALID", { reason: "not-object" });
  }
  if (requireKey && !Array.isArray(parsed[requireKey])) {
    return llmError("LLM_OUTPUT_INVALID", { reason: `missing-${requireKey}` });
  }
  return { ok: true, value: parsed };
}

export class LlmProvider {
  /**
   * @param {{live?: object, config?: Function, hasConfig?: Function}} deps
   */
  constructor(deps = {}) {
    this.live = deps.live ?? new OpenAiCompatibleTransport();
    this.config = deps.config ?? llmConfig;
    this.hasConfig = deps.hasConfig ?? hasLlmConfig;
    // 绑定 this：pipeline 会以 `services.requestCandidates ?? llmProvider.requestCandidates`
    // 的形式把方法当裸函数引用传出去，那时 this 为 undefined。
    // 这个坑由 web/tools/llm-selftest.mjs 的真实 HTTP 链路发现（单测因箭头包装而漏过）。
    this.requestCandidates = this.requestCandidates.bind(this);
    this.requestPresentation = this.requestPresentation.bind(this);
    this.recognizeExclusions = this.recognizeExclusions.bind(this);
    this.requestIntakeParse = this.requestIntakeParse.bind(this);
  }

  available() {
    return Boolean(this.hasConfig());
  }

  /**
   * 发一次真实调用，并记账。
   * @returns {Promise<object>} {ok:true, text, transport, …} | llmError
   */
  async invoke({ kind, messages, maxTokens, tools, tool_choice, signal }) {
    const cfg = this.config();
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
      return llmError("LLM_NOT_CONFIGURED", { attempts: 0, transport: "live" });
    }
    // 额度硬闸：达到本次设定的真实调用上限就**在发出请求之前**拒绝。
    // 这样「开发期最多 N 次真实调用」是代码保证的，不依赖人的自觉；
    // 只对真实 transport 生效（注入假 fetch 的自检/单测不消耗额度）。
    if (this.live?.synthetic !== true && Number.isFinite(cfg.callBudget) && cfg.callBudget >= 0) {
      const used = realCallCount();
      if (used >= cfg.callBudget) {
        return llmError("LLM_BUDGET_EXHAUSTED", { used, budget: cfg.callBudget, attempts: 0, transport: this.name });
      }
    }
    const reply = await this.live.chat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      tools, tool_choice, signal,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : cfg.maxTokens,
      temperature: cfg.temperature,
    });

    // 真实调用计数：成功与失败都记（失败也可能已经消耗额度）。
    // 但**注入假 fetch 的 transport 不入账**：单元测试与本机假端点自检都不是真实出站调用，
    // 混进来会让「真实调用次数」这个证据失效（本任务实测到过 246 条污染记录）。
    if (this.live?.synthetic !== true) {
      recordRealCall({
        kind,
        model: cfg.model,
        base_url_host: hostOf(cfg.baseUrl),
        http_status: reply.ok ? reply.http_status : reply.status ?? null,
        outcome: reply.ok ? "ok" : "failed",
        code: reply.ok ? null : reply.code,
        attempts: reply.attempts ?? 1,
        elapsed_ms: reply.elapsed_ms ?? null,
        // 必修 3：被截断时 finish_reason 与 usage 是定位问题的关键，账本里也要留痕（不只是响应）。 
        finish_reason: reply.finish_reason ?? null,
        max_tokens: Number.isFinite(maxTokens) ? maxTokens : cfg.maxTokens ?? null,
        usage: reply.ok ? reply.usage ?? null : null,
      });
    }

    return reply;
  }

  /**
   * 推荐阶段。沿用原契约名与可选 retrieval 语义。
   * @param {{requestJson: string, intakeJson?: string|null, retrieval?: object|null, library?: object|null, inputParse?: object|null}} input
   *   inputParse：第 1 步自然语言解析出的**用户硬约束**（原文/±带宽/城市），
   *   由 buildRecommendEnvelope 放进 input_constraints，不改变 request_json。
   */
  async requestCandidates({ requestJson, intakeJson = null, retrieval = null, library = null, inputParse = null, tools = [], executeTool, signal, maxToolRounds = 4 }) {
    if (!this.available()) return llmError('LLM_NOT_CONFIGURED', {attempts:0,transport:'live'});
    const guard = assertIntakeHasNoDerivedFields(intakeJson);
    if (!guard.ok) return llmError('LLM_INTAKE_DERIVED_FIELD',{fields:guard.fields,attempts:0});
    const registered = new Map();
    for (const tool of tools) {
      if (tool?.type !== 'function' || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.function?.name ?? '') || registered.has(tool.function.name)) return llmError('LLM_TOOL_CONFIG_INVALID');
      registered.set(tool.function.name,tool);
    }
    const envelope = buildRecommendEnvelope({requestJson,intakeJson,retrieval:retrieval && retrieval.status !== 'unavailable' ? retrieval : null,library,inputParse});
    const messages = buildRecommendMessages(envelope);
    if(registered.size)messages[0].content+='\n\n工具模式：是否调用工具由你结合完整上下文自主决定，不需要外部信息时直接推荐。工具结果回来后继续理解与比较，再输出最终候选，不铺原始列表。采用具体商品时可在最终JSON根对象另附product_references:[{candidate_id,product_id}]，只引用本次结果；对应name写为商品name + " · " + variant，观察价及条件原样尊重，不把新人/首单价当普通结算价。未采用商品的候选无需引用；该sidecar由服务端剥离，不进入严格候选对象。';
    const toolAudit = [];
    const cfg = this.config();
    const redact = (value, depth = 0) => {
      if (depth > 16) return '[omitted]';
      if (typeof value === 'string') return cfg.apiKey ? value.split(cfg.apiKey).join('[redacted]') : value;
      if (Array.isArray(value)) return value.map(v=>redact(v,depth+1));
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k])=>!/(?:password|cookie|authorization|token|secret|api.?key|prompt|messages)/i.test(k)).map(([k,v])=>[k,redact(v,depth+1)]));
      return value;
    };
    let reply, parsed;
    let modelCalls = 0, toolRounds = 0, outputAttempts = 0;
    const toolLimit = Number.isInteger(maxToolRounds) ? Math.max(0,Math.min(maxToolRounds,4)) : 4;
    const meta = () => ({tool_audit:toolAudit,model_calls:modelCalls,synthetic:this.live?.synthetic === true});
    while (true) {
      const toolChoice = toolRounds >= toolLimit ? 'none' : 'auto';
      reply = await this.invoke({kind:'recommend',messages,maxTokens:cfg.maxTokens,...(registered.size ? {tools:[...registered.values()],tool_choice:toolChoice} : {}),signal});
      modelCalls += 1;
      if (!reply.ok) return {...reply,...meta(),...(registered.size ? {tool_protocol_status:'http_or_transport_error',tool_protocol_support:'unverified'} : {})};
      if (reply.tool_calls?.length) {
        if (!registered.size || toolChoice === 'none') return {...llmError('LLM_TOOL_PROTOCOL_UNSUPPORTED'),...meta(),tool_protocol_status:'tool_choice_ignored'};
        messages.push(reply.assistant_message ?? {role:'assistant',content:null,tool_calls:reply.tool_calls});
        for (const call of reply.tool_calls) {
          const name = call.function.name;
          let args = null, result;
          if (!registered.has(name)) result = {ok:false,error:{code:'TOOL_NOT_REGISTERED'}};
          else {
            try { strictParse(call.function.arguments); args = JSON.parse(call.function.arguments); if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(); }
            catch { result = {ok:false,error:{code:'TOOL_ARGUMENTS_INVALID'}}; }
            if (!result) {
              if (signal?.aborted) result = {ok:false,error:{code:'TOOL_CANCELLED'}};
              else if (typeof executeTool !== 'function') result = {ok:false,error:{code:'TOOL_EXECUTOR_UNAVAILABLE'}};
              else {
                try {
                  result = await executeTool({name,arguments:args,id:call.id});
                  if (!result || typeof result !== 'object') result = {ok:false,error:{code:'TOOL_RESULT_INVALID'}};
                  result = redact(result);
                  if (JSON.stringify(result).length > 256000) result = {ok:false,error:{code:'TOOL_RESULT_TOO_LARGE'}};
                } catch { result = {ok:false,error:{code:'TOOL_EXECUTION_FAILED'}}; }
              }
            }
          }
          const safeResult = redact(result);
          toolAudit.push(redact({tool_call_id:call.id,name,arguments:registered.has(name) ? redact(args) : null,result:safeResult}));
          messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(safeResult)});
        }
        toolRounds += 1;
        continue;
      }
      outputAttempts += 1;
      parsed = parseModelJson(reply.text,{requireKey:'candidates',finishReason:reply.finish_reason,usage:reply.usage,maxTokens:cfg.maxTokens});
      if (parsed.ok) break;
      if (outputAttempts > this.outputRetries() || ['LLM_OUTPUT_TRUNCATED','LLM_OUTPUT_REASONING_EXHAUSTED'].includes(parsed.code)) return {...parsed,transport:reply.transport,attempts:reply.attempts,output_attempts:outputAttempts,...meta()};
    }
    const {product_references, ...candidateOutput} = parsed.value;
    return {ok:true,outputs:{candidates_json:dump(candidateOutput),...(product_references !== undefined ? {product_references_json:dump(product_references)} : {})},transport:reply.transport,attempts:reply.attempts ?? 0,output_attempts:outputAttempts,usage:reply.usage ?? null,model:reply.model ?? null,http_status:reply.http_status ?? null,finish_reason:reply.finish_reason ?? null,elapsed_ms:reply.elapsed_ms ?? null,...meta()};
  }

  /**
   * 呈现阶段：Dify 侧从未实现（workflow/dify-setup.md），因此在本地实现。
   * live 走模型；模型失败时如实失败，不静默改用本地实现顶替。
   */
  async requestPresentation({ requestJson, candidateJson, request, candidate, localFallback = false, visualDirectionText = null }) {
    if (localFallback) {
      // 显式要求的本地实现路径（不改契约、不联网）。
      if (!request || !candidate) return llmError("LLM_MODE_INVALID", { attempts: 0 });
      const local = buildLocalPresentation(request, candidate, { attempt: 1 });
      return {
        ok: true,
        outputs: { presentation_json: local.presentation_json },
        generated_by: "llm_local",
        transport: "local",
        local: true,
        sections: local.sections,
        bill: local.bill,
        notices: local.notices,
        attempts: 0,
      };
    }
    if (!this.available()) return llmError("LLM_NOT_CONFIGURED", { attempts: 0, transport: "live" });
    const envelope = buildPresentEnvelope({ requestJson, candidateJson, visualDirectionText });
    const maxOutputRetries = this.outputRetries();
    let reply = null;
    let parsed = null;
    let outputAttempts = 0;
    for (let round = 0; round <= maxOutputRetries; round += 1) {
      outputAttempts += 1;
      reply = await this.invoke({ kind: "present", messages: buildPresentMessages(envelope), maxTokens: this.config().maxTokens });
      if (!reply.ok) return reply;
      parsed = parseModelJson(reply.text, {
        finishReason: reply.finish_reason,
        usage: reply.usage,
        maxTokens: this.config().maxTokens,
      });
      if (parsed.ok) break;
      if (parsed.code === "LLM_OUTPUT_TRUNCATED" || parsed.code === "LLM_OUTPUT_REASONING_EXHAUSTED") break;
    }
    if (!parsed.ok) {
      return { ...parsed, transport: reply.transport, attempts: reply.attempts, output_attempts: outputAttempts };
    }
    return {
      ok: true,
      outputs: { presentation_json: dump(parsed.value) },
      generated_by: "llm_live",
      transport: reply.transport,
      attempts: reply.attempts ?? 0,
      output_attempts: outputAttempts,
      usage: reply.usage ?? null,
      model: reply.model ?? null,
      finish_reason: reply.finish_reason ?? null,
      elapsed_ms: reply.elapsed_ms ?? null,
    };
  }

  /** 输出格式重试上限：与全局 GLOBAL_REPAIR_LIMIT = 1 同量级，硬钳到 ≤1，绝不叠加成两次自动修订。 */
  outputRetries() {
    const configured = Number(this.config().outputRetries);
    return Number.isFinite(configured) ? Math.max(0, Math.min(Math.floor(configured), 1)) : 0;
  }

  /**
   * 第 1 步：**自然语言 ⇒ 现有 intake 字段** 的一次解析调用。
   *
   * 与 requestCandidates/requestPresentation 共用同一条链路：transport（超时/重试上限）→
   * invoke（额度硬闸 + 记账）→ parseModelJson（剥离思考块与 ```json 围栏、严格 JSON）。
   * 输出格式重试最多 1 次（outputRetries 硬钳 ≤1），**不叠加**成多次自动修复；
   * 「被截断」两种形态都不重试（重试只会再花一次额度）。
   *
   * ⛔ 本方法只负责「拿到一个严格 JSON 对象」；字段合法性、枚举白名单、范围钳制
   *    一律在 llm/intake-parse.mjs 里用代码判定，模型没有解释权。
   *
   * @param {{messages: Array<object>, maxTokens?: number}} input
   */
  async requestIntakeParse({ messages, maxTokens = null }) {
    if (!this.available()) return llmError("LLM_NOT_CONFIGURED", { attempts: 0, transport: "live" });
    const cfg = this.config();
    const effective = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : Number(cfg.parseMaxTokens) > 0 ? Math.floor(cfg.parseMaxTokens) : cfg.maxTokens;
    const maxOutputRetries = this.outputRetries();
    let reply = null;
    let parsed = null;
    let outputAttempts = 0;
    for (let round = 0; round <= maxOutputRetries; round += 1) {
      outputAttempts += 1;
      reply = await this.invoke({ kind: "intake_parse", messages, maxTokens: effective });
      if (!reply.ok) return { ...reply, output_attempts: outputAttempts };
      parsed = parseModelJson(reply.text, { finishReason: reply.finish_reason, usage: reply.usage, maxTokens: effective });
      if (parsed.ok) break;
      if (parsed.code === "LLM_OUTPUT_TRUNCATED" || parsed.code === "LLM_OUTPUT_REASONING_EXHAUSTED") break;
    }
    if (!parsed.ok) {
      return { ...parsed, transport: reply?.transport ?? null, attempts: reply?.attempts ?? 0, output_attempts: outputAttempts };
    }
    return {
      ok: true,
      outputs: { parse_json: dump(parsed.value) },
      parse: parsed.value,
      max_tokens: effective,
      transport: reply.transport,
      attempts: reply.attempts ?? 0,
      output_attempts: outputAttempts,
      usage: reply.usage ?? null,
      model: reply.model ?? null,
      finish_reason: reply.finish_reason ?? null,
      elapsed_ms: reply.elapsed_ms ?? null,
    };
  }

  /** 排除项识别：返回模型原始严格 JSON 字符串，交由 exclusion-checker 校验。 */
  async recognizeExclusions({ dislikes, clarifications = [] }) {
    if (!this.available()) throw Object.assign(new Error("LLM_NOT_CONFIGURED"), { code: "LLM_NOT_CONFIGURED" });
    const maxOutputRetries = this.outputRetries();
    let reply = null;
    let parsed = null;
    for (let round = 0; round <= maxOutputRetries; round += 1) {
      reply = await this.invoke({ kind: "exclusions", messages: buildExclusionsMessages({ dislikes, clarifications }), maxTokens: this.config().maxTokens });
      if (!reply.ok) throw Object.assign(new Error(reply.code), { code: reply.code });
      parsed = parseModelJson(reply.text, { requireKey: "ai_exclusion_candidates", finishReason: reply.finish_reason, usage: reply.usage, maxTokens: this.config().maxTokens });
      if (parsed.ok) break;
      if (parsed.code === "LLM_OUTPUT_TRUNCATED" || parsed.code === "LLM_OUTPUT_REASONING_EXHAUSTED") break;
    }
    if (!parsed.ok) throw Object.assign(new Error(parsed.code), { code: parsed.code });
    return dump(parsed.value);
  }
}

/** 进程内单例：与 mediaProvider 同样的用法（pipeline 直接 import 使用）。 */
export const llmProvider = new LlmProvider();

/** 供 pipeline 使用的适配包装，保持原有调用形状 (requestJson, retrieval)。 */
export async function requestCandidates(requestJson, retrieval = null, options = {}) {
  return llmProvider.requestCandidates({
    requestJson,
    intakeJson: options.intakeJson ?? null,
    retrieval,
    library: options.library ?? null,
    inputParse: options.inputParse ?? null,
    tools: options.tools ?? [],
    executeTool: options.executeTool,
    signal: options.signal,
    maxToolRounds: options.maxToolRounds,
  });
}

export async function requestPresentation(requestJson, candidateJson, options = {}) {
  return llmProvider.requestPresentation({
    requestJson,
    candidateJson,
    request: options.request ?? null,
    candidate: options.candidate ?? null,
    localFallback: options.localFallback === true,
    visualDirectionText: options.visualDirectionText ?? null,
  });
}
