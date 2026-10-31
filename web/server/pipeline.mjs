import { verifyCandidateEvidence, bindOptionalCandidateEvidence } from "./retrieval/evidence.mjs";
import { RetrievalWorker, unavailableProvider } from "./retrieval/worker.mjs";
import { mediaProvider } from "./media/provider.mjs";
import { mintReferenceGrant } from "./media/plan.mjs";
import { DomesticProvider,runDomesticDetails } from "./retrieval/domestic-provider.mjs";
import { normalizeRetrievalPlan } from "./retrieval/query-plan.mjs";
import { createOpencliToolSession } from "./retrieval/agent-tool.mjs";
import{createRetrievalAudit,retrievalSensitiveValues}from'./retrieval/audit-store.mjs';
import{startReferenceImages}from'./retrieval/reference-images.mjs';
import { bindReferenceEvidence } from './retrieval/reference-evidence.mjs';
import { RETRIEVAL_CONFIG } from "./config.mjs";
const retrievalWorker = new RetrievalWorker(RETRIEVAL_CONFIG.provider !== "unavailable" ? new DomesticProvider({packageRoot:RETRIEVAL_CONFIG.packageRoot || undefined}) : unavailableProvider, RETRIEVAL_CONFIG);
/**
 * 接入层主流程：适配 → （真实/模拟）生成三候选 → 独立规则校验 → 最多一次自动修订 →
 * 等待用户选择 → 选择校验 → 呈现四段 → 呈现复核（含全局修订额度）。
 *
 * 信任边界：本文件里的 request_json、候选、校验结果、repair_count 全部来自服务端；
 * 浏览器提交的 passed / estimated_total / repair_count 等派生字段会在适配层被拒绝。
 */

import { strictParse, dump } from "./jsonstrict.mjs";
import { packagingSectionItems } from "./presentation-packaging.mjs";
import { adaptIntakeObject } from "./intake.mjs";
import { validate, validateForDecision, validateRequestOnly, requestIsValid, checkPresentation, checkPresentationForDecision, error as pushError, deliveryDeadline, parseDurationDays, attachUniquenessWarnings, fulfillmentOf, relationAssumptionErrors, fulfillmentWordingErrors, amountToCents } from "./checker.mjs";
import { buildMockCandidates, buildMockRevision, buildMockPresentation, buildBrokenModelOutput, buildMockPartialFailure, buildMockStressCandidates, stressifyPresentation } from "./mock-model.mjs";
import { GIFT_STYLE_TABLE, CLOSENESS_TABLE } from "./labels.mjs";
// Dify 客户端保留（历史与对照），但**不再是默认路径**：默认走 llm（无凭证则 mock）。
// 这里只改导入别名，dify.mjs 本身未改动。
import { requestCandidates as difyRequestCandidates, requestPresentation as difyRequestPresentation } from "./dify.mjs";
// 直连大模型 provider：契约名与调用形状与原 dify.mjs 一致。
import { llmProvider } from "./llm/provider.mjs";
// 第 3–4 步：包装风格 + 色彩视觉方向（含「与 intake 一致且可追溯」的硬约束）。
import { defaultProvider as visualDirectionProviderFactory, directionPromptText, deriveVisualDirection } from "./visual/provider.mjs";
import { presentationAlignmentErrors } from "./visual/direction.mjs";
// 阶段二：本地真实商品库匹配（纯读库）+ 缺失才补抓 opencli（单请求最多 1 次）。
import { provideRealProducts } from "./catalog/provide.mjs";
import { libraryPreview } from "./catalog/match.mjs";
import { createRun, getRun, getRunByRecommendationKey, publicReport, retrievalView } from "./store.mjs";
import { checkAiExclusions } from "./exclusion-checker.mjs";
import { MODE, MOCK_MODE_NOTICE, MOCK_CANDIDATE_NOTICE, MOCK_PRESENTATION_NOTICE, GLOBAL_REPAIR_LIMIT, modeNotices, modeFallbackNotices, CATALOG_CONFIG, SHIPPING_CONFIG, PRESALE_CONFIG, PURCHASE_WINDOW_CONFIG, FULFILLMENT_CONFIG, LIMITS, INTAKE_PARSE_CONFIG, localDbPath } from "./config.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 运行模式收敛：未知值一律按 mock 处理，绝不把未知模式当成真实调用。 */
const KNOWN_MODES = new Set(["mock", "dify", "llm"]);
function normalizeMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KNOWN_MODES.has(raw) ? raw : "mock";
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

function parseJsonOrNull(text) {
  try {
    return strictParse(text);
  } catch (e) {
    return null;
  }
}

function computeSelectable(validation, workflowErrors) {
  if (validation.errors.length > 0 || workflowErrors.length > 0) return [];
  return validation.candidate_results.filter((r) => r.passed).map((r) => r.id);
}

/* --------------------------------------------------- 第 1 步解析出的用户硬约束 gate */

/** 从用户原文里取「有辨识度」的比对片段：连续 2-gram + ASCII 词，去掉通用词。 */
const LITERAL_STOP_TOKENS = new Set(["喜欢", "比较", "有点", "一点", "特别", "东西", "礼物", "一下", "的话", "而且", "还有", "就是", "可以", "不要", "别的", "其它", "其他"]);
function literalTokens(text) {
  const tokens = new Set();
  if (typeof text !== "string") return [];
  for (const word of text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) tokens.add(word);
  const cjk = [...text.replace(/[^\u4e00-\u9fff]+/g, " ")].filter((ch) => /[\u4e00-\u9fff]/.test(ch));
  for (let i = 0; i + 1 < cjk.length; i += 1) {
    const token = `${cjk[i]}${cjk[i + 1]}`;
    if (!LITERAL_STOP_TOKENS.has(token)) tokens.add(token);
  }
  return [...tokens];
}

/** 用户输入约束：预算继续按现有契约检查，时间仅提示，喜好保留原文。 */
export function applyInputParseGates({ inputParse, validation, candidates, delivery = null, notices }) {
  if (!inputParse || typeof inputParse !== "object") return null;
  const budgetBand = inputParse.constraints?.budget_band ?? null;
  const daysBand = inputParse.constraints?.days_band ?? null;
  const literals = Array.isArray(inputParse.literal_preferences) ? inputParse.literal_preferences.filter((item) => typeof item === "string" && item.trim()) : [];
  if (!budgetBand && !daysBand && literals.length === 0) return null;
  const literalGate = INTAKE_PARSE_CONFIG.literalPreferenceGate;
  const audit = {
    budget_band: budgetBand ? { ...budgetBand, enforced: "hard_gate" } : null,
    days_band: daysBand
      ? {
          ...daysBand,
          enforced: "not_used_for_decision",
          enforced_note:
            "时间不参与推荐筛选或排序。",
        }
      : null,
    literal_preferences: literals,
    literal_preferences_enforced: literalGate ? "hard_gate" : "warning",
    literal_gate_env: "GIFTWISE_LITERAL_PREFERENCE_GATE=1",
    findings: [],
  };
  const byId = new Map((Array.isArray(candidates) ? candidates : []).map((candidate) => [candidate?.id, candidate]));
  for (const result of validation.candidate_results ?? []) {
    const candidate = byId.get(result.id);
    if (!candidate) continue;
    const total = amountToCents(String(candidate.estimated_total ?? ""));
    if (budgetBand && total !== null) {
      const low = amountToCents(String(budgetBand.min ?? ""));
      const high = amountToCents(String(budgetBand.max ?? ""));
      if (low !== null && total < low) {
        pushError(result.errors, "PRICE_OUT_OF_BAND", `${result.id}.estimated_total`, `估算总价 ${candidate.estimated_total} 低于用户所给金额 ${budgetBand.user_amount} 的下界 ${budgetBand.min}（带宽上下不超过 ${budgetBand.band_cny} 元）`);
        result.passed = false;
        audit.findings.push({ candidate_id: result.id, code: "PRICE_OUT_OF_BAND", side: "below", estimated_total: candidate.estimated_total, band: [budgetBand.min, budgetBand.max], level: "error" });
      } else if (high !== null && total > high) {
        pushError(result.errors, "PRICE_OUT_OF_BAND", `${result.id}.estimated_total`, `估算总价 ${candidate.estimated_total} 超过用户所给金额 ${budgetBand.user_amount} 的上界 ${budgetBand.max}（带宽上下不超过 ${budgetBand.band_cny} 元）`);
        result.passed = false;
        audit.findings.push({ candidate_id: result.id, code: "PRICE_OUT_OF_BAND", side: "above", estimated_total: candidate.estimated_total, band: [budgetBand.min, budgetBand.max], level: "error" });
      }
    }
    if (literals.length > 0) {
      const haystack = canonical(candidate).toLowerCase();
      const reflected = literals.some((literal) => literalTokens(literal).some((token) => haystack.includes(token)));
      if (!reflected) {
        const finding = {
          candidate_id: result.id,
          code: "LITERAL_PREFERENCE_NOT_REFLECTED",
          message: `候选文案里找不到用户原文（${literals.join(" / ")}）的落点：用户的原文是硬约束，不接受只用预设类目替代。`,
          level: literalGate ? "error" : "warning",
        };
        audit.findings.push(finding);
        if (literalGate) {
          pushError(result.errors, "LITERAL_PREFERENCE_NOT_REFLECTED", result.id, finding.message);
          result.passed = false;
        } else {
          result.warnings = [...(result.warnings ?? []), finding];
          notices.push(`⚠ 候选 ${result.id} 未能体现用户原文「${literals.join(" / ")}」；已如实记为警示（未阻止选择，避免把用户卡死）。`);
        }
      }
    }
  }
  return audit;
}

