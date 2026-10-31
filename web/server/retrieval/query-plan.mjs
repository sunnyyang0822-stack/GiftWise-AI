import { readFileSync } from 'node:fs';
import { DOMESTIC_SOURCE_HOSTS } from '../catalog/db.mjs';

const PROMPT = readFileSync(new URL('../../../workflow/prompts/retrieval-plan.md', import.meta.url), 'utf8');
const GENERIC = new Set(['礼物', '礼品', '送人', '生日礼物', '其他', 'unknown']);
const clean = value => typeof value === 'string' ? value.trim() : '';
// Only preference/requirement data are allowed into external search planning. Names and
// authentication fields are never copied, even when nested in the original request.
const FIELDS = ['literal_preferences', 'custom_occasions', 'additional_context', 'previous_gifts', 'occasion_custom', 'occasion', 'occasion_detail', 'occasion_text', 'custom_occasion', 'interests', 'interest_details', 'preferences', 'preference_text', 'likes', 'requirements', 'gift_styles', 'notes', 'extra_notes', 'supplement', 'dislikes', 'forbidden_terms', 'forbidden_tags', 'city', 'budget_amount', 'budget', 'currency'];
function safeValue(value) {
  if (typeof value === 'string') return value.replace(/(?:https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[a-z]+|(?<!\d)1[3-9]\d{9}(?!\d))/gi, '[已省略]');
  if (Array.isArray(value)) return value.map(safeValue).filter(v => typeof v === 'string');
  return typeof value === 'number' ? value : undefined;
}
export function retrievalContext(request = {}) {
  const roots = [request, request.intake, request.request, request.context, request.inputParse, request.input_parse].filter(v => v && typeof v === 'object');
  const out = {};
  const privateValues = roots.flatMap(root => ['name','recipient_name','sender_name','phone','email','address','token','cookie','password'].map(key => root[key])).filter(v => typeof v === 'string' && v.trim());
  const redact = value => typeof value === 'string' ? privateValues.reduce((text,privateValue) => text.split(privateValue).join('[已省略]'), value) : Array.isArray(value) ? value.map(redact) : value;
  for (const root of roots) for (const key of FIELDS) {
    const value = redact(safeValue(root[key]));
    if (value !== undefined) out[key] = value;
  }
  return out;
}
export function normalizeRetrievalPlan(plan = {}) {
  const queries = [];
  const hasDecision = typeof plan.needs_retrieval === 'boolean';
  const decisionReason = clean(plan.decision_reason) || clean(plan.audit?.decision_reason);
  let rejectedQueries = 0;
  if (plan.needs_retrieval === true && Array.isArray(plan.queries)) for (const raw of plan.queries) {
    const keyword = clean(raw?.keyword);
    const sources = [...new Set((Array.isArray(raw?.sources) ? raw.sources : []).filter(id => Object.hasOwn(DOMESTIC_SOURCE_HOSTS, id)))];
    // No implicit source expansion: each query must name the domestic platforms
    // selected by the model. Missing/overseas-only sources make this query unusable.
    if (!keyword || GENERIC.has(keyword.toLowerCase()) || sources.length === 0) { rejectedQueries += 1; continue; }
    const query = {
      keyword, kind: ['physical', 'experience', 'ticket'].includes(raw.kind) ? raw.kind : null,
      city: clean(raw.city) || null, sources,
    };
    if (!queries.some(q => JSON.stringify(q) === JSON.stringify(query))) queries.push(query);
  }
  const needsRetrieval = hasDecision && plan.needs_retrieval && queries.length > 0;
  return {
    category: 'domestic', needs_retrieval: needsRetrieval,
    keywords: [...new Set(queries.map(q => q.keyword))], queries,
    limit: null, coverage: 'requested_accessible',
    audit: {
      decision_reason: decisionReason || null,
      decision_status: !hasDecision ? 'missing_decision' : plan.needs_retrieval && !queries.length ? 'no_executable_query' : 'decided',
      rejected_queries: rejectedQueries,
    },
  };
}
async function modelPlan(context) {
  const { llmProvider, parseModelJson } = await import('../llm/provider.mjs');
  if (!llmProvider.available()) return null;
  const reply = await llmProvider.invoke({kind:'retrieval_plan', messages:[{role:'system',content:PROMPT},{role:'user',content:JSON.stringify(context)}], maxTokens:2048});
  if (!reply.ok) throw new Error(reply.code ?? 'RETRIEVAL_PLAN_FAILED');
  const parsed = parseModelJson(reply.text, {finishReason:reply.finish_reason,usage:reply.usage,maxTokens:2048});
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.value;
}
export async function buildRetrievalPlan(request = {}, { queries, planImpl = modelPlan, signal } = {}) {
  if (request.searchPlan) return {...normalizeRetrievalPlan(request.searchPlan), warnings:[], planned_by:'explicit'};
  if (queries || request.queries || typeof request.needs_retrieval === 'boolean') {
    return {...normalizeRetrievalPlan({...request,queries:queries ?? request.queries}),warnings:[],planned_by:'explicit'};
  }
  const context = retrievalContext(request);
  let planned = null;
  let decisionStatus = signal?.aborted ? 'cancelled' : 'model_unavailable';
  if (!signal?.aborted) {
    try { planned = await planImpl(context, {signal}); }
    catch { decisionStatus = 'model_error'; }
  }
  const normalized = normalizeRetrievalPlan(planned ?? {});
  if (!planned) normalized.audit.decision_status = decisionStatus;
  // Planning failures remain internal audit. No model decision means no outbound
  // retrieval, while recommendation generation can still use the original context.
  return {...normalized,warnings:[],planned_by:planned ? 'model' : 'skipped'};
}
