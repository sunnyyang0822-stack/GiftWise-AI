/**
 * GiftWise AI · web 接入层配置（任务号 WEB-WF-001 / WEB-001）
 *
 * 本文件是接入层唯一的开关集中点。界面、适配、校验、模拟数据都从这里读常量，
 * 不在业务代码里散落魔法值。
 */

/**
 * 「追求对象 pursuit」契约是否已在服务端落地。
 *
 * PM 任务单（2026-10-30）要求：界面必须正常展示并允许选择「追求对象」，
 * 但提交时要给出明确中文提示说明该关系契约尚未落地，绝对禁止静默映射成
 * 恋人或其他关系；并把这个开关集中成一个常量，契约落地后一行切换。
 *
 * 实测结论（2026-10-30 20:5x，本机工作区，未提交改动）：
 *   1. workflow/labels.py:8 的关系枚举已含 "pursuit": "追求对象"，partner 中文为「恋人」；
 *   2. workflow/generated/manifest.json 的 sources_sha256["workflow/labels.py"]
 *      等于当前 labels.py 的实际哈希（e3128d29…），且 5 个生成物内都含 pursuit；
 *   3. 直接调用参考实现 workflow/intake.py 的 adapt_intake()，用
 *      recipient_relation="pursuit" 提交 → status=ready，
 *      request.recipient_relation_id="pursuit"（不再出现 INTAKE_UNKNOWN_LABEL）。
 *   因此本地工作区的契约已经落地，默认取 true。
 *
 * 仍未落地的部分（不得读作已完成）：
 *   - 这些是**未提交的工作区改动**（git status 显示 M workflow/labels.py 等），
 *     仓库已提交版本（HEAD 89d6624）里仍没有 pursuit；
 *   - 接入层未配置真实模型凭证（DIFY_API_KEY），也从未成功调用过一次，cloud_verified=false；
 *   - 所以真实联调路径仍可能返回 INTAKE_UNKNOWN_LABEL，届时如实透传，不静默映射。
 *
 * 切换方法（一行）：
 *   - 代码：把下面的默认值改成 false；
 *   - 不改代码：启动时设 GW_PURSUIT_CONTRACT_READY=0。
 * 取 false 时的行为（已实现并测试）：关系卡片照常展示可选，提交时服务端拒绝并返回
 * 中文提示 + 错误码 PURSUIT_CONTRACT_NOT_READY，不做任何关系改写。
 */
export const PURSUIT_CONTRACT_READY_DEFAULT = true;

function resolvePursuitReady() {
  const raw = process.env.GW_PURSUIT_CONTRACT_READY;
  if (raw === undefined || raw === null || raw === "") return PURSUIT_CONTRACT_READY_DEFAULT;
  const value = String(raw).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(value)) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  return PURSUIT_CONTRACT_READY_DEFAULT;
}

export const PURSUIT_CONTRACT_READY = resolvePursuitReady();

/** 契约未落地时给用户的中文提示（不得暗示已成功，也不得改写成其他关系）。 */
export const PURSUIT_NOT_READY_MESSAGE =
  "「追求对象」这个关系在本项目的服务端契约里还没有对应的机器值（pursuit），" +
  "现在提交会被服务端拒绝为 INTAKE_UNKNOWN_LABEL。" +
  "系统不会把它当成「恋人」或其他关系，也不会降低推荐等级。" +
  "你可以先选其他关系，或等契约落地后再试。";

/** 契约已落地时的**静态基础**说明（不再包含任何过期的接入状态断言）。 */
export const PURSUIT_READY_MESSAGE =
  "「追求对象」在本地仓库的契约中已经落地（recipient_relation_id=pursuit，工作区改动 + 生成物已重建）；" +
  "模拟模式下可以正常生成低压力方案。";

/**
 * 关系文案的动态版本（必修 4：文案必须由**真实配置与调用状态**驱动）。
 *
 * 旧实现把「接入层未接真实模型（无凭证）」硬编码进 PURSUIT_READY_MESSAGE，
 * 于 `/api/config` 里与 `mode=llm`、`llm_configured=true` 且**确实发生过真实调用**
 * 的响应自相矛盾。现在这句话由运行模式与凭证配置现算，不再硬编码。
 */