/* ------------------------------------------------------------ 推荐阶段 */

/**
 * @param {{intake: unknown, demo?: string|null, mode?: string, pursuitReady?: boolean}} input
 */
const pendingRecommendations=new Map();
export async function runRecommendation(input, services = {}) {
 const key=canonical({owner:input.ownerScope||'internal',intake:input.intake,analysis:input.analysis??null,inputParse:input.inputParse??null,confirmation:input.exclusion_confirmation||null,mode:input.mode,demo:input.demo||null});
 if(pendingRecommendations.has(key))return pendingRecommendations.get(key);
 if(pendingRecommendations.size>=200)return {kind:'infrastructure_error',status:'error',mode:input.mode,errors:[{code:'RETRIEVAL_QUEUE_FULL',path:'retrieval',message:'后台任务繁忙，请稍后重试。'}]};
 const job=runRecommendationCore(input,services);pendingRecommendations.set(key,job);
 try{return await job;}finally{pendingRecommendations.delete(key);}
}
async function runRecommendationCore(input, services = {}) {
  /* 第 1 步自然语言解析的结果（可为 null：没有自由文本，或前端已在 /api/intake/parse 解析过）。
     它只影响两处：① 候选侧的用户硬约束 gate；② 响应里的 nl_parse 审计块。
     ⛔ 它**不**影响校验：effectiveIntake 仍旧走 adaptIntakeObject + checker 同一套硬规则。 */
  const nlParse = input.inputParse && typeof input.inputParse === "object" ? input.inputParse : null;
  let effectiveIntake = input.intake;
  if (input.analysis && input.exclusion_confirmation && Array.isArray(input.exclusion_confirmation.confirmed_ids)) {
    const selected = input.analysis.candidates.filter(c => input.exclusion_confirmation.confirmed_ids.includes(c.id));
    const prior = input.intake?.hard_exclusions && typeof input.intake.hard_exclusions === "object" ? input.intake.hard_exclusions : {};
    effectiveIntake = { ...input.intake, hard_exclusions: {
      tags: [...new Set([...(Array.isArray(prior.tags) ? prior.tags : []), ...selected.filter(c => c.kind === "tag").map(c => c.tag)])],
      terms: [...new Set([...(Array.isArray(prior.terms) ? prior.terms : []), ...selected.filter(c => c.kind === "term").map(c => c.term)])],
      unresolved: Array.isArray(prior.unresolved) ? prior.unresolved : [],
    }};
  }
  const demo = typeof input.demo === "string" ? input.demo : null;
  const mode = normalizeMode(input.mode);
  const notices = [...modeFallbackNotices(), ...modeNotices(mode)];
  if (Array.isArray(input.parseNotice)) notices.push(...input.parseNotice.filter((item) => typeof item === "string" && item));

  const adapterResult = adaptIntakeObject(effectiveIntake, { pursuitReady: input.pursuitReady });
  if (adapterResult.status !== "ready") {
    return {
      kind: "needs_input",
      status: "needs_input",
      errors: adapterResult.errors,
      mode,
      notices,
    };
  }
  if (typeof input.intake?.dislikes === "string" && input.intake.dislikes.trim()) {
    const confirmation = input.exclusion_confirmation;
    if (!confirmation || typeof confirmation.analysis_id !== "string" || !Array.isArray(confirmation.confirmed_ids)) {
      return { kind: "needs_input", status: "needs_input", errors: [{ code: "INTAKE_CLARIFICATION_REQUIRED", path: "exclusion_confirmation", message: "请先完成不喜欢内容的识别与逐项确认。" }], mode, notices };
    }
    const analysis = input.analysis;
    if (!analysis) return { kind: "needs_input", status: "needs_input", errors: [{ code: "EXCLUSION_ANALYSIS_STALE", path: "exclusion_confirmation.analysis_id", message: "排除项识别已过期或不存在，请重新识别。" }], mode, notices };
    if (canonical(analysis.intake) !== canonical(input.intake) || analysis.status !== "needs_confirmation") {
      return { kind: "needs_input", status: "needs_input", errors: [{ code: "EXCLUSION_ANALYSIS_STALE", path: "exclusion_confirmation.analysis_id", message: "排除项识别与当前输入不一致，请重新识别。" }], mode, notices };
    }
    const ids = analysis.candidates.map(c => c.id);
    const unique = new Set(confirmation.confirmed_ids);
    if (unique.size !== confirmation.confirmed_ids.length || unique.size !== ids.length || ids.some(id => !unique.has(id))) {
      return { kind: "needs_input", status: "needs_input", errors: [{ code: "INTAKE_CLARIFICATION_REQUIRED", path: "exclusion_confirmation.confirmed_ids", message: "请确认全部识别到的排除项，且每项只能确认一次。" }], mode, notices };
    }
  }
  const key = canonical({ owner:input.ownerScope || "internal", intake: effectiveIntake,analysis:input.analysis??null,inputParse:input.inputParse??null, exclusion_confirmation: input.exclusion_confirmation || null, mode, demo });
  const cached = getRunByRecommendationKey(key);
  if (cached) return { kind: "report", status: cached.status, run: cached, report: publicReport(cached), idempotent: true };
  const requestJson = adapterResult.request_json;
  const request = parseJsonOrNull(requestJson);
  const requestCheck = validateRequestOnly(requestJson, strictParse);
  if (!requestIsValid(requestCheck)) {
    return {
      kind: "needs_input",
      status: "needs_input",
      errors: requestCheck.errors.filter((e) => e.path.startsWith("request")),
      mode,
      notices,
    };
  }

  const callCounts = { recommend: 0, recommend_revision: 0, presentation: 0, presentation_revision: 0 };
  const workflowErrors = [];
  let initialCandidatesJson = null;
  let initialValidation = null;
  let candidatesJson = null;
  let validation = null;
  let repairCount = 0;

  const retrievalEnabled = mode !== "mock" && (services.retrievalEnabled ?? RETRIEVAL_CONFIG.provider !== "unavailable");
  /* 库优先只在真实模式启用（mock 保持离线、快、可复现）。 */
  const libraryEnabled = mode !== "mock" && (services.libraryEnabled ?? true);
  let searchPlan = normalizeRetrievalPlan({needs_retrieval:false,queries:[]});
  // A caller may supply a previously model-decided plan; production LLM uses tool_calls below.
  if(retrievalEnabled && services.planRetrieval){
    try{searchPlan=await services.planRetrieval({intake:effectiveIntake,request,inputParse:nlParse},{signal:input.signal});}
    catch{searchPlan={...searchPlan,audit:{decision_status:'planning_failed'}};}
  }
  let retrieval = retrievalEnabled && searchPlan.needs_retrieval
    ? await (services.retrievalWorker ?? retrievalWorker).submit(searchPlan,{signal:input.signal,providerOptions:{dbPath:services.catalogDbPath??localDbPath(),onProgress:services.onRetrievalProgress}}).catch(() => ({status:"unavailable",evidence_id:null,products:[],contents:[],images:[],coverage:[],warnings:[]}))
    : {status:"skipped",evidence_id:null,products:[],contents:[],images:[],coverage:[],warnings:[]};
  const useAgentTools = mode==='llm' && retrievalEnabled;
  const agentTools = createOpencliToolSession({signal:input.signal,auditStore:useAgentTools?(services.retrievalAuditStore??createRetrievalAudit({sensitiveValues:retrievalSensitiveValues(input)})):null,search:(plan,{signal})=>(services.retrievalWorker??retrievalWorker).submit(plan,{signal,providerOptions:{dbPath:services.catalogDbPath??localDbPath(),onProgress:services.onRetrievalProgress}})});
  let productReferences = null,referenceReferences=null;
  /* 第一次生成 */
  if (demo === "slow") await sleep(45000);
  if (mode === "dify") {
    const call = await (services.requestCandidates ?? difyRequestCandidates)(requestJson, retrievalEnabled ? retrieval : null);
    callCounts.recommend += 1;
    if (!call.ok) {
      return {
        kind: "infrastructure_error",
        status: "error",
        errors: [{ code: call.code, path: "dify", message: call.message }],
        mode,
        notices: [...notices, "真实 Dify 调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。"],
      };
    }
    const raw = call.outputs && typeof call.outputs.candidates_json === "string" ? call.outputs.candidates_json : null;
    candidatesJson = raw;
    productReferences = parseJsonOrNull(call.outputs?.product_references_json || "null");
    referenceReferences = parseJsonOrNull(call.outputs?.reference_references_json || 'null');
  } else if (mode === "llm") {
    // 直连大模型：一次真实调用（含超时与重试上限）。
    // 失败一律如实上报为基础设施错误，绝不静默改用模拟候选。
    const call = await (services.requestCandidates ?? llmProvider.requestCandidates)({
      requestJson,
      intakeJson: input.intake === undefined ? null : dump(input.intake),
      retrieval: retrievalEnabled ? retrieval : null,
      // 库优先：先把本地库（opencli 采集）里真实、预算内的商品给模型看，避免它凭空想买不到的东西。
      library: libraryEnabled && searchPlan.needs_retrieval
        ? (services.libraryPreview ?? libraryPreview)({
            dbPath: services.catalogDbPath ?? localDbPath(),
            budgetAmount: request.budget_amount,
            limit: 8,
            forbiddenTerms: request.forbidden_terms,
            forbiddenTags: request.forbidden_tags,
            searchPlan,
            keywords: searchPlan.keywords,
          })
        : null,
      /* 第 1 步解析出来的用户硬约束（原文/带宽/城市）随请求一起给模型（裁定 2/3/4）。 */
      inputParse: nlParse,
      ...(useAgentTools?{tools:agentTools.tools,executeTool:agentTools.executeTool,signal:input.signal}:{}),
    });
    callCounts.recommend += call.model_calls ?? 1;
    if (!call.ok) {
      if(useAgentTools)agentTools.finalize({status:input.signal?.aborted?'cancelled':'failed',errorCode:call.code});
      return {
        kind: "infrastructure_error",
        status: "error",
        errors: [{ code: call.code, path: "llm", message: call.message }],
        mode,
        notices: [...notices, "直连大模型调用未成功，未生成任何候选，也没有把模拟数据伪装成真实结果。"],
      };
    }
    candidatesJson = call.outputs && typeof call.outputs.candidates_json === "string" ? call.outputs.candidates_json : null;
    productReferences = parseJsonOrNull(call.outputs?.product_references_json || "null");
    referenceReferences = parseJsonOrNull(call.outputs?.reference_references_json || 'null');
    if(agentTools.audit.length){retrieval=agentTools.retrieval;searchPlan=agentTools.plan;}
  } else if (demo === "model_error") {
    const broken = buildBrokenModelOutput();
    callCounts.recommend += 1;
    candidatesJson = broken.candidates_json;
    notices.push(broken.notice);
  } else if (demo === "partial_fail") {
    const built = buildMockPartialFailure(request);
    callCounts.recommend += 1;
    candidatesJson = built.candidates_json;
    notices.push(built.notice);
  } else if (demo === "stress") {
    // 前端破版自查专用：结构不变，只把文案拉到极端长度并夹入 emoji 与不可断行长串。
    const built = buildMockStressCandidates(request);
    callCounts.recommend += 1;
    candidatesJson = built.candidates_json;
    notices.push(built.notice);
  } else {
    const built = buildMockCandidates(request);
    callCounts.recommend += 1;
    candidatesJson = built.candidates_json;
    notices.push(MOCK_CANDIDATE_NOTICE);
  }

  initialCandidatesJson = candidatesJson;
  initialValidation = validate(requestJson, candidatesJson, strictParse);
  validation = validateForDecision(requestJson, candidatesJson, strictParse);

  const internal = validation.errors.some((e) => e.code === "INTERNAL_ERROR");
  let repairable = mode === "mock" && !internal && !validation.all_passed && repairCount === 0;

  if (repairable) {
    /* 全局唯一一次自动业务修订（推荐阶段用掉，呈现阶段就不能再用） */
    const batch = parseJsonOrNull(candidatesJson);
    const items = batch && Array.isArray(batch.candidates) ? batch.candidates : [];
    // 模型输出损坏时，修订也拿到同样的损坏输入：不伪造“已修复”，如实停在错误态。
    const revised =
      demo === "model_error"
        ? { candidates_json: buildBrokenModelOutput().candidates_json, changed: [], notice: "模拟模型两次都输出损坏 JSON。" }
        : buildMockRevision(request, items, validation);
    callCounts.recommend_revision += 1;
    repairCount = 1;
    const revisedValidation = validateForDecision(requestJson, revised.candidates_json, strictParse);
    // N6 状态保护：已通过候选必须逐字节不变，否则整次修订不得用于选择。
    const previousPassed = new Map(
      items
        .map((candidate, index) => [validation.candidate_results[index], candidate])
        .filter(([result]) => result && result.passed)
        .map(([result, candidate]) => [result.id, candidate]),
    );
    if (previousPassed.size > 0) {
      const revisedBatch = parseJsonOrNull(revised.candidates_json);
      const revisedItems = revisedBatch && Array.isArray(revisedBatch.candidates) ? revisedBatch.candidates : [];
      for (const [cid, previous] of previousPassed) {
        const matches = revisedItems.filter((c) => c && typeof c === "object" && c.id === cid);
        if (matches.length !== 1 || canonical(matches[0]) !== canonical(previous)) {
          workflowErrors.push({
            code: "PASSED_CANDIDATE_CHANGED",
            path: cid,
            message: "修订改动了已通过候选，整次修订拒绝用于选择",
          });
        }
      }
    }
    candidatesJson = revised.candidates_json;
    validation = revisedValidation;
    notices.push(revised.notice);
  } else if (mode === "mock" && !validation.all_passed && repairCount >= GLOBAL_REPAIR_LIMIT) {
    workflowErrors.push({
      code: "REPAIR_NOT_ALLOWED",
      path: "repair_count",
      message: "当前无法自动调整候选，请重新生成。",
    });
  }

  let evidenceBindings = new Map();
  const optionalEvidence=bindOptionalCandidateEvidence(retrieval,(parseJsonOrNull(candidatesJson)||{}).candidates??[],productReferences,request.budget_amount);
  evidenceBindings=optionalEvidence.bindings;
  const optionalReferences=bindReferenceEvidence(retrieval.references??[],(parseJsonOrNull(candidatesJson)||{}).candidates??[],referenceReferences);
  for(const id of optionalEvidence.knownOverBudget){const result=validation.candidate_results.find(r=>r.id===id);if(result){result.passed=false;pushError(result.errors,'OVER_BUDGET',id+'.estimated_total','所选商品的无附加条件观察价超过预算上限');}}

  /* ---- 追加规则 1：独特性启发式（warning 级，绝不硬错）------------------- */
  const candidateList = (parseJsonOrNull(candidatesJson) || {}).candidates || [];
  attachUniquenessWarnings(validation, candidateList);
  /* 履约方式（受控枚举）+ 关系假定门禁：只影响**那一个**候选，不牵连其他两个。 */
  const fulfillmentByCandidate = new Map();
  const relationId = request?.recipient_relation_id ?? request?.recipient_relation ?? null;
  validation.candidate_results.forEach((result, index) => {
    const candidate = candidateList[index];
    const verdict = fulfillmentOf(candidate, index);
    fulfillmentByCandidate.set(result.id ?? `candidates[${index}]`, verdict);
    result.warnings = [...(result.warnings ?? []), ...verdict.warnings];
    const gateErrors = [...verdict.errors, ...relationAssumptionErrors(candidate, index, { relation_id: relationId })];
    if (gateErrors.length && result.passed) {
      result.passed = false;
      result.errors = [...result.errors, ...gateErrors];
    }
  });

  /* 先匹配真实商品，以页面物流字段补充时间提示。 */
  const catalogEnabled = mode !== "mock" || services.catalogEnabled === true;
  let catalog = {
    status: "unavailable",
    source: "localdb",
    reason_code: catalogEnabled ? "CATALOG_NOT_RUN" : "CATALOG_SKIPPED_MOCK_MODE",
    hit_kind: "degraded",
    results: [],
    accounting: { candidates: candidateList.length, library_hits: 0, fallback_hits: 0, degraded: candidateList.length, scrape_calls: 0, scrape_total_elapsed_ms: 0, fallback_skipped_reason: catalogEnabled ? null : "SCRAPE_DISABLED", scrape_enabled: false },
  };
  if (catalogEnabled) {
    const passable = candidateList.filter((candidate) => evidenceBindings.has(candidate.id) && evidenceBindings.get(candidate.id).reference_kind!=='public_reference' && validation.candidate_results.some((result) => result.id === candidate.id && result.passed));
    // External tool work already followed the model's pre-generation decision. Do not blind-scrape again.
    const scrapeEnabled = false;
    const scrapeTimeoutMs = Number(process.env.GIFTWISE_CATALOG_SCRAPE_TIMEOUT_MS) > 0 ? Number(process.env.GIFTWISE_CATALOG_SCRAPE_TIMEOUT_MS) : 20000;
    try {
      const provided = await (services.provideRealProducts ?? provideRealProducts)({
        candidates: passable,
        budgetAmount: request.budget_amount,
        dbPath: services.catalogDbPath ?? CATALOG_CONFIG.dbPath,
        maxItems: CATALOG_CONFIG.maxItems,
        scrapeEnabled,
        scrapeTimeoutMs,
        spawnImpl: services.spawnCollect,
        searchPlan,
        signal:input.signal,
      });
      catalog = provided.catalog;
    } catch (error) {
      catalog = { ...catalog, status: "unavailable", reason_code: "CATALOG_MATCH_FAILED", results: [], note: `匹配层异常：${error?.message ?? "未知"}` };
    }
  }
  const catalogByCandidate = new Map((catalog.results ?? []).filter((entry) => entry.status === "matched").map((entry) => [entry.candidate_id, entry]));

  /* 时间提示：真实模式参考商品页时长，未知快递按3~5天估算；模拟模式不编造物流。 */
  const deliveryApplicable = mode !== "mock" && typeof request.available_days === "number";
  const delivery = {
    applicable: deliveryApplicable,
    reason: deliveryApplicable ? null : mode === "mock" ? "模拟数据没有真实物流信息" : "未提供送礼时间",
    policy: {
      rule: "时间不参与推荐筛选、排序或可选性判断",
      shipping: { ...SHIPPING_CONFIG },
      presale: { ...PRESALE_CONFIG },
      presale_note: "预售发货时长来自页面信息，缺失时保留未知。",
      purchase_window: { ...PURCHASE_WINDOW_CONFIG },
      tier_rule: "未知快递统一按3~5天估算，与用户选择的时间档位无关",
      not_a_guarantee: PURCHASE_WINDOW_CONFIG.not_a_guarantee,
    },
    per_candidate: {},
  };
  if (mode === "mock") notices.push("模拟数据没有真实物流信息。");
  validation.candidate_results.forEach((result, index) => {
    const candidate = candidateList[index];
    const bound = catalogByCandidate.get(result.id) ?? null;
    const productShipping = bound?.product?.shipping ?? null;
    const declaredShipping = candidate && Object.hasOwn(candidate, "estimated_shipping_days") ? candidate.estimated_shipping_days : undefined;
    const parsedShippingOnly = productShipping ? parseDurationDays(productShipping.shipping_time_text) : { days: null, source_text: null };
    const parsedShipsWithin = productShipping ? parseDurationDays(productShipping.ships_within_text ?? productShipping.presale_text ?? null) : { days: null, source_text: null };
    const shippingDays = typeof declaredShipping === "number" && Number.isFinite(declaredShipping) ? declaredShipping : null;
    const declaredPresale = candidate && Object.hasOwn(candidate, "presale_days") ? candidate.presale_days : undefined;
    const presaleDays = typeof declaredPresale === "number" && Number.isFinite(declaredPresale) ? declaredPresale : (typeof productShipping?.presale_days === "number" ? productShipping.presale_days : null);
    const isPreorder = productShipping?.is_preorder === true || (typeof declaredPresale === "number" && Number.isFinite(declaredPresale));
    const prepDays = typeof result.estimated_preparation_days === "number" ? result.estimated_preparation_days : (candidate && typeof candidate.estimated_preparation_days === "number" ? candidate.estimated_preparation_days : null);
    const verdict = deliveryApplicable
      ? deliveryDeadline({
          prep_days: prepDays,
          fulfillment: fulfillmentByCandidate.get(result.id ?? `candidates[${index}]`)?.value ?? FULFILLMENT_CONFIG.default,
          // 分开传：发货时效与配送时效各自可能是页面原文；网购时长由判定层合并（不重复计算）
          ships_within_days: typeof productShipping?.ships_within_days === "number" ? productShipping.ships_within_days : parsedShipsWithin.days,
          shipping_days: typeof productShipping?.shipping_days === "number" ? productShipping.shipping_days : parsedShippingOnly.days,
          presale_days: presaleDays,
          presale_declared: typeof presaleDays === "number",
          is_preorder: isPreorder,
          available_days: typeof request.available_days === "number" ? request.available_days : null,
          path: `candidates[${index}]`,
        })
      : { errors: [], warnings: [], effective_shipping_days: null, effective_presale_days: null, shipping_basis: "not_applicable", shipping_days_source: "not_applicable", tier_inclusive: false, total_days: null, purchase_window: null };
    delivery.per_candidate[result.id ?? `candidates[${index}]`] = {
      applicable: deliveryApplicable,
      product_id: bound?.product?.product_id ?? null,
      preparation_days: prepDays,
      declared_shipping_days: typeof declaredShipping === "number" ? declaredShipping : null,
      effective_shipping_days: verdict.effective_shipping_days,
      shipping_basis: verdict.shipping_basis,
      /** 数据层来源标记（界面不显示来源说明，被追问时可追溯）。 */
      shipping_days_source: verdict.shipping_days_source,
      shipping_days_default: { ...PURCHASE_WINDOW_CONFIG },
      purchase_window: verdict.purchase_window,
      tier_inclusive: verdict.tier_inclusive === true,
      shipping_time_text: productShipping?.shipping_time_text ?? null,
      ships_within_text: productShipping?.ships_within_text ?? null,
      effective_presale_days: verdict.effective_presale_days,
      presale_source_text: productShipping?.ships_within_text ?? null,
      is_preorder: isPreorder,
      shipping_origin: productShipping?.shipping_origin ?? null,
      seller_location_text: productShipping?.seller_location_text ?? null,
      total_days: verdict.total_days,
      available_days: typeof request.available_days === "number" ? request.available_days : null,
      is_estimate: deliveryApplicable && verdict.shipping_days_source === "default_estimate",
      fulfillment: verdict.fulfillment ?? FULFILLMENT_CONFIG.default,
      fulfillment_confidence: FULFILLMENT_CONFIG.confidence,
      fulfillment_note: FULFILLMENT_CONFIG.confidence_note,
      fulfillment_hint: FULFILLMENT_CONFIG.hints[verdict.fulfillment ?? FULFILLMENT_CONFIG.default] ?? null,
      /** 购买方式提示（可显示在主界面；不是"来源说明"）。 */
      page_url: bound?.product?.page_url ?? null,
      price_basis: verdict.fulfillment === 'online' || verdict.fulfillment === undefined ? (bound?.product?.price_basis ?? null) : (bound ? 'online_reference' : null),
      price_basis_note: verdict.fulfillment === 'online' || verdict.fulfillment === undefined ? null : '线下/体验方案的价格取同款或同类商品的**网购参考价**，不是门店实际售价',
      errors: verdict.errors.map((item) => item.code),
      warnings: verdict.warnings.map((item) => item.code),
    };
    // 只让**这一个**候选不可选，不牵连其他两个。
    if (verdict.errors.length > 0 && result.passed) {
      result.passed = false;
      result.errors = [...result.errors, ...verdict.errors];
    }
    result.warnings = [...(result.warnings ?? []), ...verdict.warnings];
  });
  /* 第 1 步解析约束：预算与喜好沿用原契约，时间仅作提示。 */
  const inputParseAudit = applyInputParseGates({ inputParse: nlParse, validation, candidates: candidateList, delivery, notices });
  if (inputParseAudit) {
    validation.input_parse_gates = inputParseAudit;
    if (inputParseAudit.findings.length > 0) {
      notices.push(`有${inputParseAudit.findings.length}条与你的需求相关的提示，请结合方案查看。`);
    }
  }
  validation.all_passed = validation.errors.length === 0 && validation.candidate_results.length === LIMITS.candidatesPerBatch && validation.candidate_results.every((item) => item.passed);
  if (!validation.all_passed && ["passed"].includes(validation.status)) validation.status = "failed";

  /* ---- 追加规则 3：第 3–4 步的包装风格与色彩视觉方向（与 intake 一致、可追溯）----
     ⚠️ 这一段的 `llm_text` 通道会发起**真实**大模型调用（`services.visualDirectionProvider`
     可注入替身；测试必须注入，否则会真的出站）。 */
  let directionOutcome = null;
  try {
    const provider = services.visualDirectionProvider ?? visualDirectionProviderFactory({ llm: llmProvider, imageTransport: mediaProvider.transport ?? null });
    directionOutcome = await deriveVisualDirection({
      intake: input.intake,
      request,
      candidates: candidateList.filter((candidate) => validation.candidate_results.some((result) => result.id === candidate.id && result.passed)),
      runId: null,
      provider,
    });
  } catch (error) {
    directionOutcome = { ok: false, code: error?.code ?? "DIRECTION_FAILED", notices: [`⚠ 第 3–4 步的视觉方向未能产出（${error?.message ?? "未知原因"}）；后续步骤不会用模拟方向顶替。`] };
  }
  notices.push(...(directionOutcome?.notices ?? []));

  let status = validation.status;
  if (workflowErrors.length > 0 && !["error", "needs_input"].includes(status)) status = "failed";
  const selectable = computeSelectable(validation, workflowErrors);

  const run = createRun({
    owner_scope:input.ownerScope || "internal",
    // 付费生图必须是**显式**授权（services.enableImageGeneration === true）。
    // 旧表达式里的 `|| !services.requestCandidates` 在生产入口恒为真（services 不传），
    // 会让第一次选择就真实扣费，已删除。
    media_generation_authorized:(mode === "dify" || mode === "llm") && services.enableImageGeneration === true,
    mode,
    request_json: requestJson,
    request,
    intake_echo: null,
    initial_candidates_json: initialCandidatesJson,
    initial_validation: initialValidation,
    candidates_json: candidatesJson,
    candidates: candidateList,
    validation,
    workflow_errors: workflowErrors,
    repair_count: repairCount,
    status,
    selectable_candidate_ids: selectable,
    notices,
    idempotency_key: key,
    nl_parse: nlParse,
  });
  run.retrieval = retrieval;
  run.retrieval_audit = {protocol:useAgentTools?'model_tool_calls':mode==='dify'?'remote_workflow_tools_not_exposed':'disabled',tool_calls:agentTools.audit,plan:searchPlan,coverage:retrieval.coverage??[],warnings:retrieval.warnings??[],references:productReferences,reference_references:referenceReferences,rejected_references:[...optionalEvidence.rejected,...optionalReferences.rejected]};
  run.product_bindings = evidenceBindings;
  run.reference_bindings=optionalReferences.bindings;
  /* 库内真实商品的绑定与媒体：候选图走「来源展示」通道（真实商品图 URL），
     包装图才走「生成」通道；两条通道不交叉（设计说明「两条通道不越界」）。 */
  run.catalog = catalog;
  run.catalog_bindings = new Map((catalog.results ?? []).filter((entry) => entry.status === "matched"&&evidenceBindings.get(entry.candidate_id)?.product_id===entry.product.product_id).map((entry) => [entry.candidate_id, entry]));
  const mediaBindings = [
    ...[...run.catalog_bindings.values()].map((entry) => ({
      candidate_id: entry.candidate_id,
      product_id: entry.product.product_id,
      binding_basis: entry.match_basis,
      match_detail: entry.match_detail,
      product_url: entry.product.page_url,
      product_title: entry.product.title,
      image: entry.product.image_id && entry.product.image_validation?.ok
        ? {
            id: entry.product.image_id,
            url: `/api/catalog/images/${entry.product.image_id}`,
            version: entry.product.image_id,
            kind: "source_photo",
            alt: `真实商品来源图：${entry.product.title}`,
            source_url: entry.product.image_urls[0] ?? null,
            attribution: entry.product.attribution,
            price_basis: entry.product.price_basis,
            price_observed_at: entry.product.price_observed_at,
          }
        : null,
    })),
    ...[...evidenceBindings].map(([candidate_id,p])=>({candidate_id,product_id:p.product_id,
      image:p.image_id&&p.image_validation?.ok?{id:p.image_id,url:`/api/catalog/images/${p.image_id}`,version:p.image_id,kind:'source_photo',alt:`真实商品来源图：${p.name}`,source_url:p.source_url??p.image_url,price_observed_at:p.observed_at}:null})),
    ...[...optionalReferences.bindings].filter(([id])=>!evidenceBindings.has(id)).map(([candidate_id,r])=>({candidate_id,reference_id:r.reference_id,
      image:r.image_id&&r.image_validation?.ok?{id:r.image_id,url:`/api/reference/images/${r.image_id}`,version:r.image_id,kind:'reference_image',alt:`公开资料参考图：${r.title}`,source_url:r.source_url,price_observed_at:r.observed_at}:null})),
  ];
  for(const entry of run.catalog_bindings.values()){
    const p=entry.product;if(!p.image_validation?.ok)continue;
    const existing=run.retrieval.products.find(x=>x.product_id===p.product_id);
    const observed={product_id:p.product_id,name:p.title,title:p.title,variant:p.specifications??'',source_url:p.page_url,product_url:p.page_url,source_site:p.source_site,
      price_amount:p.price_amount,currency:p.currency,price_conditions:p.price_conditions,image_id:p.image_id,image_url:p.image_urls[0]??null,observed_at:p.price_observed_at,image_validation:p.image_validation};
    if(existing)Object.assign(existing,observed);else run.retrieval.products.push(observed);
  }
  run.media = mediaProvider.candidates([...new Map(mediaBindings.map(b=>[b.candidate_id,b])).values()]);
  if(useAgentTools)run.retrieval_audit.persistence=agentTools.finalize({runId:run.run_id,status:'completed',bindings:run.media.candidates,rejected:run.retrieval_audit.rejected_references,candidateIds:run.candidates.map(c=>c.id),references:run.retrieval.references??[]});
  run.delivery = delivery;
  run.uniqueness = { warnings: validation.warnings ?? [], note: "独特性是主观的：这里只用可检验的启发式降低大众化倾向，不声明「保证独特」。" };
  run.visual_direction = directionOutcome?.ok ? directionOutcome.direction : null;
  run.visual_direction_error = directionOutcome?.ok ? null : { code: directionOutcome?.code ?? "DIRECTION_FAILED" };
  run.call_counts = callCounts;
  run.demo = demo;
  /* 第 1 步自然语言解析的审计块（null＝本次没有自由文本/未解析）。
     账本口径更正（产品负责人 2026-10-31 独立验收）：一次**成功**的完整交互＝
     recommend 1 次 + style_direction 1 次 + present 1 次（repair_count=0）＝**3 次**模型调用 + 1 次生图；
     首轮输出不合格触发一次修复时才是 5 次。生图**没有** JSONL 账本（recordRealCall 只在 web/server/llm/），
     它的硬证据是 media-store 新增 task+asset 与响应里的 generation 块。 */
  run.nl_parse = nlParse
    ? { ...nlParse, call_ledger_kind: "intake_parse", note: "解析调用同样写服务端账本（kind=intake_parse），与 recommend/style_direction/present 分别计数。" }
    : null;
  run.initial_candidates = (parseJsonOrNull(initialCandidatesJson) || {}).candidates || [];
  run.initial_candidate_ids = initialValidation.candidate_results.map((r) => r.id);

  const referenceImagesEnabled=services.referenceImagesEnabled??(useAgentTools&&!process.env.NODE_TEST_CONTEXT);
  if(referenceImagesEnabled&&useAgentTools&&validation.all_passed&&workflowErrors.length===0&&run.candidates.length===3){
    startReferenceImages(run,{session:agentTools,requestJson,intakeJson:dump(effectiveIntake),signal:input.signal,isCurrent:()=>getRun(run.run_id)===run,requestImages:services.requestReferenceImages??llmProvider.requestReferenceImages});
  }

  return { kind: "report", status, run, report: publicReport(run) };
}

