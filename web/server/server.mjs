import { randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
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
 *   GET  /api/media/tasks|assets/:id  生图任务状态与图片字节
 *   GET  /api/catalog/images/:id      真实商品图**同源代理**（库内 image_id 白名单 + https 源站）
 *   GET  /api/style-boards/:sha.ext   第 3–4 步 channel=image 时的真实风格板
 *   GET  /healthz               健康检查
 *
 * 安全边界：Dify/大模型/生图 Key 只在服务端环境变量；本进程从不把密钥写入响应或日志。
 */

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
import {readSourceImage,cacheSourceImage,SOURCE_IMAGE_TYPES} from './catalog/source-image-cache.mjs';
import {validateSourceImage} from './collect/domestic-detail.mjs';

import {
  MODE,
  hasDifyConfig,
  difyConfig,
  hasLlmConfig,
  PURSUIT_CONTRACT_READY,
  pursuitNotice,
  PURSUIT_NOT_READY_MESSAGE,
  MOCK_MODE_NOTICE,
  MOCK_CANDIDATE_NOTICE,
  MOCK_PRESENTATION_NOTICE,
  LLM_MODE_NOTICE,
  BUDGET_RANGES,
  DEADLINE_RANGES,
  LIMITS,
  PORT,
  HOST,
  CLIENT_TIMEOUT_MS,
  budget_slider,
  budget_modes,
  localDbPath,
  localDbSource,
  INTAKE_PARSE_CONFIG,
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
import {mediaProvider} from "./media/provider.mjs";
import { attestation, clientRevisionFrom } from "./attest.mjs";
import { openCatalogDb, findImageById } from "./catalog/db.mjs";
import { CATALOG_CONFIG, IMAGE_GENERATION_CONFIG, RETRIEVAL_CONFIG } from "./config.mjs";
import { STYLE_BOARD_DIR } from "./visual/provider.mjs";
import { llmProvider } from "./llm/provider.mjs";
import { parseIntakeText } from "./llm/intake-parse.mjs";
import { withExclusionContext } from "./exclusion-context.mjs";
import { analyzeExclusionIntake, prepareExclusionRecommendation } from "./exclusion-service.mjs";
import { getAnalysis } from "./exclusion-store.mjs";

const sessionSecret=randomBytes(32);
function ownerScope(req,res){
 const raw=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('gw_task_session='))?.slice(16);
 if(raw&&/^[a-f0-9]{48}\.[a-f0-9]{64}$/.test(raw)){const [id,mac]=raw.split('.');const expected=createHmac('sha256',sessionSecret).update(id).digest();if(timingSafeEqual(Buffer.from(mac,'hex'),expected))return id;}
 const id=randomBytes(24).toString('hex');const mac=createHmac('sha256',sessionSecret).update(id).digest('hex');
 res.setHeader('Set-Cookie',`gw_task_session=${id}.${mac}; Path=/; HttpOnly; SameSite=Strict${req.socket.encrypted?'; Secure':''}`);return id;
}
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

/* --------------------------------------------------- 真实商品图同源代理 */

const CATALOG_IMAGE_CACHE = fileURLToPath(new URL("../../.tmp/catalog-images/", import.meta.url));
/** 只允许这些图床/CDN 主机名直连（https only），避免把代理变成任意 URL 抓取器。 */
const CATALOG_IMAGE_HOSTS = new Set([
  "y.zdmimg.com",
  "q.zdmimg.com",
  "img.alicdn.com",
  "gd-hbimg.huaban.com",
  "img14.360buyimg.com",
  "img10.360buyimg.com",
  "img30.360buyimg.com",
  "img.alicdn.com",
]);
const IMAGE_EXT_BY_TYPE = SOURCE_IMAGE_TYPES;

/**
 * 读取（必要时抓取并缓存）本地库里登记的商品图，然后**原样**回给浏览器。
 * 只认 `image_id`（sha256 前 32 位，来自库表），因此不可能被用来抓任意 URL。
 * 抓取失败 → 返回 false，由调用方给出诚实的 404 原因码（⛔ 不用占位图）。
 */
async function serveCatalogImage(imageId, res) {
  let db;
  try {
    db = openCatalogDb(localDbPath());
  } catch {
    return false;
  }
  try {
    const record = findImageById(db, imageId);
    if (!record || typeof record.url !== "string") return false;
    const cached = await readImageCache(imageId);
    if (cached) {
      res.writeHead(200, { "content-type": cached.type, "content-length": cached.bytes.length, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
      res.end(cached.bytes);
      return true;
    }
    let parsed;
    try {
      parsed = new URL(record.url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" || !CATALOG_IMAGE_HOSTS.has(parsed.hostname)) return false;
    const validated=await validateSourceImage(parsed.href,{signal:AbortSignal.timeout(8000),includeBytes:true});
    if(!validated.ok)return false;
    const {bytes,mime:type}=validated;
    cacheSourceImage(imageId,validated);
    res.writeHead(200, { "content-type": type, "content-length": bytes.length, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
    res.end(bytes);
    return true;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

async function readImageCache(imageId) {
  try{return readSourceImage(imageId);}catch{return null;}
}

async function readStyleBoard(file) {
  if (!/^[a-f0-9]{64}\.[a-z]{3,4}$/.test(file)) throw new Error("INVALID");
  return readFile(join(STYLE_BOARD_DIR, file));
}

function apiConfig() {
  const cfg = difyConfig();
  return {
    mode: MODE.current,
    // 只暴露布尔值，绝不暴露密钥、地址或任何凭证内容
    dify_configured: hasDifyConfig(),
    dify_published_verified: cfg.publishedVerified,
    // 直连大模型：只暴露布尔值，不暴露地址、模型名或凭证内容
    llm_configured: hasLlmConfig(),
    /* 服务态自证（**集成新增**，取自 `codex/backend-api-integration-20261031` 的 services 块写法）：
       每一项独立标注、互不背书——「配置好了」不等于「调用成功过」，「真实检索」不等于「已核实价格」。
       `reachable_verified` 一律为 false：本进程没有做过成功调用前不得自称为已联通。 */
    services: {
      mock: {
        active: MODE.current === "mock",
        description: "接入层内置固定模拟数据，不是模型真实输出。",
      },
      llm: {
        active: MODE.current === "llm",
        configured: hasLlmConfig(),
        reachable_verified: false,
        description: "直连 OpenAI 兼容大模型；未做过成功调用前一律不标记为已联通。",
      },
      dify: {
        active: MODE.current === "dify",
        configured: hasDifyConfig(),
        published_verified: cfg.publishedVerified,
        reachable_verified: false,
        description: "真实 Dify 工作流（历史对照路径）；未做过成功调用前一律不标记为已联通。",
      },
      seedream: {
        // 付费生图必须同时满足「显式开启」+「服务端有密钥」+「本次运行已授权」。
        enabled: IMAGE_GENERATION_CONFIG.enabled,
        configured: Boolean((process.env.IMAGE_API_KEY || "").trim()),
        active: (MODE.current === "llm" || MODE.current === "dify") && IMAGE_GENERATION_CONFIG.enabled && Boolean((process.env.IMAGE_API_KEY || "").trim()),
        description: "ModelVerse Seedream 4.5 受控图像 provider；仅服务端显式授权且呈现复核通过时调用；受控联调不等于真实视觉验收。",
      },
      retrieval: {
        active: RETRIEVAL_CONFIG.provider !== "unavailable",
        provider: RETRIEVAL_CONFIG.provider,
        description: "公开来源受限检索；未启用时价格为估算，不声称已核实。",
      },
      catalog: (() => {
        /* 库路径的**单一事实来源**是 config.mjs:localDbPath()（GW_LOCAL_DB > GIFTWISE_CATALOG_DB > 真实库默认）。
           这里同时报出「解析出的路径」「路径来源」「文件是否存在」，让复核者一眼看出
           本进程读的是哪个库、这个路径是谁配的，而不是只看到一个布尔值。 */
        const dbPath = localDbPath();
        const present = existsSync(dbPath);
        return {
          // 在线请求路径上只读本地库，不联网抓取；库路径不是密钥。
          active: present,
          db_present: present,
          db_path: dbPath,
          db_path_source: localDbSource(),
          db_path_env_names: ["GW_LOCAL_DB", "GIFTWISE_CATALOG_DB"],
          notice: present
            ? `本地真实商品库已就绪：${dbPath}（来源：${localDbSource()}）。`
            : `⚠ 读不到本地真实商品库：${dbPath} 不存在（来源：${localDbSource()}）。` +
              "请设置 GW_LOCAL_DB 指向真实库，或先运行一次采集；在库可用之前 /api/catalog 会如实返回空态 + 原因码，不会返回任何假商品。",
          description: "本地真实商品库（离线抓取、在线只读）；不生成、不补全任何商品行。",
        };
      })(),
    },
    pursuit_contract_ready: PURSUIT_CONTRACT_READY,
    /* 文案由**真实运行模式与凭证配置**现算（必修 4：不允许硬编码过期状态）。 */
    pursuit_notice: pursuitNotice(),
    /* 第 1 步自然语言解析的能力自证（含建议客户端超时；不含任何凭证信息）。 */
    intake_parse: {
      enabled: INTAKE_PARSE_CONFIG.enabled,
      endpoint: "/api/intake/parse",
      method: "POST",
      client_timeout_ms: INTAKE_PARSE_CONFIG.clientTimeoutMs,
      budget_band_cny: INTAKE_PARSE_CONFIG.budgetBandCny,
      days_band: null,
      literal_preference_gate: INTAKE_PARSE_CONFIG.literalPreferenceGate ? "gate" : "warning",
      description:
        "把用户的自然语言输入解析成**现有** intake 字段（字段清单与选项由服务端代码固定，模型只能对应、不能新增）；" +
        "不做多轮自由对话；解析失败一律回落到用户提交的表单字段。",
    },
    notices: {
      mock_mode: MOCK_MODE_NOTICE,
      mock_candidates: MOCK_CANDIDATE_NOTICE,
      mock_presentation: MOCK_PRESENTATION_NOTICE,
      llm_mode: LLM_MODE_NOTICE,
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
  const owner=ownerScope(req,res);

  if (req.method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, { ...apiConfig(), attestation: attestation({ clientCodeRevision: clientRevisionFrom(req.headers) }) });
    return true;
  }
  if (req.method === "GET" && pathname === "/healthz") {
    sendJson(res, 200, { status: "ok", mode: MODE.current, runs: runCount(), attestation: attestation({ clientCodeRevision: clientRevisionFrom(req.headers) }) });
    return true;
  }
  /* 真实商品目录（**集成新增**）：集成线把 `feat/opencli-local-db` 的 localdb 读库模块
     原样放进 `web/server/localdb-real/`（与工作流用的 localdb/ 分开，避免互相覆盖），
     这里只做一层只读转发。响应自带**进程自证**（`process.stale_process`），
     便于复核者判断「这份数据是不是旧进程产出的」。空态一律带 reason_code，不伪造商品。 */
  if (req.method === "GET" && pathname === "/api/catalog") {
    const { buildCatalog } = await import("./localdb-real/catalog.mjs");
    /* ⛔ 必须显式传 dbPath：不传就会落到 localdb-real 自己的默认值，历史上因此出现
       「推荐流水线读真实库、/api/catalog 读仓库空库」的分叉（2026-10-31 缺陷）。
       现在两侧都走 config.mjs:localDbPath() 这唯一解析点。 */
    const catalog = buildCatalog({
      dbPath: localDbPath(),
      keyword: url.searchParams.get("keyword") || undefined,
      source: url.searchParams.get("source") || undefined,
      since: url.searchParams.get("since") || undefined,
      onlyCny: url.searchParams.get("only_cny") === "1",
      limit: Number(url.searchParams.get("limit") || 50),
    });
    sendJson(res, 200, { ...catalog, db_path_source: localDbSource() });
    return true;
  }

  // Only previously validated reference-image bytes; never accepts a model/client URL.
  if (req.method === 'GET' && /^\/api\/reference\/images\/[a-f0-9]{32,64}$/.test(pathname)) {
    const cached=await readImageCache(pathname.split('/').at(-1));
    if(!cached){sendJson(res,404,{status:'error',errors:[{code:'REFERENCE_IMAGE_NOT_FOUND',message:'参考图片不可用。'}]});return true;}
    res.writeHead(200,{'content-type':cached.type,'content-length':cached.bytes.length,'cache-control':'private, max-age=86400','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"});res.end(cached.bytes);return true;
  }
  /* 真实商品图代理：**同源**才允许前端渲染（`media-view.js` 的 localMediaUrl 只认 `/...`）。
     只放行库内确实存在的 image_id，且只允许 https 源站；失败一律诚实 404 + 原因码，
     ⛔ 绝不回落到占位图或库存图。 */
  if (req.method === "GET" && /^\/api\/catalog\/images\/[a-f0-9]{32,64}$/.test(pathname)) {
    const imageId = pathname.split("/").at(-1);
    const outcome = await serveCatalogImage(imageId, res);
    if (!outcome) {
      sendJson(res, 404, { status: "error", errors: [{ code: "CATALOG_IMAGE_NOT_FOUND", path: "image_id", message: "该商品图不在本地库中，或源站不可用；不使用占位图代替。" }] });
    }
    return true;
  }
  /* 风格板（第 3–4 步 channel=image 时的真实生图产物）静态读取，同样只认 sha256 文件名。 */
  if (req.method === "GET" && /^\/api\/style-boards\/[a-f0-9]{64}\.[a-z]{3,4}$/.test(pathname)) {
    try {
      const bytes = await readStyleBoard(pathname.split("/").at(-1));
      const type = pathname.endsWith(".png") ? "image/png" : pathname.endsWith(".webp") ? "image/webp" : "image/jpeg";
      res.writeHead(200, { "content-type": type, "content-length": bytes.length, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
      res.end(bytes);
    } catch {
      sendJson(res, 404, { status: "error", errors: [{ code: "STYLE_BOARD_NOT_FOUND", path: "style_board", message: "没有这块风格板（可能从未生成或已被清理）。" }] });
    }
    return true;
  }
  if(req.method==='GET'&&/^\/api\/media\/(tasks|assets)\/[a-f0-9]{64}$/.test(pathname)){
    try {
      const id=pathname.split('/').at(-1);
      const stored=await mediaProvider.store.read(id);const run=getRun(stored.run_id);
      if(!run||run.owner_scope!==owner)throw new Error('NOT_FOUND');
      const record=await mediaProvider.task(run,id);
      if(pathname.includes('/tasks/')){run.media=record.media;sendJson(res,200,record.media);return true;}
      if(record.media.status!=='ready')throw new Error('NOT_FOUND');
      const bytes=await mediaProvider.store.readAsset(record);
      res.writeHead(200,{'content-type':record.asset.type,'content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'"});res.end(bytes);return true;
    }catch{sendJson(res,404,{status:'error',errors:[{code:'MEDIA_NOT_FOUND',message:'图片任务不存在、未就绪或不属于当前会话。'}]});return true;}
  }
  if (req.method === "GET" && pathname.startsWith("/api/runs/")) {
    const run = getRun(pathname.slice("/api/runs/".length));
    if (!run || run.owner_scope !== owner) {
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
          ? "可以继续挑选礼物。"
          : "请补充上面提示的信息。",
    });
    return true;
  }

  if (pathname === "/api/exclusions/analyze") {
    const result = await analyzeExclusionIntake({
      intake: payload.intake,
      continuation: payload.continuation,
      mode: MODE.current,
      owner,
      provider: MODE.current === "llm" ? args => llmProvider.recognizeExclusions(args) : undefined,
    });
    sendJson(res, 200, result);
    return true;
  }

  /* 第 1 步：自然语言 ⇒ **现有** intake 字段（唯一职责，不做自由对话）。
     请求体：{ text | natural_language: string, form?: <当前表单对象> }
     响应：intake（可直接提交给 /api/intake/validate 或 /api/recommendations）、
           parse（未提到的字段 / 推断标记 / 用户原值回显 / 预算带宽 / 非时间必要确认）、
           llm（真实调用与否、usage、finish_reason）、notices（降级如实说明）。 */
  if (pathname === "/api/intake/parse") {
    const text = typeof payload.text === "string" ? payload.text : typeof payload.natural_language === "string" ? payload.natural_language : "";
    const form = payload.form && typeof payload.form === "object" && !Array.isArray(payload.form) ? payload.form : payload.intake && typeof payload.intake === "object" ? payload.intake : {};
    const result = await parseIntakeText({ text, form });
    sendJson(res, 200, {
      status: result.status,
      source: result.source,
      reason_code: result.reason_code,
      degraded: result.degraded,
      mode: MODE.current,
      // 落到**同一个** intake 对象上：这就是第 2 步 recommend 的输入。
      intake: result.intake,
      intake_validation: result.intake_validation,
      parse: result.parse,
      llm: result.llm,
      notices: result.notices,
      elapsed_ms: result.elapsed_ms,
      next: result.intake_validation.status === "ready" ? "POST /api/recommendations（body: { intake }）" : "按 intake_validation.errors 追问后再提交",
    });
    return true;
  }

  if (pathname === "/api/recommendations") {
    let analysis = null;
    if (payload.exclusion_confirmation?.analysis_id) analysis = getAnalysis(payload.exclusion_confirmation.analysis_id);
    if(analysis?.owner_scope!==owner)analysis=null;
    const cancellation=new AbortController();res.once("close",()=>{if(!res.writableEnded)cancellation.abort();});
    /* 服务端内联解析（可选，保证「读懂输入 ⇒ 影响之后的返回」这条链端到端成立）：
       请求体里给了自然语言（`natural_language` / `text`）时**先解析再走原流程**，
       解析结果落到**同一个** intake 对象上；解析失败/输出非法 ⇒ 用用户提交的 intake
       原样继续（降级如实写进 notices 与 report.nl_parse），⛔ 绝不因为解析失败卡住用户。
       解析结果不是后门：下面 runRecommendation 里仍然走同一套 adapt + checker 硬校验。 */
    const naturalText =
      typeof payload.natural_language === "string" ? payload.natural_language : typeof payload.text === "string" ? payload.text : "";
    let effectiveIntake = payload.intake;
    let inputParse = null;
    let parseNotice = [];
    if (naturalText.trim()) {
      const parseResult = await parseIntakeText({ text: naturalText, form: payload.intake && typeof payload.intake === "object" ? payload.intake : {} });
      effectiveIntake = parseResult.intake;
      inputParse = {
        status: parseResult.status,
        source: parseResult.source,
        reason_code: parseResult.reason_code,
        degraded: parseResult.degraded,
        llm: parseResult.llm,
        elapsed_ms: parseResult.elapsed_ms,
        mentioned_fields: parseResult.parse?.mentioned_text_fields ?? [],
        inferred_fields: parseResult.parse?.inferred_fields ?? [],
        literal_preferences: parseResult.parse?.literal_preferences ?? [],
        constraints: parseResult.parse?.constraints?.budget_band ? { budget_band: parseResult.parse.constraints.budget_band } : null,
        required_followups: parseResult.parse?.required_followups ?? [],
        untouched_fields: parseResult.parse?.untouched_fields ?? [],
        overridden_from_form: parseResult.parse?.overridden_from_form ?? [],
        dropped: parseResult.parse?.dropped ?? [],
        text_sha256_12: parseResult.parse?.text_sha256_12 ?? null,
      };
      parseNotice = [
        ...(parseResult.degraded ? [] : ["已整理送礼需求，请确认。"]),
        ...parseResult.notices,
      ];
      if (parseResult.intake_validation.status !== "ready") {
        // 解析结果本身不过现有校验 ⇒ 如实返回校验错误（与直接提交表单同一条路径、同一套错误码）。
        sendJson(res, 400, {
          status: parseResult.intake_validation.status,
          errors: parseResult.intake_validation.errors,
          mode: MODE.current,
          nl_parse: inputParse,
          notices: parseNotice,
          attestation: attestation({ clientCodeRevision: clientRevisionFrom(req.headers) }),
        });
        return true;
      }
    }
    /* `enableImageGeneration` 是**显式**授权闸门（默认关闭，见 config.mjs）：
       只有部署方打开 GIFTWISE_IMAGE_GENERATION=1 且真实模式才允许提交生图任务。 */
    const prepared = prepareExclusionRecommendation({ intake: effectiveIntake, analysis, confirmation: payload.exclusion_confirmation, owner });
    if (!prepared.ok) {
      sendJson(res, 400, { status: "needs_input", errors: prepared.errors, clarification_questions: prepared.clarification_questions ?? [] });
      return true;
    }
    effectiveIntake = prepared.intake;
    analysis = prepared.analysis;
    const outcome = await withExclusionContext(analysis, () => runRecommendation({ signal:cancellation.signal, ownerScope:owner, intake: effectiveIntake, naturalLanguage: naturalText || null, inputParse, parseNotice, demo: payload.demo, mode: MODE.current, exclusion_confirmation: payload.exclusion_confirmation, analysis }, { enableImageGeneration: IMAGE_GENERATION_CONFIG.enabled }));
    const attest = attestation({ clientCodeRevision: clientRevisionFrom(req.headers) });
    if (outcome.kind === "report") {
      sendJson(res, 200, { ...outcome.report, attestation: attest });
      return true;
    }
    const status = outcome.kind === "infrastructure_error" ? 503 : 400;
    sendJson(res, status, {
      status: outcome.status,
      errors: outcome.errors,
      mode: outcome.mode,
      notices: outcome.notices || [],
      attestation: attest,
      ...(outcome.kind === "recommendation_failed" ? { run_id: outcome.run_id, repair_count: outcome.repair_count, call_counts: outcome.call_counts } : {}),
      ...(outcome.retrieval ? {retrieval:outcome.retrieval,media:outcome.media} : {}),
    });
    return true;
  }

  if (pathname === "/api/presentations") {
    const outcome = await runPresentation({
      ownerScope:owner,
      runId: payload.recommendation_run_id,
      selectedCandidateId: payload.selected_candidate_id,
      demo: payload.demo,
    }, { enableImageGeneration: IMAGE_GENERATION_CONFIG.enabled });
    const attest = attestation({ clientCodeRevision: clientRevisionFrom(req.headers) });
    if (outcome.kind === "presentation") {
      sendJson(res, 200, { ...outcome.view, attestation: attest });
      return true;
    }
    if (outcome.kind === "presentation_failed") {
      // 明确失败：不伪装为完成，也不自动替用户换方案。
      sendJson(res, 409, { ...outcome.view, attestation: attest });
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
  const legend = {
    mock: "（模拟数据；未配置直连大模型凭证）",
    llm: "（直连大模型；会真实联网并消耗额度）",
    dify: "（Dify 对照路径，仅 GW_MODE=dify 时可达；仍以服务端返回为准）",
  };
  process.stdout.write(
    `GiftWise web 接入层已启动：http://${HOST}:${PORT}\n` +
      `模式：${mode}${legend[mode] ?? ""}\n` +
      `追求对象契约已落地：${PURSUIT_CONTRACT_READY ? "是（工作区未提交改动）" : "否（提交会被拒绝并给出中文提示）"}\n`,
  );
  void scenePoolStartupGuard();
});

/**
 * 启动自检：场景兜底图池「行被清空但图片还在」时**主动告警**。
 *
 * 背景：`.local-db/giftwise.sqlite` 是**多个 agent 共用的同一个文件**，被别的进程
 * 整体重建过（清掉 scene_images 的行，图片与账本仍留在磁盘）。这类问题在答辩现场
 * 表现为「图池明明是空的」，很难当场定位，所以在启动时就把话说清楚。
 *
 * ⛔ 这里**只告警、不自动重建**：自动写库可能覆盖别的 agent 正在写的内容。
 *    恢复命令由 detectWipedPool() 自己给出（见 localdb-real/scene-pool.mjs）。
 */
async function scenePoolStartupGuard() {
  try {
    const { detectWipedPool } = await import("./localdb-real/scene-pool.mjs");
    const dbPath = (process.env.GW_LOCAL_DB || process.env.GIFTWISE_CATALOG_DB || "").trim();
    if (!dbPath) return;
    /* 库文件根本不存在时**不要调用自检**：detectWipedPool → openDb 会按采集侧的正常行为
       「打开即建表」，于是一个写错的路径会被悄悄变成一个**空库**文件；之后 /api/catalog
       就会把「根本没读到库」报成「库是空的」，排查方向被带偏（2026-10-31 实测到）。
       文件不存在时这里直接返回，让 /api/catalog 如实报 DB_MISSING。 */
    if (!existsSync(dbPath)) return;
    // 图池图片与账本固定与库文件同级的 scene-pool/ 下。
    const imageDir = join(dirname(dbPath), "scene-pool", "images");
    const health = detectWipedPool({ dbPath, imageDir });
    if (health.needs_recovery) {
      process.stderr.write(`\n${health.message}\n\n`);
    } else if (health.status === "ok") {
      process.stdout.write(`场景兜底图池：正常（${health.db_rows} 行 / 磁盘 ${health.files_present} 张）\n`);
    } else {
      process.stdout.write(`场景兜底图池：${health.status}（${health.db_rows} 行 / 磁盘 ${health.files_present} 张）\n`);
    }
  } catch (error) {
    // 自检本身绝不影响服务启动。
    process.stderr.write(`场景兜底图池自检跳过：${error?.message ?? error}\n`);
  }
}

export { server };