export function pursuitNotice() {
  if (!PURSUIT_CONTRACT_READY) return PURSUIT_NOT_READY_MESSAGE;
  const mode = MODE.current;
  const configured = hasLlmConfig();
  const state =
    mode === "llm"
      ? "本进程运行在直连大模型模式（llm），服务端已配置模型凭证，真实调用会联网并计入服务端账本。"
      : configured
        ? "服务端已配置直连大模型凭证，但本进程当前运行在模拟数据模式（mock）；是否已发生真实调用以服务端账本为准。"
        : "本进程运行在模拟数据模式（mock），服务端未配置直连大模型凭证，当前不会发起任何真实调用。";
  return `${PURSUIT_READY_MESSAGE}${state}本句随运行模式与凭证配置实时生成，不硬编码历史状态。`;
}

/** 模拟模式标识：必须显著展示，不能让演示者/评委误以为已联通 Dify。 */
export const MOCK_MODE_NOTICE =
  // 注意：本常量会经 GET /api/config 与 notices 直接返回给客户端，**禁止**写入
  // DIFY_API_KEY 等环境变量字面名——那会让「配置接口不含任何密钥字段」的断言失败
  // （smoke-http.mjs:72 会扫描响应里的 api_key 子串）。变量名只出现在注释里。
  "⚠ 模拟数据模式：接入层未配置真实模型凭证，从未成功调用过一次，" +
  "本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。";

export const MOCK_CANDIDATE_NOTICE = "以下三个方案为模拟数据，用于演示校验与选择流程。";
export const MOCK_PRESENTATION_NOTICE = "以下呈现内容为模拟数据，用于演示「选择后」的四段呈现与复核流程。";

/**
 * 直连大模型（OpenAI 兼容）配置。密钥只从服务端环境变量读，
 * 绝不进前端、绝不进仓库、绝不进日志、绝不进响应。
 *
 * 变量清单与「由谁在哪里配置」见 docs/architecture/摘除Dify改为直连LLM-2026-10-31.md。
 * 三个必需变量（缺少任意一个即视为未配置）：地址 / 密钥 / 模型名。
 */
export function hasLlmConfig() {
  return Boolean(
    (process.env.LLM_BASE_URL || "").trim() && (process.env.LLM_API_KEY || "").trim() && (process.env.LLM_MODEL || "").trim(),
  );
}

export function llmConfig() {
  const timeout = Number(process.env.LLM_TIMEOUT_MS);
  const retries = Number(process.env.LLM_MAX_RETRIES);
  const maxTokens = Number(process.env.LLM_MAX_TOKENS);
  const parseMaxTokens = Number(process.env.LLM_PARSE_MAX_TOKENS);
  const temperature = Number(process.env.LLM_TEMPERATURE);
  const outputRetries = Number(process.env.LLM_OUTPUT_RETRIES);
  const callBudget = Number(process.env.LLM_CALL_BUDGET);
  return {
    baseUrl: (process.env.LLM_BASE_URL || "").trim(),
    apiKey: (process.env.LLM_API_KEY || "").trim(),
    model: (process.env.LLM_MODEL || "").trim(),
    /**
     * 单次请求超时（毫秒）。默认 120000：
     * 实测该供应商是**推理模型**（1.7s 只产出 8 个 token，且全被推理吃掉），
     * 真出三个方案预计 20–60s，20s 这类短超时会把正常调用误判成失败。
     * 超时是 LLM_TIMEOUT，与业务失败（LLM_OUTPUT_INVALID 等）区分开。
     */
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 120000,
    /** 网络/HTTP 重试上限（次）；transport 内部再硬钳到 3，防止误配置打光额度。 */
    maxRetries: Number.isFinite(retries) && retries >= 0 ? retries : 2,
    /**
     * 输出上限。默认 **16384**：
     * 推理模型的推理 token 也算在输出里，给小了会得到 finish_reason=length + 空 content。
     * 2026-10-31 独立验收在 8903 实测到 `completion_tokens=8192 / reasoning_tokens=7205`
     * ⇒ 8192 会被推理**吃满**，连续两次 503 LLM_OUTPUT_TRUNCATED；默认提到 16384，
     * 仍可用 LLM_MAX_TOKENS 覆盖（非法值回落到本默认）。
     */
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 16384,
    /**
     * 第 1 步自然语言解析的独立输出上限（默认 8192）：解析结果本身很小，
     * 但推理过程可能很长，因此单独给一个够用的上限，可用 LLM_PARSE_MAX_TOKENS 覆盖。
     */
    parseMaxTokens: Number.isFinite(parseMaxTokens) && parseMaxTokens > 0 ? parseMaxTokens : 8192,
    temperature: Number.isFinite(temperature) ? temperature : 0.4,
    /** 输出格式重试：0 或 1（默认 1，provider 内再硬钳 ≤1），不叠加成两次自动业务修订。 */
    outputRetries: Number.isFinite(outputRetries) && outputRetries >= 0 ? Math.min(Math.floor(outputRetries), 1) : 1,
    /** 真实调用额度硬闸：达到即拒绝再发（在发出请求之前拦），未配置为 null（不限制）。 */
    callBudget: Number.isFinite(callBudget) && callBudget >= 0 ? Math.floor(callBudget) : null,
  };
}