/* ------------------------------------------------------------ 呈现阶段 */

function buildSections(presentation, candidate, request) {
  const styleNames = (Array.isArray(request.gift_styles) ? request.gift_styles : [])
    .map((id) => GIFT_STYLE_TABLE[id])
    .filter(Boolean);
  const closenessName = CLOSENESS_TABLE[request.closeness] || "未提供";
  return [
    {
      key: "style",
      title: "① 风格与配色",
      items: [
        `配色：${presentation.packaging.color_palette.join("、")}`,
        `风格取向：${styleNames.length > 0 ? styleNames.join("、") : "未指定，按低风险通用方向处理"}`,
        `关系与场合：${request.recipient_relation} · ${request.occasion}（熟悉程度 ${closenessName}）`,
        `围绕方案：${candidate.name} —— ${candidate.description}`,
      ],
    },
    {
      key: "packaging",
      title: "② 包装材料与步骤",
      items: packagingSectionItems(presentation.packaging),
    },
    {
      key: "card",
      title: "③ 贺卡正文与装饰物建议",
      items: [`贺卡正文：${presentation.card_text}`, ...(presentation.decorative_advice || []).map((d) => `装饰物：${d}`)],
    },
    {
      key: "giving",
      title: "④ 赠送时机、方式与话术",
      items: [
        `时机与方式：${presentation.giving_advice.timing}`,
        `话术：${presentation.giving_advice.wording}`,
        ...presentation.giving_advice.relationship_cautions.map((c) => `关系提示：${c}`),
      ],
    },
  ];
}

