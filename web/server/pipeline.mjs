import { RetrievalWorker, unavailableProvider } from "./retrieval/worker.mjs";
import { mediaProvider } from "./media/provider.mjs";
const retrievalWorker = new RetrievalWorker(unavailableProvider);
/**
 * 接入层主流程：适配 → （真实/模拟）生成三候选 → 独立规则校验 → 最多一次自动修订 →
 * 等待用户选择 → 选择校验 → 呈现四段 → 呈现复核（含全局修订额度）。
 *
 * 信任边界：本文件里的 request_json、候选、校验结果、repair_count 全部来自服务端；
 * 浏览器提交的 passed / estimated_total / repair_count 等派生字段会在适配层被拒绝。
 */

import { strictParse, dump } from "./jsonstrict.mjs";
import { adaptIntakeObject } from "./intake.mjs";
import { validate, validateRequestOnly, requestIsValid, checkPresentation, error as pushError } from "./checker.mjs";
import { buildMockCandidates, buildMockRevision, buildMockPresentation, buildBrokenModelOutput, buildMockPartialFailure, buildMockStressCandidates, stressifyPresentation } from "./mock-model.mjs";
import { GIFT_STYLE_TABLE, CLOSENESS_TABLE } from "./labels.mjs";
import { requestCandidates, requestPresentation } from "./dify.mjs";
import { createRun, getRun, getRunByRecommendationKey, publicReport } from "./store.mjs";
import { checkAiExclusions } from "./exclusion-checker.mjs";
import { MODE, MOCK_MODE_NOTICE, MOCK_CANDIDATE_NOTICE, MOCK_PRESENTATION_NOTICE, GLOBAL_REPAIR_LIMIT } from "./config.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/* ------------------------------------------------------------ 推荐阶段 */

/**
 * @param {{intake: unknown, demo?: string|null, mode?: string, pursuitReady?: boolean}} input
 */
export async function runRecommendation(input) {
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
  const mode = input.mode === "dify" ? "dify" : "mock";
  const notices = [];
  if (mode === "mock") notices.push(MOCK_MODE_NOTICE);

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
  const key = canonical({ intake: effectiveIntake, exclusion_confirmation: input.exclusion_confirmation || null, mode, demo });
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

  /* 第一次生成 */
  if (demo === "slow") await sleep(45000);
  if (mode === "dify") {
    const call = await requestCandidates(requestJson);
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
  validation = validate(requestJson, candidatesJson, strictParse);
  initialValidation = validation;

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
    const revisedValidation = validate(requestJson, revised.candidates_json, strictParse);
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
      message: "当前状态不允许自动修订，未采用新候选",
    });
  }

  let status = validation.status;
  if (workflowErrors.length > 0 && !["error", "needs_input"].includes(status)) status = "failed";
  const selectable = computeSelectable(validation, workflowErrors);

  const run = createRun({
    mode,
    request_json: requestJson,
    request,
    intake_echo: null,
    initial_candidates_json: initialCandidatesJson,
    initial_validation: initialValidation,
    candidates_json: candidatesJson,
    candidates: (parseJsonOrNull(candidatesJson) || {}).candidates || [],
    validation,
    workflow_errors: workflowErrors,
    repair_count: repairCount,
    status,
    selectable_candidate_ids: selectable,
    notices,
    idempotency_key: key,
  });
  run.retrieval = await retrievalWorker.submit({ category: "home", keywords: [], limit: 3 });
  run.media = mediaProvider.candidates();
  run.call_counts = callCounts;
  run.demo = demo;
  run.initial_candidates = (parseJsonOrNull(initialCandidatesJson) || {}).candidates || [];
  run.initial_candidate_ids = initialValidation.candidate_results.map((r) => r.id);

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
      items: [
        ...(presentation.packaging.materials || []).map((m) => `材料：${m}`),
        ...(presentation.packaging.steps || []).map((s, i) => `步骤 ${i + 1}：${s}`),
      ],
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
    notices: [...run.notices, MOCK_PRESENTATION_NOTICE],
    call_counts: run.call_counts,
    ...extras,
  };
}

/**
 * @param {{runId: string, selectedCandidateId: string|null, demo?: string|null}} input
 */
export async function runPresentation(input) {
  const run = getRun(input.runId);
  if (!run) {
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
  // 幂等：同一选择重复提交返回同一份呈现，不重复消耗修订额度，并显式告知调用方这是重放。
  if (run.selections.has(selectedCandidateId)) {
    const cached = run.selections.get(selectedCandidateId);
    return {
      kind: "presentation",
      run,
      view: { ...cached, idempotent_replay: true },
      idempotent: true,
    };
  }

  const demo = typeof input.demo === "string" ? input.demo : null;
  let presentation = null;
  let generatedBy = "mock";
  if (run.mode === "dify") {
    const call = await requestPresentation(run.request_json, dump(candidate));
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
  } else {
    const built = buildMockPresentation(run.request, candidate, {
      attempt: 1,
      forceOverBudgetFirst: demo === "presentation_over_budget",
    });
    run.call_counts.presentation += 1;
    presentation = run.demo === "stress" || demo === "stress" ? stressifyPresentation(built.presentation) : built.presentation;
  }

  let recheck = checkPresentation(run.request, candidate, presentation);
  let extras = { generated_by: generatedBy };

  if (!recheck.passed) {
    if (run.repair_count >= GLOBAL_REPAIR_LIMIT) {
      extras.repair_note =
        "全局自动修订额度已用完（推荐阶段已使用 1 次），不再开启第二次自动修订；以下为真实验收失败结果。";
      pushError(recheck.errors, "REPAIR_LIMIT_REACHED", "repair_count", "全局自动修订额度已用完，未继续自动修改");
      const view = presentationView(run, candidate, presentation, recheck, extras);
      return { kind: "presentation_failed", run, view };
    }
    // 剩余额度：允许一次呈现修订并重新复核（全局合计仍只有一次）。
    const firstErrors = recheck.errors.map((e) => ({ ...e }));
    const revised = buildMockPresentation(run.request, candidate, { attempt: 2 });
    run.call_counts.presentation_revision += 1;
    const revisedCheck = checkPresentation(run.request, candidate, revised.presentation);
    run.repair_count += 1;
    presentation = revised.presentation;
    recheck = revisedCheck;
    extras = {
      generated_by: generatedBy,
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
  run.media = await mediaProvider.packaging(run, selectedCandidateId);
  run.status = "completed";
  const view = { ...presentationView(run, candidate, presentation, recheck, extras), retrieval: run.retrieval, media: run.media };
  run.selections.set(selectedCandidateId, view);
  return { kind: "presentation", run, view };
}