/**
 * 接入层运行模式。**已摘除 Dify 作为默认路径**（dify.mjs 代码保留作历史与对照）。
 *
 * 完整降级矩阵见 docs/architecture/摘除Dify改为直连LLM-2026-10-31.md：
 *   GW_MODE 未设 + 有直连凭证  → "llm"
 *   GW_MODE 未设 + 无直连凭证  → "mock"
 *   GW_MODE=llm  + 无直连凭证  → "mock"（回落，mode 如实标注为 mock，并附说明）
 *   GW_MODE=mock               → "mock"
 *   GW_MODE=dify               → "dify"（仅显式指定；历史对照路径，永不是默认）
 *   其它值                      → "mock"（未知模式绝不当成真实调用）
 */
export const MODE = {
  /** "mock" | "llm"；另有仅显式可选的 "dify" 对照路径 */
  get current() {
    const forced = (process.env.GW_MODE || "").trim().toLowerCase();
    if (forced === "mock" || forced === "dify") return forced;
    // 显式要求 llm 但无凭证：如实回落到 mock，并在响应里把 mode 标成 mock。
    if (forced === "llm") return hasLlmConfig() ? "llm" : "mock";
    // 无法识别的取值：按最安全的 mock 处理，并给出说明（不猜测、不花费额度）。
    if (forced !== "") return "mock";
    return hasLlmConfig() ? "llm" : "mock";
  },
};

/** 强制 llm 却缺少凭证时的如实回落说明。 */
export const LLM_FALLBACK_NOTICE =
  "⚠ 已显式要求直连大模型模式，但服务端缺少模型凭证，已如实回落到模拟数据模式（mode=mock）；" +
  "本次没有发起任何真实调用，也没有把模拟数据标成模型输出。";

/** GW_MODE 取值无法识别时的如实回落说明（不猜测用户意图，也不花费额度）。 */
export const MODE_UNKNOWN_NOTICE =
  "⚠ 运行模式取值无法识别，已按最安全的模拟数据模式处理（mode=mock）；" +
  "本次没有发起任何真实调用。请把运行模式设为 mock / llm（或显式的 dify 对照路径）。";

/** 直连大模型模式：会真实联网并消耗额度。 */
export const LLM_MODE_NOTICE =
  "直连大模型模式：接入层直接调用服务端配置的模型接口（不再经过 Dify）。" +
  "模型调用失败时如实报错，不会用模拟数据顶替；每次真实调用都记入服务端账本。";

/** 按当前 mode 给出如实标识（不出现任何凭证字段名）。 */
export function modeNotices(mode) {
  if (mode === "mock") return [MOCK_MODE_NOTICE];
  if (mode === "llm") return [LLM_MODE_NOTICE];
  return [];
}