function presentationView(run, candidate, presentation, recheck, extras) {
  return {
    recommendation_run_id: run.run_id,
    selected_candidate_id: candidate.id,
    status: recheck.passed ? "completed" : "presentation_failed",
    mode: run.mode,
    sections: recheck.passed ? buildSections(presentation, candidate, run.request) : [],
    presentation_json: presentation,
    presentation_check: recheck,
    candidate: {
      id: candidate.id,
      name: candidate.name,
      estimated_total: candidate.estimated_total,
      currency: candidate.currency,
      estimated_preparation_days: candidate.estimated_preparation_days,
    },
    recheck_summary: {
      contract_version: run.request.contract_version || null,
      gift_estimated_total: candidate.estimated_total,
      budget_range: run.request.budget_range ?? null,
      budget_amount: run.request.budget_amount,
      currency: presentation.currency,
      revised_estimated_preparation_days: presentation.revised_estimated_preparation_days,
      available_days: run.request.available_days,
      passed: recheck.passed,
      business_data_verification: "not_verified",
    },
    repair_count: run.repair_count,
    remaining_repairs: Math.max(0, GLOBAL_REPAIR_LIMIT - run.repair_count),
    // 模拟呈现标识只在 mock 模式出现；llm / replay 用各自的如实标识。
    notices: [...run.notices, ...(run.mode === "mock" ? [MOCK_PRESENTATION_NOTICE] : [])],
    call_counts: run.call_counts,
    ...extras,
  };
}

