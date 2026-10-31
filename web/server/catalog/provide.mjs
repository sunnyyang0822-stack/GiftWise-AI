/** Local catalogue and optional domestic retrieval are enrichment, never recommendation gates. */
import { candidateText, matchCandidates } from './match.mjs';
import { buildRetrievalPlan, normalizeRetrievalPlan } from '../retrieval/query-plan.mjs';

// Compatibility export: there is no longer an arbitrary one-scrape business cap.
export const MAX_SCRAPES_PER_REQUEST = null;
export function scrapeKeywordFor(candidate) {
  const explicit = candidate?.keywords?.find(k => typeof k === 'string' && k.trim());
  return { keyword: (explicit?.trim() ?? candidateText(candidate).trim()) || null, theme:null, based_on:{field:explicit ? 'candidate.keywords' : 'candidate.text',value:explicit ?? candidateText(candidate)} };
}
export async function spawnCollect(plan, options = {}) {
  const provider = await import('../retrieval/domestic-provider.mjs');
  if (typeof provider.runDomesticSearch === 'function') return provider.runDomesticSearch(plan, options);
  return new provider.DomesticProvider().search(plan, options);
}
async function boundedSearch(search, plan, options) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort',abort,{once:true});
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { if (controller.signal.aborted) throw new Error('RETRIEVAL_CANCELLED'); return search(plan,{...options,signal:controller.signal}); }),
      new Promise((_,reject) => {
        const fail = () => reject(Object.assign(new Error('RETRIEVAL_CANCELLED'),{code:'RETRIEVAL_CANCELLED'}));
        controller.signal.addEventListener('abort',fail,{once:true});
        if (controller.signal.aborted) fail();
        timer = setTimeout(() => controller.abort(),options.timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort',abort); }
}
export async function provideRealProducts({candidates=[],budgetAmount=null,dbPath,maxItems=3,scrapeEnabled=false,scrapeTimeoutMs=20000,intake,request,context,searchPlan,queries,planImpl,domesticSearch,spawnImpl,signal} = {}) {
  const first = matchCandidates(candidates,{dbPath,budgetAmount,maxItems});
  let finalResult = first;
  const scrapes = [];
  const warnings = [];
  const plan = searchPlan ? normalizeRetrievalPlan(searchPlan) : await buildRetrievalPlan({intake,request,context},{queries,planImpl,signal});
  warnings.push(...(plan.warnings ?? []));
  const unmatched = first.results.some(entry => entry.status !== 'matched');
  if (scrapeEnabled && unmatched && plan.queries.length) {
    const started = Date.now();
    try {
      const outcome = await boundedSearch(domesticSearch ?? spawnImpl ?? spawnCollect,plan,{dbPath,timeoutMs:scrapeTimeoutMs,signal});
      scrapes.push({seq:1,capability:'domestic search plan',query_count:plan.queries.length,elapsed_ms:Date.now()-started,...outcome});
      warnings.push(...(outcome?.warnings ?? []));
      // Collectors persist observations; retain existing bindings when supplementing.
      const existing = first.results.filter(e => e.status === 'matched');
      const second = matchCandidates(candidates.filter(c => !existing.some(e => e.candidate_id === c.id)),{dbPath,budgetAmount,maxItems,excludeProductIds:existing.map(e => e.product.product_id)});
      const merged = first.results.map(e => e.status === 'matched' ? e : (second.results.find(x => x.candidate_id === e.candidate_id) ?? e));
      const hits = merged.filter(e => e.status === 'matched').length;
      finalResult = {...second,results:merged,status:hits === candidates.length ? 'ready' : hits ? 'partial' : 'unavailable',hit_kind:hits ? 'library+fallback' : 'degraded',reason_code:hits ? null : second.reason_code};
    } catch (error) {
      scrapes.push({seq:1,status:'unavailable',error_code:error.code ?? 'DOMESTIC_SEARCH_FAILED',elapsed_ms:Date.now()-started});
      warnings.push('补充检索暂不可用，仍可参考模型建议；具体价格和来源未知');
    }
  }
  const libraryHits = first.results.filter(e => e.status === 'matched').length;
  const finalHits = finalResult.results.filter(e => e.status === 'matched').length;
  return {catalog:{...finalResult,enrichment_only:true,recommendations_available:true,search_plan:plan,warnings,scrapes,coverage:scrapes.flatMap(s => s.coverage ?? []),accounting:{candidates:candidates.length,library_hits:libraryHits,fallback_hits:finalHits-libraryHits,degraded:candidates.length-finalHits,scrape_calls:scrapes.length,scrape_total_elapsed_ms:scrapes.reduce((n,s)=>n+s.elapsed_ms,0),max_scrapes_per_request:null,fallback_skipped_reason:!scrapeEnabled?'SCRAPE_DISABLED':!plan.queries.length?'NO_SPECIFIC_QUERY':!unmatched?'LIBRARY_COVERED':null,scrape_enabled:scrapeEnabled}},scrapes};
}