/** 显式要求 llm 却因缺凭证回落到 mock、或 mode 取值无法识别时，给出如实说明。 */
export function modeFallbackNotices() {
  const forced = (process.env.GW_MODE || "").trim().toLowerCase();
  if (forced === "") return [];
  if (forced === "llm") return hasLlmConfig() ? [] : [LLM_FALLBACK_NOTICE];
  if (forced === "mock" || forced === "dify") return [];
  return [MODE_UNKNOWN_NOTICE];
}

export function hasDifyConfig() {
  return Boolean(
    (process.env.DIFY_API_BASE || process.env.DIFY_API_URL || "").trim() &&
      (process.env.DIFY_API_KEY || "").trim(),
  );
}

/**
 * 真实 Dify 调用配置。密钥只从服务端环境变量读，绝不进前端、不进仓库、不进日志。
 * 变量名沿用仓库根 .env.example 的口径（DIFY_API_BASE / DIFY_API_KEY）。
 */
export function difyConfig() {
  return {
    base: (process.env.DIFY_API_BASE || process.env.DIFY_API_URL || "").trim(),
    apiKey: (process.env.DIFY_API_KEY || "").trim(),
    recommendPath: (process.env.DIFY_RECOMMEND_PATH || "/workflows/run").trim(),
    presentationPath: (process.env.DIFY_PRESENTATION_PATH || "/workflows/run").trim(),
    /** 真实工作流是否已由工作流线确认发布；未确认前不允许把结果标为真实。 */
    publishedVerified: (process.env.DIFY_PUBLISHED_VERIFIED || "").trim() === "1",
    timeoutMs: Number(process.env.DIFY_TIMEOUT_MS || 60000),
  };
}

/** 全局业务修订额度：推荐 + 呈现两个阶段合计最多一次。 */
export const GLOBAL_REPAIR_LIMIT = 1;

/** 与契约一致的上限，避免接入层放宽原规则。 */
export const LIMITS = {
  intakeBytes: 32768,
  requestBytes: 32768,
  candidatesBytes: 32768,
  envelopeBytes: 262144,
  maxStringCodePoints: 1000,
  maxArrayItems: 20,
  candidatesPerBatch: 3,
};

/** 预算与时间的界面区间（只是输入快捷方式，最终以用户确认的明确值提交）。 */
export const BUDGET_RANGES = [
  { id: "r1", label: "100 元以内", min: "0", max: "100" },
  { id: "r2", label: "100–200 元", min: "100", max: "200" },
  { id: "r3", label: "200–500 元", min: "200", max: "500" },
  { id: "r4", label: "500–1000 元", min: "500", max: "1000" },
  { id: "r5", label: "1000 元以上", min: "1000", max: null },
];

/** 新版交互配置；旧 BUDGET_RANGES 仅供旧页面兼容，不作为新模式。 */
export const budget_slider = Object.freeze({ min: 0, max: 1000, step: 50 });
export const budget_modes = Object.freeze(["slider", "zero", "other"]);

export const DEADLINE_RANGES = [
  { id: "d0", label: "明天", value: 1, hint: "按 1 天上限检查", minDays: 0, maxDays: 1 },
  { id: "d1", label: "3–5 天", value: 5, hint: "按 5 天上限检查", minDays: 3, maxDays: 5 },
  { id: "d2", label: "一周以内", value: 7, hint: "按 7 天上限检查", minDays: 0, maxDays: 7 },
  { id: "d3", label: "一月以内", value: 30, hint: "按 30 天上限检查", minDays: 0, maxDays: 30 },
  { id: "d4", label: "一季度以内", value: 90, hint: "按 90 天上限检查", minDays: 0, maxDays: 90 },
  { id: "d5", label: "一年以内", value: 365, hint: "按 365 天上限检查", minDays: 0, maxDays: 365 },
];

export const PORT = Number(process.env.GW_PORT || process.env.PORT || 8787);
export const HOST = process.env.GW_HOST || "127.0.0.1";