/**
 * @param {{runId: string, selectedCandidateId: string|null, demo?: string|null}} input
 */
export async function runPresentation(input, services = {}) {
 const run=getRun(input.runId);
 if(run&&run.owner_scope===(input.ownerScope||'internal')&&typeof input.selectedCandidateId==='string'){
  run.presentation_jobs??=new Map();if(run.presentation_jobs.has(input.selectedCandidateId))return run.presentation_jobs.get(input.selectedCandidateId);
  const job=runPresentationCore(input, services);run.presentation_jobs.set(input.selectedCandidateId,job);
  try{return await job;}finally{run.presentation_jobs.delete(input.selectedCandidateId);}
 }
 return runPresentationCore(input, services);
}
async function runPresentationCore(input, services = {}) {
  const run = getRun(input.runId);
  if (!run || run.owner_scope !== (input.ownerScope || "internal")) {
    return {
      kind: "not_found",
      status: "error",
      errors: [
        {
          code: "RECOMMENDATION_NOT_FOUND",
          path: "recommendation_run_id",
          message: "没有找到该推荐记录（可能进程已重启或记录已过期）；请重新填写需求。",
        },
      ],
    };
  }
  const selectedCandidateId = input.selectedCandidateId;
  if (typeof selectedCandidateId !== "string" || selectedCandidateId === "") {
    return {
      kind: "rejected",
      status: "selection_rejected",
      errors: [{ code: "INVALID_SELECTION", path: "selected_candidate_id", message: "请先选择一个方案；系统不会替你选择。" }],
    };
  }
  const candidates = Array.isArray(run.candidates) ? run.candidates : [];
  const candidate = candidates.find((c) => c && typeof c === "object" && c.id === selectedCandidateId);
  if (!candidate) {
    return {
      kind: "rejected",
      status: "selection_rejected",
      errors: [
        {
          code: "INVALID_SELECTION",
          path: "selected_candidate_id",
          message: "该候选 ID 不属于本次推荐记录，已拒绝；请从当前三个方案中重新选择。",
        },
      ],
    };
  }
  if (!run.selectable_candidate_ids.includes(selectedCandidateId)) {
    return {
      kind: "rejected",
      status: "selection_rejected",
      errors: [
        {
          code: "CANDIDATE_NOT_PASSED",
          path: "selected_candidate_id",
          message: "该方案未通过独立规则检查，不能选择；失败项需要你调整需求后重新生成。",
        },
      ],
    };
  }
  if(run.product_bindings?.has(selectedCandidateId)){
    try{const product=run.product_bindings.get(selectedCandidateId);verifyCandidateEvidence(run.retrieval,[candidate],[{candidate_id:selectedCandidateId,product_id:product?.product_id}],run.request.budget_amount);}
    catch{run.product_bindings.delete(selectedCandidateId);run.retrieval_audit??={};run.retrieval_audit.expired_reference=selectedCandidateId;}
  }
  // 幂等：同一选择重复提交返回同一份呈现，不重复消耗修订额度，并显式告知调用方这是重放。
  if (run.selections.has(selectedCandidateId)) {
    const cached = run.selections.get(selectedCandidateId);
    // 重新选择已完成文字的方案也复用其媒体任务，恢复选定绑定后只读状态。
    run.selected_candidate_id = selectedCandidateId;
    run.presentation = { presentation: cached.presentation_json, recheck: cached.presentation_check };
    run.media = cached.media;
    const taskId = cached.media?.selected?.task_id;
    if (taskId && cached.media.status !== "unavailable") {
      try { run.media = (await mediaProvider.task(run, taskId)).media; } catch { /* 保留已知媒体状态及文字。 */ }
    }
    const replay = { ...cached, media: run.media, idempotent_replay: true };
    run.selections.set(selectedCandidateId, replay);
    return {
      kind: "presentation",
      run,
      view: replay,
      idempotent: true,
    };
  }

  const demo = typeof input.demo === "string" ? input.demo : null;
  let presentation = null;
  let generatedBy = "mock";
  // 直连/回放呈现阶段的附加事实（账单、本地实现标识），只用于如实标注，不参与契约校验。
  let presentationExtras = {};
  if (run.mode === "dify") {
    const call = await (services.requestPresentation ?? difyRequestPresentation)(run.request_json, dump(candidate));
    run.call_counts.presentation += 1;
    if (!call.ok) {
      return {
        kind: "infrastructure_error",
        status: "error",
        errors: [{ code: call.code, path: "dify", message: call.message }],
      };
    }
    try {
      presentation = strictParse(call.outputs.presentation_json);
      generatedBy = "dify";
    } catch (e) {
      return {
        kind: "infrastructure_error",
        status: "error",
        errors: [{ code: "PRESENTATION_INVALID", path: "presentation_json", message: "Dify 输出的呈现内容不是合法 JSON，已按失败处理。" }],
      };
    }
  } else if (run.mode === "llm") {
    // 呈现阶段：Dify 侧从未实现（workflow/dify-setup.md:65），因此在本地实现。
    // 直连模式走模型；模型失败即如实失败，不用本地实现顶替。
    const call = await (services.requestPresentation ?? llmProvider.requestPresentation)({
      requestJson: run.request_json,
      candidateJson: dump(candidate),
      request: run.request,
      candidate,
      // 第 3–4 步的方向作为**额外系统消息**喂给呈现模型：文案必须与它一致，不许另起一套审美。
      visualDirectionText: run.visual_direction ? directionPromptText(run.visual_direction) : null,
    });
    run.call_counts.presentation += 1;
    if (!call.ok) {
      return {
        kind: "infrastructure_error",
        status: "error",
        errors: [{ code: call.code, path: "llm.presentation", message: call.message }],
      };
    }
    try {
      presentation = strictParse(call.outputs.presentation_json);
      generatedBy = call.generated_by || "llm_live";
    } catch (e) {
      return {
        kind: "infrastructure_error",
        status: "error",
        errors: [{ code: "PRESENTATION_INVALID", path: "presentation_json", message: "直连大模型输出的呈现内容不是合法 JSON，已按失败处理。" }],
      };
    }
    presentationExtras = {
      presentation_source: call.transport,
      ...(call.bill ? { bill: call.bill } : {}),
      ...(call.local ? { presentation_local_implementation: true } : {}),
    };
    if (Array.isArray(call.notices)) run.notices.push(...call.notices);
  } else {
    const built = buildMockPresentation(run.request, candidate, {
      attempt: 1,
      forceOverBudgetFirst: demo === "presentation_over_budget",
    });
    run.call_counts.presentation += 1;
    presentation = run.demo === "stress" || demo === "stress" ? stressifyPresentation(built.presentation) : built.presentation;
  }

  const rawPresentationCheck = checkPresentation(run.request, candidate, presentation);
  let recheck = checkPresentationForDecision(run.request, candidate, presentation);
  // 先检查模型原值，避免覆盖非法/缺失字段；合法估算统一引用冻结候选。
  if (typeof presentation?.revised_estimated_preparation_days === "number" && Number.isInteger(presentation.revised_estimated_preparation_days) && presentation.revised_estimated_preparation_days >= 0 &&
      !recheck.errors.some((e) => e.path === "presentation.revised_estimated_preparation_days")) {
    const reportedDays = presentation.revised_estimated_preparation_days;
    presentation = { ...presentation, revised_estimated_preparation_days: candidate.estimated_preparation_days };
    recheck = checkPresentationForDecision(run.request, candidate, presentation);
    recheck.raw_validation = structuredClone(rawPresentationCheck);
    if (reportedDays !== candidate.estimated_preparation_days) {
      recheck.preparation_estimate = { source: "selected_candidate", days: candidate.estimated_preparation_days, model_reported_days: reportedDays };
    }
  }
  /* 呈现文字与第 3–4 步方向的对齐：被禁颜色 → 硬错（「不喜欢的东西」绝对禁止）；
     明示偏好未被体现 → warning（文案措辞自由度高于生图 prompt）。 */
  const alignment = presentationAlignmentErrors(run.visual_direction, presentation);
  /* 履约措辞红线：⛔ 不许把"推测可得"说成"已确认有货/保证约到"（如实性问题，按硬错处理）。 */
  const wordingErrors = fulfillmentWordingErrors(presentation, { path: "presentation" });
  if (wordingErrors.length) {
    alignment.errors.push(...wordingErrors);
    alignment.warnings.push("履约方式只作**购买方式提示**：可以说「可以去商店购买」「需预约 / 可预约体验」，但不能声称已确认有货或保证约到。");
  }
  if (alignment.errors.length) {
    recheck.passed = false;
    recheck.errors = [...recheck.errors, ...alignment.errors];
  }
  if (alignment.warnings.length) {
    recheck.warnings = [...(recheck.warnings ?? []), ...alignment.warnings];
  }
  // 呈现阶段复用候选准备天数，物流信息仅作提示。
  const boundProduct = run.catalog_bindings?.get(selectedCandidateId)?.product ?? null;
  const boundShipping = boundProduct?.shipping ?? null;
  const presentationDeliveryApplicable = run.mode !== "mock" && typeof run.request.available_days === "number";
  const presentationDelivery = presentationDeliveryApplicable ? deliveryDeadline({
    prep_days: typeof presentation?.revised_estimated_preparation_days === "number" ? presentation.revised_estimated_preparation_days : null,
    ships_within_days: typeof boundShipping?.ships_within_days === "number" ? boundShipping.ships_within_days : parseDurationDays(boundShipping?.ships_within_text ?? null).days,
    shipping_days: typeof boundShipping?.shipping_days === "number" ? boundShipping.shipping_days : parseDurationDays(boundShipping?.shipping_time_text ?? null).days,
    presale_days: typeof boundShipping?.presale_days === "number" ? boundShipping.presale_days : undefined,
    presale_declared: typeof boundShipping?.presale_days === "number",
    is_preorder: boundShipping?.is_preorder === true,
    available_days: typeof run.request.available_days === "number" ? run.request.available_days : null,
    fulfillment: run.delivery?.per_candidate?.[selectedCandidateId]?.fulfillment ?? FULFILLMENT_CONFIG.default,
    path: "presentation",
  }) : { errors: [], warnings: [], effective_shipping_days: null, effective_presale_days: null, shipping_basis: "not_applicable", shipping_days_source: "not_applicable", tier_inclusive: false, total_days: null, applicable: false };
  if (presentationDelivery.errors.length) {
    recheck.passed = false;
    recheck.errors = [...recheck.errors, ...presentationDelivery.errors];
  }
  recheck.warnings = [...(recheck.warnings ?? []), ...presentationDelivery.warnings];
  let extras = {
    generated_by: generatedBy,
    ...presentationExtras,
    shipping: {
      applicable: presentationDeliveryApplicable,
      effective_shipping_days: presentationDelivery.effective_shipping_days,
      shipping_basis: presentationDelivery.shipping_basis,
      shipping_days_source: presentationDelivery.shipping_days_source,
      shipping_days_default: { ...PURCHASE_WINDOW_CONFIG },
      tier_inclusive: presentationDelivery.tier_inclusive === true,
      effective_presale_days: presentationDelivery.effective_presale_days,
      total_days: presentationDelivery.total_days,
      available_days: typeof run.request.available_days === "number" ? run.request.available_days : null,
      is_estimate: presentationDelivery.shipping_days_source === "default_estimate",
      not_a_guarantee: PURCHASE_WINDOW_CONFIG.not_a_guarantee,
    },
  };

  if (!recheck.passed) {
    // 直连模式绝不用模拟数据"修复"模型输出：复核没过就如实失败。
    if (run.mode === "llm") {
      extras.repair_note =
        "赠送指南未通过检查，请查看具体问题。";
      pushError(recheck.errors, "REPAIR_NOT_ALLOWED", "repair_count", "该模式不允许用模拟数据修订呈现内容");
      const view = presentationView(run, candidate, presentation, recheck, extras);
      return { kind: "presentation_failed", run, view };
    }
    if (run.repair_count >= GLOBAL_REPAIR_LIMIT) {
      extras.repair_note =
        "本次已自动调整过一次，请查看仍需解决的问题。";
      pushError(recheck.errors, "REPAIR_LIMIT_REACHED", "repair_count", "全局自动修订额度已用完，未继续自动修改");
      const view = presentationView(run, candidate, presentation, recheck, extras);
      return { kind: "presentation_failed", run, view };
    }
    // 剩余额度：允许一次呈现修订并重新复核（全局合计仍只有一次）。
    const firstErrors = recheck.errors.map((e) => ({ ...e }));
    const revised = buildMockPresentation(run.request, candidate, { attempt: 2 });
    run.call_counts.presentation_revision += 1;
    const revisedCheck = checkPresentationForDecision(run.request, candidate, revised.presentation);
    run.repair_count += 1;
    presentation = revised.presentation;
    recheck = revisedCheck;
    extras = {
      ...extras,
      revised_once: true,
      repaired_checks: firstErrors,
      repair_note: "呈现阶段首次复核未通过，已使用全局唯一一次自动修订并重新复核。",
    };
  }

  if (!recheck.passed) {
    const view = presentationView(run, candidate, presentation, recheck, extras);
    return { kind: "presentation_failed", run, view };
  }

  run.selected_candidate_id = selectedCandidateId;
  run.presentation = { presentation, recheck };
  /* 第 5 步：**只对用户选中的那一个**出最终包装图（不批量、不给未选中项出图）。
     `mediaProvider.packaging(run, selectedCandidateId)` 内部对 `selected_candidate_id`
     与 `selectable_candidate_ids` 都有校验，传其它 id 会直接抛 INVALID_SELECTION。 */
  /* 「用户选中这个礼物」这一刻**一次性铸造**参考图许可凭据（只含选中商品）：
     把选中候选绑定的**真实商品图**作为生图参考图，保证包装与礼物本体一致。
     ⚠️ 两条约束各管一半：A｜用户偏好（intake）→ 配色/风格（硬约束）；
     B｜礼物本体（参考图）→ 形态/尺度/材质/结构。冲突时 A 优先
     ⇒ 参考图只提供形态信息、不提供配色决策（见 media/plan.mjs 的 prompt）。 */
  run.reference_grant = mintReferenceGrant(run, selectedCandidateId);
  try {run.media = await mediaProvider.packaging(run, selectedCandidateId);} catch {run.media = {...mediaProvider.candidates(),status:"failed",warnings:["图像任务不可用，文字结果仍可查看；不自动重复调用"]};}
  // packaging 只等待任务建立；图片网络请求在 provider 内后台执行。
  const waitInfo = { waited: false, timed_out: false, waited_ms: 0, timeout_ms: 0,
    ...(run.media?.selected?.task_id ? { task_id: run.media.selected.task_id } : {}) };
  run.status = "completed";
  const view = { ...presentationView(run, candidate, presentation, recheck, extras), retrieval: retrievalView(run.retrieval), media: run.media, media_wait: waitInfo, media_reference: referenceReport(run, selectedCandidateId), catalog: publicReport(run).catalog, visual_direction: run.visual_direction, delivery: run.delivery, uniqueness: run.uniqueness };
  run.selections.set(selectedCandidateId, view);
  return { kind: "presentation", run, view };
}

