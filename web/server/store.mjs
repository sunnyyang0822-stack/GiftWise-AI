/**
 * 服务端可信任务快照（内存实现，最小可用）。
 *
 * 设计要点：
 *   - 浏览器只提交 intake 字段与 {recommendation_run_id, selected_candidate_id}；
 *     快照、候选、校验结果、**修订计数**、可选列表全部只存在于服务端；
 *   - 修订计数不由请求参数传入，客户端提交 repair_count 会被 INTAKE_UNKNOWN_FIELD 拒绝；
 *   - 选择必须命中 selectable_candidate_ids，否则拒绝，不自动替选；
 *   - 本轮不实现持久化存储／数据库（明确后置），进程重启即丢失，属已知限制。
 */

import { randomUUID } from "node:crypto";

const RUN_LIMIT = 200;
const RUN_TTL_MS = 10 * 60 * 1000;

/** @type {Map<string, any>} */
const runs = new Map();
const recommendationKeys = new Map();

function nowIso() {
  // 统一按 Asia/Shanghai 记录，避免演示现场时区歧义。
  const now = new Date();
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(now.getTime() + offsetMs).toISOString().replace("Z", "+08:00");
}

export function createRun(init) {
  const runId = `gw-${new Date().getTime().toString(36)}-${randomUUID().slice(0, 8)}`;
  const run = {
    run_id: runId,
    owner_scope: init.owner_scope || "internal",
    media_generation_authorized: init.media_generation_authorized === true,
    created_at: nowIso(),
    mode: init.mode,
    request_json: init.request_json,
    request: init.request,
    intake_echo: init.intake_echo,
    initial_candidates_json: init.initial_candidates_json || null,
    initial_validation: init.initial_validation || null,
    candidates_json: init.candidates_json,
    candidates: init.candidates,
    validation: init.validation,
    workflow_errors: init.workflow_errors || [],
    repair_count: init.repair_count || 0,
    /** 第 1 步自然语言解析的审计块（null＝本次没有自由文本）；不参与任何校验。 */
    nl_parse: init.nl_parse || null,
    status: init.status,
    selectable_candidate_ids: init.selectable_candidate_ids || [],
    selected_candidate_id: null,
    presentation: null,
    /** 同一选择的幂等缓存：重复点击返回同一份呈现，不重复消耗额度。 */
    selections: new Map(),
    call_counts: { exclusion_analysis: init.exclusion_analysis || 0, recommend: 0, recommend_revision: 0, presentation: 0, presentation_revision: 0 },
    notices: init.notices || [],
  };
  runs.set(runId, run);
  if (init.idempotency_key) recommendationKeys.set(init.idempotency_key, runId);
  prune();
  return run;
}

export function getRunByRecommendationKey(key) {
  const id = recommendationKeys.get(key);
  return id ? getRun(id) : null;
}

export function getRun(runId) {
  if (typeof runId !== "string" || runId === "") return null;
  const run = runs.get(runId);
  if (!run) return null;
  if (Date.now() - new Date(run.created_at).getTime() > RUN_TTL_MS) {
    runs.delete(runId);
    for(const [key,id] of recommendationKeys)if(id===runId)recommendationKeys.delete(key);
    return null;
  }
  return run;
}