/**
 * 对外公布的前端请求超时（毫秒），前端据此展示中文「超时」状态。
 *
 * 值从 20000 提到 150000，原因是直连的模型是**推理模型**：
 *   实测 1.7s 只产出 8 个 token（且全被推理吃掉），真出三个方案预计 20–60s。
 *   服务端自己的单次调用超时默认 120000（LLM_TIMEOUT_MS），因此前端必须**比它长**，
 *   否则前端会先中断、拿不到服务端的中文错误码（LLM_TIMEOUT / LLM_OUTPUT_TRUNCATED 等）。
 * 推荐配对：服务端 LLM_TIMEOUT_MS = 120000 ／ 前端 client_timeout_ms = 150000。
 *
 * ⚠ 协调项（不在本次改动范围）：web/public 里另有一份硬编码的同名值
 *   （web/public/js/preview-config.js:236 = 20000），以及 web/public/app.js 目前
 *   根本没有发起真实请求（apiFetch 是占位实现），需要前端线一并处理，详见报告清单。
 */
export const CLIENT_TIMEOUT_MS = 150000;

/**
 * 运输时间口径（产品负责人 2026-10-31 新增：时间对齐必须含运输，且不许假装知道物流）。
 *
 * 判据：`准备时间 + 运输时间 <= 可用天数` 才算通过。
 * `estimated_shipping_days` **允许未知**；未知时按 `default_days` 参与判定，
 * 并一律在响应里标注来源（数据层字段，界面不显示）。
 */
export const PURCHASE_WINDOW_CONFIG = Object.freeze({
  min: 3,
  max: 5,
  used: 5,
  day_type: 'calendar',
  basis: '拿不到页面时长时的统一口径：快递网购 3~5 天，判定取上界 5 天',
  not_a_guarantee: '网购时长为页面原文或保守默认值，不构成发货或送达保证。',
});

/**
 * 运输时间口径（保留：只在页面**给了一部分**时效时用于兜底取较大值）。
 *
 * 判据：`准备时间 + 网购时长 <= 可用天数` 才算通过。
 * ⚠️ 不重复计算：页面同时给了发货时效与配送时效时两者相加；只给其一时不与默认值相加，
 *    而是取「观测值」与「默认下界 3 天」的较大者（宁可保守）。
 */
export const SHIPPING_CONFIG = Object.freeze({
  defaultDays: (() => {
    const raw = (process.env.GIFTWISE_SHIPPING_DEFAULT_DAYS || '').trim().toLowerCase();
    if (!raw) return PURCHASE_WINDOW_CONFIG.used;
    if (raw === 'off' || raw === 'none') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : PURCHASE_WINDOW_CONFIG.used;
  })(),
  basis: '国内普通快递主流时效 2–4 天，取上限 4 天作为保守默认；不含偏远地区、节假日、天气、大促爆仓等无法估算的因素',
  is_estimate: true,
  not_a_guarantee: '运输与预售时长为页面原文或保守默认值，不构成发货或送达保证。',
});

/**
 * 预售/发货时长口径（产品负责人 2026-10-31 更正：预售不是「排除」，而是**算进判定**）。
 *
 * 判定式：`准备时长 + 预售（发货）时长 + 运输时长 <= 用户可用时长`。
 * 预售时长从采集字段读取（`presale_days` / `ships_within_days` / `ships_within_text` /
 * `shipping_time_text`），并保留**原文 + 解析值**以便追溯。
 * 只有页面**确实没给**时长时才标未知，并按 `defaultDays` 参与判定。
 * ⛔ 绝不把「没解析出来」当成「没有预售」。
 *
 * 默认值 7 天的依据：预售类商品常见发货时效为 7–15 天；取区间**下限 7 天**，
 * 理由是完全没信息时不应把所有预售商品一律判死，但在「7 天以内」的紧迫需求上
 * 一律判为不通过（7 天预售 + 保守运输 4 天 > 7 天）。
 */
export const PRESALE_CONFIG = Object.freeze({
  defaultDays: (() => {
    const raw = (process.env.GIFTWISE_PRESALE_DEFAULT_DAYS || '').trim().toLowerCase();
    if (!raw) return 7;
    if (raw === 'off' || raw === 'none') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 7;
  })(),
  basis: '预售类常见发货时效 7–15 天；完全没给时长时取区间下限 7 天作为保守默认，并一律标注为估算',
  is_estimate: true,
  not_a_guarantee: '预售与发货时长为页面原文/估算，不构成发货或送达保证。',
});