/**
 * 参考图如实报告（⛔ 不许在没拿到参考图时声称用了参考图）。
 *
 * `reference_count`：拿到=1（最多 2），没拿到=0；
 * `actual_reference_count`：供应商**实际**报告的参考图张数（没有就为 null，表示未知而非 0）；
 * `reason_code`：没拿到时的原因码（REFERENCE_PRODUCT_UNBOUND / REFERENCE_IMAGE_UNAVAILABLE /
 * IMAGE_GENERATION_NOT_AUTHORIZED / IMAGE_GENERATION_FAILED …）。
 */
export function referenceReport(run, candidateId) {
  const binding = run.catalog_bindings?.get(candidateId) ?? null;
  const urls = Array.isArray(binding?.product?.image_urls)
    ? binding.product.image_urls.filter((u) => typeof u === 'string' && u.startsWith('https://'))
    : [];
  const generated = run.media?.selected?.generation ?? null;
  const actual = typeof generated?.reference_count === 'number' ? generated.reference_count : null;
  const mediaStatus = run.media?.status ?? 'unavailable';
  const usable = mediaStatus === 'ready';
  const intended = urls.length ? 1 : 0;
  let reason_code = null;
  if (!urls.length) reason_code = binding?.product ? 'REFERENCE_IMAGE_UNAVAILABLE' : 'REFERENCE_PRODUCT_UNBOUND';
  else if (mediaStatus === 'unavailable') reason_code = 'IMAGE_GENERATION_NOT_AUTHORIZED';
  else if (mediaStatus === 'failed') reason_code = 'IMAGE_GENERATION_FAILED';
  else if (usable && actual === 0) reason_code = 'REFERENCE_REJECTED_BY_PROVIDER';
  else if (!usable) reason_code = 'IMAGE_GENERATION_PENDING';
  return {
    reference_count: usable ? (actual ?? intended) : 0,
    intended_reference_count: intended,
    actual_reference_count: actual,
    product_id: binding?.product?.product_id ?? null,
    url: urls[0] ?? null,
    reason_code,
    grant_id: run.reference_grant?.grant_id ?? null,
    form_basis: intended ? { based_on: 'catalog_reference_image', field: 'catalog.product.image_urls[0]', product_id: binding?.product?.product_id ?? null } : { based_on: 'prompt_text_only', field: null, product_id: null },
    note: intended
      ? '参考图只提供形态/尺度/材质信息；配色与风格一律以第 3–4 步方向（来自用户偏好）为准，冲突时以偏好为先。'
      : '本次没有可用的真实商品参考图，退回纯 prompt 生图（未使用参考图）。',
  };
}
