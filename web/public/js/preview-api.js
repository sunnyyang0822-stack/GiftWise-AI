import config from "./preview-config.js";

// 本阶段仅本地预览。同版本后端接入时由联调线替换适配层；不能通过地址参数开启旧API。
export const PREVIEW_MODE = true;
export const previewConfig = config;
let scenario = new URLSearchParams(globalThis.location?.search || "").get("preview") || "normal";
let failed = false;
let sequence = 0;
const runs = new Map();
const analyses = new Map();
export const previewScenarios = [
  ["normal", "正常流程"], ["loading", "延长加载"], ["error", "推荐失败后重试"],
  ["empty", "没有方案"], ["blocked", "方案未通过"],
  ["analyze_error", "识别失败"], ["presentation_error", "账单失败后重试"],
];
export function setPreviewScenario(value) { scenario = value; failed = false; }
const reply = (data, status = 200) => ({ ok: status < 400, status, data });
const issue = (message, code = "PREVIEW_ERROR") => ({ status: "error", errors: [{ code, message }] });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const cents = value => Math.round(Number(value) * 100);

export async function previewRequest(path, payload) {
  if (path === "/api/intake/validate") return reply({ status: "ready", errors: [] });
  await pause(scenario === "loading" ? 3000 : 900);
  if (!failed && ((scenario === "error" && path === "/api/recommendations") ||
    (scenario === "analyze_error" && path === "/api/exclusions/analyze") ||
    (scenario === "presentation_error" && path === "/api/presentations"))) {
    failed = true;
    return reply(issue("这次没有完成，请重试。已填内容会保留。"), 503);
  }
  if (path === "/api/exclusions/analyze") {
    const intake = payload.intake;
    const source = intake.dislikes;
    // 固定的虚构夹具只覆盖这句示例，其余表达要求澄清，不能冒充语义识别。
    if (source.trim() !== "不要香水") return reply({ status: "needs_input", mode: "mock", analysis_id: null, candidates: [], errors: [{ code: "INTAKE_CLARIFICATION_REQUIRED", message: "预览示例暂不能理解这段限制，请使用“不要香水”或修改后重试。" }] });
    const id = `preview-analysis-${++sequence}`;
    const candidates = [{ id: "xc1", kind: "tag", tag: "fragrance", term: null, source_span: "不要香水", confidence: "high", why: "示例原文明确排除香水。", evidence: "user_text" }];
    analyses.set(id, JSON.stringify(intake));
    return reply({ status: "needs_confirmation", mode: "mock", analysis_id: id, candidates, errors: [] });
  }
  if (path === "/api/recommendations") {
    const f = payload.intake;
    if (f.dislikes && (analyses.get(payload.exclusion_confirmation?.analysis_id) !== JSON.stringify(f) ||
      JSON.stringify(payload.exclusion_confirmation?.confirmed_ids) !== '["xc1"]')) {
      return reply(issue("限制内容已变化，请重新识别并确认。", "EXCLUSION_ANALYSIS_STALE"), 422);
    }
    const relation = f.recipient_relation_custom || config.labels.relations.find(x => x.id === f.recipient_relation)?.zh;
    const occasion = f.occasion_custom || config.labels.occasions.find(x => x.id === f.occasion)?.zh;
    const request = { recipient_relation: relation, occasion, budget_range: f.budget_range, budget_amount: f.budget_range.max,
      currency: "CNY", available_days: f.deadline_days, facts: [{ id: "f1", text: `为${relation}准备${occasion}礼物。` }], preference_inferences: [] };
    const noSpend = f.budget_mode === "zero";
    const directions = noSpend ? [
      ["一封手写信", "把共同经历写下来", "文字表达", "已有纸笔能否使用"],
      ["一起散步的约定", "留出一段专属相处时间", "共同体验", "双方空闲时间"],
      ["已有照片的小回忆册", "整理已有的相处片段", "回忆整理", "照片授权与已有材料"],
    ] : [
      ["日常手感笔记本", "把祝福放进日常使用的小物里", "实用陪伴", "纸张偏好与现有文具"],
      ["一起体验的手作课", "把礼物变成一段共同经历", "共同体验", "活动名额、时间与实际报价"],
      ["一份定制主题画作", "围绕一段共同记忆，留下一份纪念", "个人纪念", "对方的审美与制作条件"],
    ];
    const candidates = directions.map(([name, description, direction, unknown], i) => ({ id: `preview-c${i + 1}`, name, description,
      reason: `${direction}的示例方向，供你比较表达方式。`, fact_refs: ["f1"], inferences: ["这类表达可能适合当前场合，仍需你判断。"],
      unknowns: [unknown, "价格、库存、实际准备条件未核实。"], estimated_total: noSpend ? "0.00" : ["80.00", "150.00", "220.00"][i],
      currency: "CNY", estimated_preparation_days: [1, 3, 5][i] }));
    const results = candidates.map(c => {
      const errors = [];
      if (cents(c.estimated_total) > cents(f.budget_range.max)) errors.push({ code: "OVER_BUDGET", message: "示例估价高于预算上限。" });
      if (c.estimated_preparation_days > f.deadline_days) errors.push({ code: "PREPARATION_TOO_LONG", message: "示例准备时间超过可用天数。" });
      if (scenario === "blocked") errors.push({ code: "PREVIEW_BLOCKED", message: "预览：该方案未通过检查。" });
      return { id: c.id, passed: errors.length === 0, errors, warnings: cents(c.estimated_total) < cents(f.budget_range.min) ? [{ code: "BELOW_BUDGET_RANGE", message: "示例估价低于预算下限，仍可选择。" }] : [] };
    });
    const id = `preview-run-${++sequence}`;
    const report = { contract_version: config.contract_version, recommendation_run_id: id, mode: "mock", status: results.every(r => r.passed) ? "passed" : "failed",
      request, candidates: scenario === "empty" ? [] : candidates, validation: { errors: [], candidate_results: results },
      selectable_candidate_ids: scenario === "empty" ? [] : results.filter(r => r.passed).map(r => r.id),
      selected_candidate_id: null, repair_count: 0, remaining_repairs: 1, business_data_verification: "not_verified" };
    runs.set(id, report);
    return reply(report);
  }
  if (path === "/api/presentations") {
    const run = runs.get(payload.recommendation_run_id);
    const candidate = run?.candidates.find(c => c.id === payload.selected_candidate_id);
    if (!candidate || !run.selectable_candidate_ids.includes(candidate.id)) return reply(issue("请先选择一个通过检查的方案。", "INVALID_SELECTION"), 422);
    return reply({ contract_version: config.contract_version, recommendation_run_id: run.recommendation_run_id,
      selected_candidate_id: candidate.id, candidate, status: "completed", mode: "mock", generated_by: "mock", repair_count: 0, remaining_repairs: 1,
      presentation_check: { passed: true, errors: [] },
      sections: [
        { title: "① 包装风格", items: ["简洁、克制，突出礼物本身；这是本地预览示例。"] },
        { title: "② 配色", items: ["暖白与深红，作为风格参考。"] },
        { title: "③ 贺卡", items: ["愿这份小小的心意，给你的日常多添一点快乐。"] },
        { title: "④ 赠送方式", items: ["在彼此方便的时机自然递出，不催促回应。"] },
      ],
      recheck_summary: { contract_version: config.contract_version, gift_estimated_total: candidate.estimated_total,
        budget_range: run.request.budget_range, budget_amount: run.request.budget_amount, currency: "CNY", available_days: run.request.available_days,
        revised_estimated_preparation_days: candidate.estimated_preparation_days, passed: true, business_data_verification: "not_verified" },
    });
  }
  return reply(issue("预览路径暂不可用。"), 404);
}
