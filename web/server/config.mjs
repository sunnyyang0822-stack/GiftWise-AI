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

/** 契约已落地时给用户的如实说明（含未提交、接入层无凭证等限制）。 */
export const PURSUIT_READY_MESSAGE =
  "「追求对象」在本地仓库的契约中已经落地（工作区未提交改动 + 生成物已重建），" +
  "模拟模式下可以正常生成低压力方案；接入层未接真实模型（无凭证），真实调用仍以服务端返回为准。";

/** 模拟模式标识：必须显著展示，不能让演示者/评委误以为已联通 Dify。 */
export const MOCK_MODE_NOTICE =
  // 注意：本常量会经 GET /api/config 与 notices 直接返回给客户端，**禁止**写入
  // DIFY_API_KEY 等环境变量字面名——那会让「配置接口不含任何密钥字段」的断言失败
  // （smoke-http.mjs:72 会扫描响应里的 api_key 子串）。变量名只出现在注释里。
  "⚠ 模拟数据模式：接入层未配置真实模型凭证，从未成功调用过一次，" +
  "本页面所有候选方案与呈现内容都是接入层内置的固定模拟数据，不是模型真实输出，也没有联通 Dify。";

export const MOCK_CANDIDATE_NOTICE = "以下三个方案为模拟数据，用于演示校验与选择流程。";
export const MOCK_PRESENTATION_NOTICE = "以下呈现内容为模拟数据，用于演示「选择后」的四段呈现与复核流程。";

/** 接入层运行模式。默认 mock；只有配置了 Dify 地址与密钥且显式开启才走真实调用。 */
export const MODE = {
  /** "mock" | "dify" */
  get current() {
    const forced = (process.env.GW_MODE || "").trim().toLowerCase();
    if (forced === "mock" || forced === "dify") return forced;
    return hasDifyConfig() ? "dify" : "mock";
  },
};

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

/** 前端请求超时（毫秒），用于展示中文「超时」状态。 */
export const CLIENT_TIMEOUT_MS = 20000;