function prune() {
  for(const [key,id] of recommendationKeys)if(!getRun(id))recommendationKeys.delete(key);
  if (runs.size <= RUN_LIMIT) return;
  const ordered = [...runs.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  for (const run of ordered.slice(0, runs.size - RUN_LIMIT)){runs.delete(run.run_id);for(const [key,id] of recommendationKeys)if(id===run.run_id)recommendationKeys.delete(key);}
}

export function runCount() {
  return runs.size;
}

export function reset() {
  runs.clear();
  recommendationKeys.clear();
}

/** 面向浏览器的最小脱敏视图：不含密钥、不含内部提示。 */
export function publicReport(run) {
  return {
    retrieval: retrievalView(run.retrieval),
    media: run.media || { status: "unavailable", candidates: [], selected: null },
    recommendation_run_id: run.run_id,
    created_at: run.created_at,
    mode: run.mode,
    status: run.status,
    request: run.request,
    candidates: run.candidates,
    validation: run.validation,
    workflow_errors: run.workflow_errors,
    repair_count: run.repair_count,
    remaining_repairs: Math.max(0, 1 - run.repair_count),
    selected_candidate_id: null, // 推荐阶段必须保持 null
    selectable_candidate_ids: run.selectable_candidate_ids,
    business_data_verification: "not_verified",
    notices: run.notices,
    call_counts: run.call_counts,
    /* 阶段二与追加规则的可核对信息（都属于「如实标注」，不改变既有契约字段）：
       - catalog：真实商品库命中/补抓/降级三分账 + 每次补抓耗时；
       - delivery：准备 + 预售/发货 + 运输 <= 可用天数的逐候选判定与估算口径；
       - visual_direction：第 3–4 步的方向及其 based_on 追溯链；
       - uniqueness：独特性启发式（warning 级，不声明「保证独特」）。 */
    catalog: run.catalog ? catalogView(run.catalog) : null,
    delivery: run.delivery ?? null,
    visual_direction: run.visual_direction ?? null,
    visual_direction_error: run.visual_direction_error ?? null,
    uniqueness: run.uniqueness ?? null,
    /* 第 1 步自然语言解析的如实交代（null＝本次没有自由文本）：
       识别到哪些字段、哪些是推断、用户原值回显、±带宽与候选级结论。
       ⛔ 这里只做交代，不参与校验；被降级时 degraded=true 且 reason_code 说明原因。 */
    nl_parse: run.nl_parse ?? null,
    limits: { currency: "CNY", note: "费用与准备时间仅为估算；未核实真实价格、库存或实际送达。运输与预售时长为页面原文或保守估算，不构成送达保证。" },
  };
}

/** Tool choices/failures stay in run.retrieval_audit; source observations remain reviewable. */
export function retrievalView(retrieval) {
  if(!retrieval)return {status:'skipped',evidence_id:null,products:[],contents:[],images:[],warnings:[]};
  const productKeys=['product_id','name','title','variant','specifications','specifications_basis','quantity','price_amount','price_range','currency','price_unit','price_text','price_conditions','price_source','price_kind','reference_kind','image_kind','summary','source_url','product_url','source_site','source_platform','page_kind','observed_at','price_observed_at','image_url','image_id','image_validation','image_provenance','stock_status','shipping_status','evidence_ref','record_kind','city','address','physical'];
  const contentKeys=['record_kind','purpose','title','source_url','source_site','source_platform','image_url','image_role','summary','author','location','source_time_text','observed_at'];
  const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
  const referenceKeys=['reference_id','title','summary','reference_kind','purpose','source_url','source_platform','source_site','observed_at','price_text','price_amount','price_kind','currency','image_id','image_url','image_kind','image_validation','image_provenance'];
  return {status:retrieval.status,evidence_id:retrieval.evidence_id??null,products:(retrieval.products??[]).map(p=>pick(p,productKeys)),references:(retrieval.references??[]).map(r=>pick(r,referenceKeys)),source_availability:retrieval.source_availability??[],
    contents:(retrieval.contents??[]).map(c=>pick(c,contentKeys)),images:retrieval.images??[],warnings:[],enrichment_only:true};
}

/** 商品库视图：只带出可追溯字段，去掉内部路径与整库统计的细节。 */
function catalogView(catalog) {
  return {
    status: catalog.status,
    source: catalog.source,
    reason_code: catalog.reason_code,
    hit_kind: catalog.hit_kind,
    db_path_configured: Boolean(catalog.db_path),
    products_total: catalog.products_total ?? null,
    accounting: catalog.accounting,
    scrapes: (catalog.scrapes ?? []).map((item) => ({ candidate_id: item.candidate_id, keyword: item.keyword, ok: item.ok, reason_code: item.reason_code, elapsed_ms: item.elapsed_ms, inserted: item.inserted ?? null, skipped_reason: item.skipped_reason ?? null })),
    results: (catalog.results ?? []).map((entry) => ({
      candidate_id: entry.candidate_id,
      status: entry.status,
      reason_code: entry.reason_code,
      match_basis: entry.match_basis ?? null,
      match_confidence: entry.match_confidence ?? null,
      match_detail: entry.match_detail ?? null,
      product: entry.product
        ? {
            product_id: entry.product.product_id,
            title: entry.product.title,
            page_url: entry.product.page_url,
            image_urls: entry.product.image_urls,
            image_id: entry.product.image_id,
            price_amount: entry.product.price_amount,
            currency: entry.product.currency,
            price_basis: entry.product.price_basis,
            price_observed_at: entry.product.price_observed_at,
            price_conditions: entry.product.price_conditions,
            seller: entry.product.seller,
            source_site: entry.product.source_site,
            shipping: entry.product.shipping,
            evidence_ref: entry.product.evidence_ref,
          }
        : null,
    })),
  };
}