/**
 * 第 5 步「付费生图」的**显式**总开关。
 *
 * ⚠️ 为什么必须是显式的：改动前 `pipeline.mjs` 的授权表达式含 `|| !services.requestCandidates`，
 * 而生产入口从不传 `services` ⇒ `!undefined === true` ⇒ 只要 `mode==='dify'` 就自动授权。
 * 配上密钥后，第一次选择包装图就会真实扣费，且没有任何人点头。
 * 现在：默认关闭（不花钱），显式 `GIFTWISE_IMAGE_GENERATION=1` 且配好密钥才会真实出图。
 * 沿用仓库既有惯例（`RETRIEVAL_CONFIG` 就是「真实来源需显式启用」）。
 */
/**
 * 生图授权闸门（**默认关闭**）。
 *
 * 为什么默认关：生图是**付费**供应商调用。任何人只要能在 mock/llm 模式下点一次"选择"，
 * 就可能产生费用 ⇒ 必须由部署方显式打开，并且只对真实模式（llm/dify）生效。
 *
 * 打开方式（三选一，等价）：
 *   `GIFTWISE_IMAGE_GENERATION=1`（服务进程环境变量，推荐）
 *   `GIFTWISE_IMAGE_GENERATION=1 GW_PORT=8901 node web/server/server.mjs`
 * HTTP 接入层会把 `enabled` 作为 `services.enableImageGeneration` 传给推荐流程；
 * `mock` 模式即使打开也**不会**生图（模拟模式不产生任何真实供应商调用）。
 */
export const IMAGE_GENERATION_CONFIG = Object.freeze({
  enabled: (process.env.GIFTWISE_IMAGE_GENERATION || '').trim() === '1',
});

/**
 * 第 3–4 步（包装风格 + 色彩视觉方向）的通道开关。
 * 取值与切换方法见 web/server/visual/provider.mjs 顶部注释。
 */
export const STYLE_DIRECTION_CONFIG = Object.freeze({
  requestedChannel: (process.env.GIFTWISE_STYLE_DIRECTION_CHANNEL || '').trim().toLowerCase() || null,
  get channel() {
    const requested = (process.env.GIFTWISE_STYLE_DIRECTION_CHANNEL || '').trim().toLowerCase();
    if (requested === 'rules' || requested === 'llm_text' || requested === 'image') return requested;
    // 默认：有直连模型凭证就走 llm_text（真实调用 1 次），否则纯规则。
    return hasLlmConfig() ? 'llm_text' : 'rules';
  },
  /** 文本润色用的输出上限：推理模型的推理 token 也算进 max_tokens，给小了会截断成空 content。 */
  maxTokens: 4096,
  llmEnabled: true,
  get imageEnabled() {
    return (process.env.GIFTWISE_STYLE_DIRECTION_CHANNEL || '').trim().toLowerCase() === 'image'
      && (process.env.GIFTWISE_IMAGE_GENERATION || '').trim() === '1';
  },
});

/**
 * 包装图「等图就绪」的上限（毫秒）。
 *
 * `POST /api/presentations` 在返回前**等到图就绪或超时**，这样前端只渲染一次也能拿到图
 * （前端补轮询是后续可选项；`results-view.js:134` 目前只渲染一次）。
 * 默认 30000：实测单张约 8 秒（历史 `docs/research/opencli/seedream-live-result.json`
 * 为 8230ms），30 秒给足 3.5 倍余量；超时后如实返回 `pending` + 原因，不假装成功。
 */
export const PRESENTATION_WAIT_MS =
  Number.isFinite(Number(process.env.GIFTWISE_PRESENTATION_WAIT_MS)) && Number(process.env.GIFTWISE_PRESENTATION_WAIT_MS) >= 0
    ? Math.floor(Number(process.env.GIFTWISE_PRESENTATION_WAIT_MS))
    : 60000;

