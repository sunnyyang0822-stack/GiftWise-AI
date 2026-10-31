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
    return null;
  }
  return run;
}

function prune() {
  if (runs.size <= RUN_LIMIT) return;
  const ordered = [...runs.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  for (const run of ordered.slice(0, runs.size - RUN_LIMIT)) runs.delete(run.run_id);
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
    limits: { currency: "CNY", note: "费用与准备时间仅为估算；未核实真实价格、库存或实际送达。" },
  };
}
