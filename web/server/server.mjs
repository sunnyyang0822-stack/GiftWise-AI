/**
 * GiftWise AI · web 接入层 HTTP 服务（零依赖，只用 node: 内置模块）。
 *
 * 启动： node web/server/server.mjs        （默认 http://127.0.0.1:8787）
 * 路由：
 *   GET  /                      中文前端页面
 *   GET  /api/config            标签表、区间、模式与模拟标识（前后端共用一份）
 *   POST /api/intake/validate   服务端确定性适配，返回中文错误
 *   POST /api/recommendations   生成三候选 → 独立校验 → 最多一次修订 → 等待选择
 *   POST /api/presentations     选择校验 → 四段呈现 → 呈现复核（含全局额度）
 *   GET  /api/runs/:id          可信任务快照最小视图（不含密钥）
 *   GET  /healthz               健康检查
 *
 * 安全边界：Dify Key 只在服务端环境变量；本进程从不把密钥写入响应或日志。
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

import {
  MODE,
  hasDifyConfig,
  difyConfig,
  PURSUIT_CONTRACT_READY,
  PURSUIT_READY_MESSAGE,
  PURSUIT_NOT_READY_MESSAGE,
  MOCK_MODE_NOTICE,
  MOCK_CANDIDATE_NOTICE,
  MOCK_PRESENTATION_NOTICE,
  BUDGET_RANGES,
  DEADLINE_RANGES,
  LIMITS,
  PORT,
  HOST,
  CLIENT_TIMEOUT_MS,
  budget_slider,
  budget_modes,
} from "./config.mjs";
import {
  PRODUCT_RELATIONS,
  CLOSENESS,
  OCCASIONS,
  INTERESTS,
  GIFT_STYLES,
  EXCLUSIONS,
  UNKNOWN_INTERESTS_HINT,
} from "./labels.mjs";
import { adaptIntakeObject } from "./intake.mjs";
import { runRecommendation, runPresentation } from "./pipeline.mjs";
import { getRun, runCount } from "./store.mjs";
import { recognizeExclusions } from "./exclusion-provider.mjs";
import { checkAiExclusions } from "./exclusion-checker.mjs";
import { createAnalysis, getAnalysis } from "./exclusion-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "public");
const MAX_BODY_BYTES = 262144;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        resolve({ ok: false, code: "LIMIT_EXCEEDED", message: "请求体超过 262144 字节上限" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (aborted) return;
      resolve({ ok: true, raw: Buffer.concat(chunks).toString("utf8") });
    });
    req.on("error", () => {
      if (!aborted) resolve({ ok: false, code: "INVALID_JSON", message: "读取请求体失败" });
    });
  });
}

function parseJsonBody(raw) {
  if (raw.trim() === "") return { ok: true, value: {} };
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, code: "INVALID_JSON", message: "请求体根节点必须是对象" };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, code: "INVALID_JSON", message: "请求体不是合法 JSON" };
  }
}

async function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safe = normalize(relative).replace(/^([.][.][/\\])+/, "");
  if (safe.includes("..")) {
    sendJson(res, 400, { status: "error", errors: [{ code: "INVALID_PATH", message: "非法路径" }] });
    return;
  }
  const target = join(PUBLIC_DIR, safe);
  if (!target.startsWith(PUBLIC_DIR)) {
    sendJson(res, 400, { status: "error", errors: [{ code: "INVALID_PATH", message: "非法路径" }] });
    return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(target)] || "application/octet-stream",
      "content-length": data.length,
      "cache-control": "no-store",
    });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404：页面不存在。");
  }
}

function apiConfig() {
  const cfg = difyConfig();
  return {
    mode: MODE.current,
    // 只暴露布尔值，绝不暴露密钥、地址或任何凭证内容
    dify_configured: hasDifyConfig(),
    dify_published_verified: cfg.publishedVerified,
    pursuit_contract_ready: PURSUIT_CONTRACT_READY,
    pursuit_notice: PURSUIT_CONTRACT_READY ? PURSUIT_READY_MESSAGE : PURSUIT_NOT_READY_MESSAGE,
    notices: {
      mock_mode: MOCK_MODE_NOTICE,
      mock_candidates: MOCK_CANDIDATE_NOTICE,
      mock_presentation: MOCK_PRESENTATION_NOTICE,
    },
    unknown_interests_hint: UNKNOWN_INTERESTS_HINT,
    labels: {
      relations: PRODUCT_RELATIONS,
      closeness: CLOSENESS,
      occasions: OCCASIONS,
      interests: INTERESTS,
      gift_styles: GIFT_STYLES,
      exclusions: EXCLUSIONS,
    },
    ranges: { budget: BUDGET_RANGES, deadline: DEADLINE_RANGES },
    budget_slider,
    budget_modes,
    limits: {
      currency: "CNY",
      intake_bytes: LIMITS.intakeBytes,
      max_array_items: LIMITS.maxArrayItems,
      max_string_code_points: LIMITS.maxStringCodePoints,
      candidates: LIMITS.candidatesPerBatch,
      global_repair_limit: 1,
    },
    client_timeout_ms: CLIENT_TIMEOUT_MS,
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, apiConfig());
    return true;
  }
  if (req.method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, { status: "ok", mode: MODE.current, runs: runCount() });
    return true;
  }
  if (req.method === "GET" && pathname.startsWith("/api/runs/")) {
    const run = getRun(pathname.slice("/api/runs/".length));
    if (!run) {
      sendJson(res, 404, {
        status: "error",
        errors: [{ code: "RECOMMENDATION_NOT_FOUND", path: "recommendation_run_id", message: "没有找到该推荐记录。" }],
      });
      return true;
    }
    sendJson(res, 200, {
      recommendation_run_id: run.run_id,
      created_at: run.created_at,
      mode: run.mode,
      status: run.status,
      repair_count: run.repair_count,
      remaining_repairs: Math.max(0, 1 - run.repair_count),
      selectable_candidate_ids: run.selectable_candidate_ids,
      selected_candidate_id: run.selected_candidate_id,
      call_counts: run.call_counts,
    });
    return true;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { status: "error", errors: [{ code: "METHOD_NOT_ALLOWED", message: "不支持的请求方法" }] });
    return true;
  }

  const body = await readBody(req);
  if (!body.ok) {
    sendJson(res, 400, { status: "error", errors: [{ code: body.code, path: "$", message: body.message }] });
    return true;
  }
  const parsed = parseJsonBody(body.raw);
  if (!parsed.ok) {
    sendJson(res, 400, { status: "error", errors: [{ code: parsed.code, path: "$", message: parsed.message }] });
    return true;
  }
  const payload = parsed.value;

  if (pathname === "/api/intake/validate") {
    const result = adaptIntakeObject(payload.intake);
    if (result.status === "ready" && typeof payload.intake?.dislikes === "string" && payload.intake.dislikes.trim()) {
      result.status = "needs_input";
      result.errors = [...result.errors, { code: "INTAKE_CLARIFICATION_REQUIRED", path: "intake.dislikes", message: "请先完成不喜欢内容的识别与确认。" }];
    }
    sendJson(res, 200, {
      // 这里**不**回显 request_json：派生请求只留在服务端，避免前端误把派生值当输入。
      status: result.status,
      errors: result.errors,
      derived_hint:
        result.status === "ready"
          ? "服务端已完成确定性适配；可提交生成三方案。"
          : "请先按上面的中文提示修改；未做任何默认值补全。",
    });
    return true;
  }

  if (pathname === "/api/exclusions/analyze") {
    const basic = adaptIntakeObject(payload.intake);
    if (basic.status !== "ready") {
      sendJson(res, 200, { status: "needs_input", mode: MODE.current, analysis_id: null, candidates: [], errors: basic.errors });
      return true;
    }
    const dislikes = typeof payload.intake?.dislikes === "string" ? payload.intake.dislikes : "";
    const provider = MODE.current === "dify" ? undefined : undefined;
    const recognized = await recognizeExclusions({ dislikes, mode: MODE.current, provider });
    if (!recognized.ok) {
      sendJson(res, 200, { status: "needs_input", mode: recognized.mode, analysis_id: null, candidates: [], errors: recognized.errors });
      return true;
    }
    if (recognized.ai_json === null) {
      sendJson(res, 200, { status: "needs_input", mode: recognized.mode, analysis_id: null, candidates: [], errors: [] });
      return true;
    }
    const checked = checkAiExclusions(recognized.ai_json, dislikes);
    const analysisId = createAnalysis({ intake: payload.intake, mode: recognized.mode, candidates: checked.candidates, status: checked.status, errors: checked.errors });
    sendJson(res, 200, { status: checked.status, mode: recognized.mode, analysis_id: analysisId, candidates: checked.candidates, errors: checked.errors });
    return true;
  }

  if (pathname === "/api/recommendations") {
    let analysis = null;
    if (payload.exclusion_confirmation?.analysis_id) analysis = getAnalysis(payload.exclusion_confirmation.analysis_id);
    const outcome = await runRecommendation({ intake: payload.intake, demo: payload.demo, mode: MODE.current, exclusion_confirmation: payload.exclusion_confirmation, analysis });
    if (outcome.kind === "report") {
      sendJson(res, 200, outcome.report);
      return true;
    }
    const status = outcome.kind === "infrastructure_error" ? 503 : 400;
    sendJson(res, status, {
      status: outcome.status,
      errors: outcome.errors,
      mode: outcome.mode,
      notices: outcome.notices || [],
    });
    return true;
  }

  if (pathname === "/api/presentations") {
    const outcome = await runPresentation({
      runId: payload.recommendation_run_id,
      selectedCandidateId: payload.selected_candidate_id,
      demo: payload.demo,
    });
    if (outcome.kind === "presentation") {
      sendJson(res, 200, outcome.view);
      return true;
    }
    if (outcome.kind === "presentation_failed") {
      // 明确失败：不伪装为完成，也不自动替用户换方案。
      sendJson(res, 409, outcome.view);
      return true;
    }
    if (outcome.kind === "not_found") {
      sendJson(res, 404, { status: outcome.status, errors: outcome.errors });
      return true;
    }
    if (outcome.kind === "infrastructure_error") {
      sendJson(res, 503, { status: outcome.status, errors: outcome.errors });
      return true;
    }
    sendJson(res, 400, { status: outcome.status, errors: outcome.errors });
    return true;
  }

  sendJson(res, 404, { status: "error", errors: [{ code: "NOT_FOUND", message: "没有这个接口。" }] });
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { status: "error", errors: [{ code: "METHOD_NOT_ALLOWED", message: "不支持的请求方法" }] });
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (err) {
    // 不把堆栈或内部细节返回给浏览器；也不记录任何密钥。
    sendJson(res, 500, {
      status: "error",
      errors: [{ code: "INTERNAL_ERROR", path: "$", message: "服务端暂时不可用，请稍后重试。" }],
    });
  }
});

server.listen(PORT, HOST, () => {
  const mode = MODE.current;
  process.stdout.write(
    `GiftWise web 接入层已启动：http://${HOST}:${PORT}\n` +
      `模式：${mode}${mode === "mock" ? "（模拟数据；Dify 未配置或未确认发布）" : "（真实 Dify；仍以服务端返回为准）"}\n` +
      `追求对象契约已落地：${PURSUIT_CONTRACT_READY ? "是（工作区未提交改动）" : "否（提交会被拒绝并给出中文提示）"}\n`,
  );
});

export { server };