/**
 * 本地库路径的**单一事实来源**（2026-10-31 缺陷修复：同一服务两个端点读不同库）。
 *
 * 事故：推荐流水线读真实库（`GIFTWISE_CATALOG_DB` 的默认值），而 `GET /api/catalog`
 * 走 `localdb-real/db.mjs:defaultDbPath()` = `GW_LOCAL_DB || <repo>/.local-db/giftwise.sqlite`
 * ⇒ 同一个进程里两条链路读**两个不同**的库：实测 `/api/catalog` 返回 mode=empty、
 * product_count=0、reason_code=DB_EMPTY，而推荐链路同一时刻命中真实 smzdm 商品。
 *
 * 现在只有一个解析点，优先级（高 → 低）：
 *   1. `GW_LOCAL_DB`            —— 工作流/采集/测试统一约定的变量（临时库也走它）；
 *   2. `GIFTWISE_CATALOG_DB`    —— 阶段二引入的变量；
 *   3. 真实库默认路径 `C:/Users/lenovo/Desktop/gw-opencli-db/.local-db/giftwise.sqlite`。
 * ⛔ 任何新代码都不得再自己拼库路径或另设默认值，一律 import 本模块。
 */
export const DEFAULT_LOCAL_DB_PATH = "C:/Users/lenovo/Desktop/gw-opencli-db/.local-db/giftwise.sqlite";

export function localDbPath() {
  return (process.env.GW_LOCAL_DB || "").trim() || (process.env.GIFTWISE_CATALOG_DB || "").trim() || DEFAULT_LOCAL_DB_PATH;
}

/** 库路径的来源自证（便于复核「这个进程到底读的哪个库、谁配的」）。 */
export function localDbSource() {
  if ((process.env.GW_LOCAL_DB || "").trim()) return "GW_LOCAL_DB";
  if ((process.env.GIFTWISE_CATALOG_DB || "").trim()) return "GIFTWISE_CATALOG_DB";
  return "default(真实库)";
}

export const LOCAL_DB_CONFIG = Object.freeze({
  get dbPath() {
    return localDbPath();
  },
  get source() {
    return localDbSource();
  },
  defaultPath: DEFAULT_LOCAL_DB_PATH,
  envNames: Object.freeze(["GW_LOCAL_DB", "GIFTWISE_CATALOG_DB"]),
});

/**
 * 阶段二：本地真实商品库（离线抓取、在线只读）。
 * 路径来自 `localDbPath()`（单一事实来源），⛔ 在线请求路径上不联网抓取，只读这个库。
 */
export const CATALOG_CONFIG = Object.freeze({
  get dbPath() {
    return localDbPath();
  },
  maxItems: 3,
});

/**
 * 第 1 步「自然语言 ⇒ intake 字段」解析的开关与容差。
 *
 * 产品负责人 2026-10-31 四条裁定落到这里的常量：
 *   - 用户输入优先于选项（由 parse 模块的合并顺序保证，见 llm/intake-parse.mjs）；
 *   - 用户给出**确定金额**时，价格约束带宽 = 用户所给值 ± 50 元；
 *   - 用户给出**确定天数**时，时间约束带宽 = 用户所给值 ± 1 天；
 *   - 用户原文（喜好/禁忌）是硬约束，不被预设类目吸收。
 */
export const INTAKE_PARSE_CONFIG = Object.freeze({
  /** 总开关：GIFTWISE_INTAKE_PARSE=0/off 时关闭（关闭后 /api/intake/parse 如实返回 disabled + 回落）。 */
  enabled: !["0", "off", "false", "no"].includes(String(process.env.GIFTWISE_INTAKE_PARSE || "").trim().toLowerCase()),
  /** 建议客户端超时（毫秒）：解析是一次独立的小调用，比推荐短。 */
  clientTimeoutMs: 60000,
  /** 确定金额的约束带宽（元）：±50。 */
  budgetBandCny: 50,
  /** 确定天数的约束带宽（天）：±1。 */
  daysBand: 1,
  /** 「用户原文是硬约束」的检查级别：默认 warning；GIFTWISE_LITERAL_PREFERENCE_GATE=1 升为硬 gate。 */
  literalPreferenceGate: String(process.env.GIFTWISE_LITERAL_PREFERENCE_GATE || "").trim() === "1",
  /** 用户原文写进 additional_context 的上限（码点），避免顶穿 1000 码点契约。 */
  literalContextCodePoints: 600,
});

