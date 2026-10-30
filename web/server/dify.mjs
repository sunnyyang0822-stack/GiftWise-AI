/**
 * Dify 调用（只在服务端执行）。
 *
 * 硬约束：
 *   - DIFY_API_KEY 只从服务端环境变量读取，绝不返回给浏览器、绝不写日志、绝不进仓库；
 *   - 没有配置时返回 DIFY_NOT_CONFIGURED，**不静默切回模拟并标成真实成功**；
 *   - 工作流未确认发布时返回 DIFY_NOT_PUBLISHED；
 *   - 网络/超时/非 2xx 一律作为失败上报，由调用方决定是否占用修订额度。
 *
 * 重要限制（不得读作已联通）：本客户端按 Dify 官方 `/workflows/run`（blocking）约定编写，
 * 但本机无凭证、Dify 侧仍是未发布草稿，**从未实际调用成功过一次**。
 */

import { difyConfig, hasDifyConfig } from "./config.mjs";
import { dump } from "./jsonstrict.mjs";

function safeError(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

/**
 * @param {string} path 工作流执行路径
 * @param {Record<string, string>} inputs Dify 输入变量（intake/request/candidates 均为 String）
 */
export async function runWorkflow(path, inputs) {
  const cfg = difyConfig();
  if (!hasDifyConfig()) {
    return safeError("DIFY_NOT_CONFIGURED", "服务端未配置 Dify 地址与密钥，当前只能使用模拟数据模式。");
  }
  if (!cfg.publishedVerified) {
    return safeError(
      "DIFY_NOT_PUBLISHED",
      "Dify 侧工作流尚未确认发布（草稿只有「用户输入 → 代码执行」，无模型与结束节点），拒绝把模拟结果标记为真实调用。",
    );
  }
  const url = `${cfg.base.replace(/\/+$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs,
        response_mode: "blocking",
        user: "giftwise-web",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return safeError("DIFY_HTTP_ERROR", `Dify 返回 HTTP ${response.status}，未采用该次输出。`, { status: response.status });
    }
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return safeError("DIFY_BAD_RESPONSE", "Dify 响应不是可解析的 JSON，未采用该次输出。");
    }
    const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
    return { ok: true, outputs: data.outputs || {}, workflowRunId: data.id || null, raw_status: data.status || null };
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      return safeError("DIFY_TIMEOUT", `Dify 调用超过 ${cfg.timeoutMs} 毫秒未返回，已按超时处理。`);
    }
    return safeError("DIFY_REQUEST_FAILED", "Dify 调用失败（网络或服务不可用），未采用该次输出。");
  } finally {
    clearTimeout(timer);
  }
}

/** 推荐阶段：把已适配的 request 交给 Dify 生成三候选。 */
export async function requestCandidates(requestJson) {
  const cfg = difyConfig();
  return runWorkflow(cfg.recommendPath, { action: "recommend", request_json: requestJson, request_json_type: "String" });
}

/** 呈现阶段：只围绕用户已选候选生成呈现内容。 */
export async function requestPresentation(requestJson, candidateJson) {
  const cfg = difyConfig();
  return runWorkflow(cfg.presentationPath, {
    action: "present",
    request_json: requestJson,
    selected_candidate_json: dump(JSON.parse(candidateJson)),
  });
}
