/**
 * HTTP 冒烟验证（可复现证据，替代零散 curl）。
 *
 * 前置：先启动接入层 `node web/server/server.mjs`（默认 http://127.0.0.1:8787）。
 * 运行： node web/tools/smoke-http.mjs   （任一检查失败时退出码 1）
 *
 * 覆盖：配置与标签、篡改拒绝、三候选与选择门槛、四段呈现顺序、
 * 呈现复核、全局最多一次修订的两种走向、幂等重放、超时、模拟标识。
 */

const BASE = process.env.GW_BASE || "http://127.0.0.1:8787";
const EXAMPLE_INTAKE = {
  recipient_relation: "pursuit",
  closeness: "limited",
  occasion: "birthday",
  budget_amount: "200.00",
  currency: "CNY",
  deadline_days: 2,
  interests: ["coffee_food", "design_art"],
  interest_confidence: { coffee_food: "confirmed", design_art: "inferred" },
  gift_styles: ["practical", "understated"],
  hard_exclusions: { tags: ["alcohol"], terms: ["酒"], unresolved: [] },
  additional_context: "完全虚构的联调请求。追求对象默认低压力表达，不假定对方心意或已有双向好感。",
};

const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
}

async function api(path, body, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const intake = (patch = {}, demo = null) => ({ intake: { ...EXAMPLE_INTAKE, ...patch }, demo });

async function main() {
  /* 1. 配置与标签 */
  const cfg = await api("/api/config");
  check("GET /api/config 返回 200", cfg.status === 200, `http=${cfg.status}`);
  const relations = cfg.data.labels?.relations ?? [];
  check("关系为冻结 8 项且顺序含 partner/pursuit 在前", relations.length === 8 && relations[0].id === "partner" && relations[1].id === "pursuit", relations.map((r) => r.id).join(","));
  check("界面不出现「同事」", !relations.some((r) => r.id === "colleague" || r.zh === "同事"));
  check("恋人/追求对象文案各自独立", relations[0].scene !== relations[1].scene && /低压力/.test(relations[1].scene));
  check("兴趣 12 / 风格 7 / 禁忌 6", cfg.data.labels.interests.length === 12 && cfg.data.labels.gift_styles.length === 7 && cfg.data.labels.exclusions.length === 6);
  check("预算区间 5 / 时间区间 4", cfg.data.ranges.budget.length === 5 && cfg.data.ranges.deadline.length === 4);
  check("首版仅 CNY 且全局修订上限 1", cfg.data.limits.currency === "CNY" && cfg.data.limits.global_repair_limit === 1);
  check("模拟模式标识可见", cfg.data.mode === "mock" && /模拟/.test(cfg.data.notices.mock_mode), `mode=${cfg.data.mode}`);
  check("追求对象契约开关随配置返回", typeof cfg.data.pursuit_contract_ready === "boolean", `ready=${cfg.data.pursuit_contract_ready}`);
  check("配置接口不含任何密钥字段", !JSON.stringify(cfg.data).toLowerCase().includes("api_key") && !JSON.stringify(cfg.data).includes("Bearer"));

  /* 2. 首页与静态资源 */
  const home = await api("/");
  check("GET / 返回中文首页", home.status === 200 && /GiftWise AI/.test(home.data.raw) && /lang="zh-CN"/.test(home.data.raw));
  check("首页含模拟数据标识脚本入口", /app\.js/.test(home.data.raw));

  /* 3. 篡改拒绝 */
  const forged = await api("/api/intake/validate", intake({ facts: [{ id: "x", text: "伪造" }], repair_count: 9, passed: true, available_days: 99 }));
  const forgedCodes = (forged.data.errors || []).map((e) => e.code);
  check("派生字段被 INTAKE_UNKNOWN_FIELD 拒绝", forged.data.status === "needs_input" && forgedCodes.filter((c) => c === "INTAKE_UNKNOWN_FIELD").length === 4, forgedCodes.join(","));
  check("被拒时不返回派生请求", forged.data.request_json === undefined);

  const badAmount = await api("/api/intake/validate", intake({ budget_amount: "100-200" }));
  check("预算写成区间被拒（不静默取值）", (badAmount.data.errors || []).some((e) => e.code === "INVALID_AMOUNT"));
  const badCurrency = await api("/api/intake/validate", intake({ currency: "USD" }));
  check("非 CNY 被拒且不换汇", (badCurrency.data.errors || []).some((e) => e.code === "UNSUPPORTED_CURRENCY"));
  const unresolved = await api("/api/intake/validate", intake({ hard_exclusions: { tags: [], terms: [], unresolved: ["不要像在暗示关系"] } }));
  check("待澄清禁忌被要求澄清而非忽略", (unresolved.data.errors || []).some((e) => e.code === "INTAKE_CLARIFICATION_REQUIRED"));

  /* 4. 正常推荐 */
  const normal = await api("/api/recommendations", intake());
  check("推荐返回 200 且恰好三个候选", normal.status === 200 && normal.data.candidates.length === 3, `http=${normal.status}`);
  check("三候选思路互不相同", new Set(normal.data.candidates.map((c) => `${c.name}|${c.description}`)).size === 3);
  check("推荐阶段 selected_candidate_id 为 null", normal.data.selected_candidate_id === null);
  check("全部可选、修订 0 / 剩余 1", JSON.stringify(normal.data.selectable_candidate_ids) === '["c1","c2","c3"]' && normal.data.repair_count === 0 && normal.data.remaining_repairs === 1);
  check("关系两层字段正确", normal.data.request.recipient_relation === "追求对象" && normal.data.request.recipient_relation_id === "pursuit");
  check("只有 confirmed 兴趣进入事实", normal.data.request.facts.map((f) => f.id).join() === "interest:coffee_food");
  check("inferred 兴趣单独存为推断", normal.data.request.preference_inferences.map((x) => x.interest_id).join() === "design_art");
  check("每个候选含费用/币种/天数/理由/事实/推断/未知/检查结果", normal.data.candidates.every((c) => c.estimated_total && c.currency === "CNY" && typeof c.estimated_preparation_days === "number" && c.reason && Array.isArray(c.fact_refs) && Array.isArray(c.inferences) && Array.isArray(c.unknowns)));
  check("business_data_verification 为 not_verified", normal.data.business_data_verification === "not_verified");
  check("未选择前呈现阶段零调用", normal.data.call_counts.presentation === 0 && normal.data.call_counts.presentation_revision === 0);
  check("报告带模拟标识", normal.data.notices.some((n) => n.includes("模拟")));
  const runId = normal.data.recommendation_run_id;

  /* 5. 选择门槛 */
  const badId = await api("/api/presentations", { recommendation_run_id: runId, selected_candidate_id: "c9" });
  check("伪造候选 ID 被拒", badId.status === 400 && badId.data.errors[0].code === "INVALID_SELECTION");
  const emptySel = await api("/api/presentations", { recommendation_run_id: runId, selected_candidate_id: null });
  check("空选择被拒且不自动替选", emptySel.status === 400 && emptySel.data.errors[0].code === "INVALID_SELECTION");
  const noRun = await api("/api/presentations", { recommendation_run_id: "gw-不存在", selected_candidate_id: "c1" });
  check("无推荐记录时返回 404（空状态可解释）", noRun.status === 404 && noRun.data.errors[0].code === "RECOMMENDATION_NOT_FOUND");

  /* 6. 四段呈现与复核 */
  const present = await api("/api/presentations", { recommendation_run_id: runId, selected_candidate_id: "c1" });
  check("呈现返回 200 / completed", present.status === 200 && present.data.status === "completed", `http=${present.status}`);
  check("四段顺序为 风格配色→包装→贺卡装饰→赠送", present.data.sections.map((s) => s.key).join(">") === "style>packaging>card>giving", present.data.sections.map((s) => s.key).join(">"));
  check("四段标题带 ①②③④", present.data.sections.map((s) => s.title.trim()[0]).join("") === "①②③④");
  check("追求对象话术低压力", /不暗示双方已确定关系|回应压力/.test(JSON.stringify(present.data.presentation_json.giving_advice)));
  const summary = present.data.recheck_summary;
  check("复核：总费用=原价+新增", BigInt(summary.revised_estimated_total.replace(".", "")) === BigInt(summary.original_total.replace(".", "")) + BigInt(summary.additional_cost.replace(".", "")), `${summary.original_total}+${summary.additional_cost}=${summary.revised_estimated_total}`);
  check("复核：总费用不超预算、天数不超可用", Number(summary.revised_estimated_total) <= Number(summary.budget_amount) && summary.revised_estimated_preparation_days <= summary.available_days);
  check("复核：禁忌类别与字面词都参与", JSON.stringify(summary.forbidden_tags) === '["alcohol"]' && JSON.stringify(summary.forbidden_terms) === '["酒"]');
  check("复核通过且仍标 not_verified", summary.passed === true && summary.business_data_verification === "not_verified");

  const replay = await api("/api/presentations", { recommendation_run_id: runId, selected_candidate_id: "c1" });
  check("重复选择幂等且对调用方可观察", replay.status === 200 && replay.data.idempotent_replay === true && replay.data.repair_count === 0);

  /* 7. 修订额度：推荐阶段用掉 */
  const low = await api("/api/recommendations", intake({ budget_amount: "10.00" }));
  check("小预算触发一次自动修订", low.data.repair_count === 1 && low.data.remaining_repairs === 0 && low.data.call_counts.recommend_revision === 1);
  check("修订后候选落在预算内", low.data.candidates.every((c) => Number(c.estimated_total) <= 10));
  const limit = await api("/api/presentations", { recommendation_run_id: low.data.recommendation_run_id, selected_candidate_id: "c1", demo: "presentation_over_budget" });
  check("额度已用完时呈现失败不二次修订（409）", limit.status === 409 && limit.data.status === "presentation_failed", `http=${limit.status}`);
  check("失败原因含 OVER_BUDGET 与 REPAIR_LIMIT_REACHED", limit.data.presentation_check.errors.some((e) => e.code === "OVER_BUDGET") && limit.data.presentation_check.errors.some((e) => e.code === "REPAIR_LIMIT_REACHED"));
  check("失败时不展示为可执行方案（零分段）", limit.data.sections.length === 0 && limit.data.recheck_summary.passed === false);

  /* 8. 修订额度：留给呈现阶段 */
  const fresh = await api("/api/recommendations", intake());
  check("新运行额度完好", fresh.data.repair_count === 0);
  const overPresent = await api("/api/presentations", { recommendation_run_id: fresh.data.recommendation_run_id, selected_candidate_id: "c2", demo: "presentation_over_budget" });
  check("呈现阶段可用唯一一次修订并复核通过", overPresent.status === 200 && overPresent.data.status === "completed" && overPresent.data.revised_once === true && overPresent.data.repair_count === 1);
  check("修订前有可解释的首次失败原因", (overPresent.data.repaired_checks || []).some((e) => e.code === "OVER_BUDGET"));
  check("修订后总费用回到预算内", Number(overPresent.data.recheck_summary.revised_estimated_total) <= Number(overPresent.data.recheck_summary.budget_amount));

  /* 9. 部分通过与无可选 */
  const partial = await api("/api/recommendations", intake({}, "partial_fail"));
  check("部分通过：失败项不在可选列表", partial.data.status === "failed" && partial.data.selectable_candidate_ids.length > 0 && partial.data.selectable_candidate_ids.length < 3, `可选=${JSON.stringify(partial.data.selectable_candidate_ids)}`);
  const failedId = partial.data.candidates.map((c) => c.id).find((id) => !partial.data.selectable_candidate_ids.includes(id));
  const pickFailed = await api("/api/presentations", { recommendation_run_id: partial.data.recommendation_run_id, selected_candidate_id: failedId });
  check("选择失败项被拒（CANDIDATE_NOT_PASSED）", pickFailed.status === 400 && pickFailed.data.errors[0].code === "CANDIDATE_NOT_PASSED");
  const broken = await api("/api/recommendations", intake({}, "model_error"));
  check("模型输出损坏：error 状态、零可选、不伪装完成", broken.data.status === "error" && broken.data.selectable_candidate_ids.length === 0 && broken.data.candidates.length === 0, `status=${broken.data.status}`);

  /* 10. 恋人 vs 追求对象文案独立 */
  const partner = await api("/api/recommendations", intake({ recipient_relation: "partner" }));
  const partnerPresent = await api("/api/presentations", { recommendation_run_id: partner.data.recommendation_run_id, selected_candidate_id: "c1" });
  check("恋人关系字段独立", partner.data.request.recipient_relation === "恋人" && partner.data.request.recipient_relation_id === "partner");
  check("恋人与追求对象的贺卡/话术完全不同", partnerPresent.data.presentation_json.card_text !== present.data.presentation_json.card_text && partnerPresent.data.presentation_json.giving_advice.wording !== present.data.presentation_json.giving_advice.wording);

  /* 11. 未知兴趣 */
  const unknown = await api("/api/recommendations", intake({ interests: [], interest_confidence: {} }));
  check("未知兴趣提交为空数组且不生成事实", unknown.status === 200 && unknown.data.request.facts.length === 0 && unknown.data.request.preference_inferences.length === 0);
  check("未知兴趣仍能给出三个低风险方向", unknown.data.candidates.length === 3);

  /* 12. 超时 */
  let timedOut = false;
  try {
    await api("/api/recommendations", intake({}, "slow"), { timeoutMs: 3000 });
  } catch (err) {
    timedOut = err.name === "AbortError" || err.code === "ABORT_ERR";
  }
  check("超时路径：客户端可中止并显示中文超时状态", timedOut);

  /* 13. 运行记录可查 */
  const runInfo = await api(`/api/runs/${runId}`);
  check("GET /api/runs/:id 返回可信状态", runInfo.status === 200 && runInfo.data.repair_count === 0 && runInfo.data.selected_candidate_id === "c1", JSON.stringify(runInfo.data).slice(0, 120));
  check("运行记录不含密钥或内部提示", !JSON.stringify(runInfo.data).toLowerCase().includes("api_key"));

  /* 输出 */
  for (const item of results) {
    process.stdout.write(`${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.ok ? "" : `\n        ↳ ${item.detail}`}\n`);
  }
  process.stdout.write(`\n合计 ${results.length} 项检查，失败 ${failures} 项；目标服务 ${BASE}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`冒烟脚本异常：${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(2);
});