/**
 * 体验类的地域价格口径（产品负责人 2026-10-31 裁定 4）。
 *
 * ⚠ 诚实边界：本地库里**没有买家城市维度**（products 只有 seller_location_text /
 * shipping_origin 这类**卖家/发货地**字段），因此「考虑地域价格」目前只能做到
 * 「提示词硬约束 + 如实标注」，做不到按城市过滤或按城市比价，也没有任何真实城市价格数据。
 */
export const REGION_PRICE_CONFIG = Object.freeze({
  /** 一线城市（体验类价格普遍偏高，估价须上浮）。 */
  tier1Cities: Object.freeze(["北京", "上海", "广州", "深圳"]),
  /** 新一线城市（次之）。 */
  newTier1Cities: Object.freeze(["成都", "杭州", "重庆", "武汉", "西安", "苏州", "天津", "南京", "长沙", "郑州", "东莞", "宁波", "青岛", "合肥", "佛山"]),
  note: "体验类候选的估价须按用户所在城市的价格水平分档（一线城市普遍更高）；本地库没有买家城市维度，无法按城市过滤或比价。",
  source: "城市分档按公开常识，不是实测价格数据；具体价格仍需以页面为准。",
  is_estimate: true,
});

// 真实来源需显式启用；仅专用后台浏览器，默认不联网检索。
export const RETRIEVAL_CONFIG = Object.freeze({provider:process.env.GIFTWISE_RETRIEVAL || 'unavailable',packageRoot:process.env.OPENCLI_PACKAGE_ROOT || '',queueLimit:4,timeoutMs:55000});

/**
 * 履约方式（产品负责人 2026-10-31 裁定，三轮增补）：
 *   - `offline`    线下实物自购 / 门店自提（书店、超市、商场专柜、花店、便利店…）
 *   - `online`     网购（默认，最保守：一定涉及快递）
 *   - `experience` 线下到场消费的体验/课程（手作工坊、陶艺、烘焙、绘画、运动课程…）
 *
 * 判定差异：只有 `online` 才计入快递时长；`offline` / `experience` 不计快递
 * （`shipping_days_source: 'not_applicable'`），只用「准备/预约所需时间 <= 用户可用天数」。
 * 体验类把「到货」换成「预约/排课」，同样无法核验真实档期。
 *
 * ⚠️ 诚实边界（不可让步）：我们**无法核验**线下门店是否真有货、也无法核验真实档期
 * （没有门店库存/档期接口）⇒ 一律标 `fulfillment_confidence: 'inferred'`（推测），
 * 只能说「可以去商店购买」「需预约 / 可预约体验」，
 * ⛔ 不许出现「有货 / 已确认现货 / 保证买得到 / 保证有档期 / 一定约得到 / 已确认名额」。
 *
 * 产品理由（写进报告）：体验类天然偏**小众**，正好服务「避免大众化」的独特性要求 ⇒
 * 短档位优先线下可购与体验类**不只是为了赶时间，本身就是差异化**。
 */
export const FULFILLMENT_CONFIG = Object.freeze({
  values: Object.freeze(['offline', 'online', 'experience']),
  default: 'online',
  hints: Object.freeze({
    offline: '可以去商店购买',
    experience: '需预约 / 可预约体验',
    online: null,
  }),
  confidence: 'inferred',
  confidence_note: '线下可获得性与体验档期均为**推测**：没有门店库存与排课接口，无法核验',
  forbidden_wording: Object.freeze(['有货', '现货', '保证买得到', '保证能买到', '保证有档期', '一定约得到', '已确认名额', '已确认有货', '库存充足', '随时可约']),
  wording_rule: '只能说「可以去商店购买」「需预约 / 可预约体验」这类购买方式提示；不得声称已确认有货、现货或保证能约到。',
});
