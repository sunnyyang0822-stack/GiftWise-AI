/**
 * 直连大模型 provider 的命令行（零依赖，只用 node: 内置模块）。
 *
 *   node web/server/llm/cli.mjs status            # 当前模式、配置是否齐备、真实调用计数（不联网）
 *   node web/server/llm/cli.mjs matrix            # 打印模式降级矩阵（不联网）
 *   node web/server/llm/cli.mjs plan              # 打印"两次真实调用"的额度计划（不联网）
 *   node web/server/llm/cli.mjs smoke --live      # 真实调用 #1：最小冒烟，只证明凭证与端点可用
 *   node web/server/llm/cli.mjs recommend --live  # 真实调用 #2：完整链路（用户信息 → 三个方案）
 *
 * 纪律：
 *   - 除 smoke / recommend 且带 --live 之外，任何子命令都不发起网络请求；
 *   - 缺凭证或未带 --live 时**拒绝执行**并说明原因，绝不用假数据冒充结果；
 *   - 任何输出都不打印密钥；真实调用一律写账本（.tmp/llm-calls/ledger.jsonl）。
 *
 * 开发期预算：最多 2 次真实调用（见 docs/architecture/摘除Dify改为直连LLM-2026-10-31.md）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hasLlmConfig, llmConfig, MODE } from "../config.mjs";
import { adaptIntakeObject } from "../intake.mjs";
import { validate } from "../checker.mjs";
import { strictParse } from "../jsonstrict.mjs";
import { llmProvider, parseModelJson } from "./provider.mjs";
import { counterSnapshot, realCallCount, resetCounters } from "./ledger.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const out = (line = "") => process.stdout.write(`${line}\n`);

/** 密钥脱敏展示：只留长度，不留任何字符。 */
const redactKey = (value) => (typeof value === "string" && value.length > 0 ? `<已配置，长度 ${value.length}>` : "<未配置>");
const redactHost = (value) => {
  try {
    return new URL(value).host;
  } catch {
    return value ? "<已配置，但不是合法 URL>" : "<未配置>";
  }
};

function loadCase() {
  const intake = JSON.parse(readFileSync(`${REPO_ROOT}workflow/examples/intake.json`, "utf8"));
  const adapted = adaptIntakeObject(intake);
  if (adapted.status !== "ready") throw new Error(`示例 intake 未通过适配：${JSON.stringify(adapted.errors)}`);
  return { intake, requestJson: adapted.request_json };
}

/**
 * 通用真实调用门禁：缺凭证或未显式 --live 一律拒绝，并打印为什么。
 * @returns {boolean} 是否放行
 */
function gate(args, { budgetIndex, purpose }) {
  if (!args.includes("--live")) {
    out(`拒绝执行：本命令会真实联网并消耗模型额度，必须显式追加 --live。`);
    out(`  这次调用在额度计划里的位置：${budgetIndex}`);
    out(`  目的：${purpose}`);
    out(`开发期预算为最多 2 次真实调用；未授权时一次都不会发生。`);
    return false;
  }
  if (!hasLlmConfig()) {
    const cfg = llmConfig();
    const missing = [
      ["LLM_BASE_URL", cfg.baseUrl],
      ["LLM_API_KEY", cfg.apiKey],
      ["LLM_MODEL", cfg.model],
    ].filter(([, value]) => !value).map(([name]) => name);
    out(`拒绝执行：服务端缺少直连大模型必需环境变量（缺：${missing.join("、")}），未发起任何请求。`);
    out(`  这三个变量只配在服务端进程的环境里，不要写进仓库或前端。`);
    return false;
  }
  return true;
}

function cmdStatus() {
  const cfg = llmConfig();
  const missing = [
    ["LLM_BASE_URL", cfg.baseUrl],
    ["LLM_API_KEY", cfg.apiKey],
    ["LLM_MODEL", cfg.model],
  ].filter(([, value]) => !value).map(([name]) => name);
  out("=== 直连大模型 provider 状态（未联网） ===");
  out(`MODE.current        : ${MODE.current}`);
  out(`配置齐备            : ${hasLlmConfig()}`);
  out(`缺失的环境变量      : ${missing.length === 0 ? "（无）" : missing.join("、")}`);
  out(`接口地址（脱敏）    : ${redactHost(cfg.baseUrl)}`);
  out(`密钥（脱敏）        : ${redactKey(cfg.apiKey)}`);
  out(`模型名              : ${cfg.model || "<未配置>"}`);
  out(`超时 / 重试上限     : ${cfg.timeoutMs}ms / ${cfg.maxRetries} 次（transport 内部硬钳 ≤3）`);
  out(`max_tokens / 温度   : ${cfg.maxTokens} / ${cfg.temperature}`);
  out(`输出格式重试上限    : ${cfg.outputRetries} 次（硬钳 ≤1，不叠加成两次业务修订）`);
  out(`真实调用额度硬闸    : ${cfg.callBudget === null ? "未设置（不限制）" : `${cfg.callBudget} 次（达到即在发请求前拒绝）`}`);
  out(`进程内真实调用      : ${JSON.stringify(counterSnapshot())}`);
  out(`落盘账本真实调用数  : ${realCallCount()}（文件：.tmp/llm-calls/ledger.jsonl）`);
  out("");
  out("提示：账本只统计**真实出站**调用；注入假 fetch 的单元测试与本机假端点自检不入账。");
  return 0;
}

function cmdMatrix() {
  out("模式降级矩阵（mode 是报告给客户端的取值，不撒谎）：");
  out("");
  out("  条件                                   mode    是否联网  说明");
  out("  GW_MODE 未设 + 无直连凭证              mock    否        内置固定模拟数据，界面显著标注");
  out("  GW_MODE 未设 + 有直连凭证              llm     是        直接调用模型接口，失败即如实报错");
  out("  GW_MODE=llm  + 无直连凭证              mock    否        回落到 mock，mode 如实标成 mock 并附说明");
  out("  GW_MODE=mock                           mock    否        强制模拟");
  out("  GW_MODE=dify                           dify    是        历史对照路径（需 Dify 凭证+发布确认），永不是默认");
  out("  GW_MODE=<其它值>                       mock    否        未知模式一律按 mock，绝不当成真实调用");
  out("  llm 模式下模型超时 / HTTP 错 / 输出不合法        是→失败   返回明确错误码，不用模拟数据顶替");
  out("");
  out(`当前环境解析结果：mode=${MODE.current}，配置齐备=${hasLlmConfig()}`);
  return 0;
}

function cmdPlan() {
  out("=== 真实调用额度计划（开发期最多 2 次） ===");
  out("");
  out("  #1  smoke --live      目的：证明凭证与端点可用（不是格式或质量验证）");
  out("      花在哪：一次 /chat/completions，max_tokens 极小，单轮无上下文");
  out("      预期拿到：一句非空回复 + HTTP 状态 + usage（token 数）；失败则拿到明确错误码与 HTTP 状态");
  out("      预计消耗：数百 input token + 数个 output token（最小量）");
  out("");
  out("  #2  recommend --live  目的：完整链路取证（用户信息 → 三个方案）");
  out("      花在哪：一次 /chat/completions，喂 workflow/examples/intake.json 的虚构 intake，要求输出三个候选");
  out("      预期拿到：candidates_json（严格 JSON、3 项），再用独立 checker 复核是否通过");
  out("      预计消耗：约 4–6k input token（提示词 + 冻结请求）+ 推理+答案 token 若干（估值随模型而定）");
  out("      ⚠ 该供应商是推理模型：输出上限默认 8192，超时默认 120s；给 20s 会把正常调用误判成超时。");
  out("      ⚠ 输出格式不合法时最多再试 1 次（LLM_OUTPUT_RETRIES，硬钳 ≤1）；");
  out("         想严格只花 1 次，用 LLM_CALL_BUDGET=1 —— 那是代码强制的硬闸，不是靠自觉。");
  out("");
  out("  不含在计划内（明确不做）：呈现阶段真调、排除项识别真调、任何重试以外的追加调用。");
  out("  预算口径：上述 2 次是**整个开发期**上限；每次调用都会写进账本，可用 status 核对。");
  out("");
  out(`当前已发生真实调用（账本）：${realCallCount()} 次`);
  return 0;
}

async function cmdSmoke(args) {
  if (!gate(args, { budgetIndex: "真实调用 #1（最小冒烟）", purpose: "证明凭证与端点可用" })) return 2;
  const cfg = llmConfig();
  resetCounters();
  out("开始真实调用 #1（最小冒烟）…");
  out(`说明：本供应商是推理模型，输出上限给 ${Math.min(cfg.maxTokens, 1024)}（不是 16）——`);
  out("      给太小会让推理 token 吃光输出、content 变成空串，从而把「可用」误判成「失败」。");
  const reply = await llmProvider.invoke({
    kind: "smoke",
    messages: [
      { role: "system", content: "你只需回复两个字符：OK" },
      { role: "user", content: "连通性检查" },
    ],
    maxTokens: Math.min(cfg.maxTokens, 1024),
  });
  out(`结果：${reply.ok ? "成功" : `失败 ${reply.code}`}`);
  out(`HTTP 状态：${reply.ok ? reply.http_status : reply.status ?? "-"}`);
  out(`尝试次数：${reply.attempts ?? "-"}   耗时：${reply.elapsed_ms ?? "-"}ms`);
  out(`finish_reason：${reply.ok ? reply.finish_reason ?? "(未提供)" : "-"}（length 表示被输出上限截断，不是接口坏）`);
  out(`模型回显名：${reply.ok ? reply.model ?? "(未提供)" : "-"}`);
  out(`usage：${JSON.stringify(reply.ok ? reply.usage : null)}`);
  out(`回复正文长度：${reply.ok ? [...reply.text].length : 0} 码点（不打印正文全文，避免夹带意外内容）`);
  out(`本次进程内真实调用计数：${JSON.stringify(counterSnapshot())}`);
  out(`落盘账本真实调用总数：${realCallCount()}`);
  return reply.ok ? 0 : 1;
}

async function cmdRecommend(args) {
  if (!gate(args, { budgetIndex: "真实调用 #2（完整链路）", purpose: "用户信息 → 三个方案" })) return 2;
  const { intake, requestJson } = loadCase();
  resetCounters();
  out("开始真实调用 #2（完整链路：用户信息 → 三个方案）…");
  const call = await llmProvider.requestCandidates({ requestJson, intakeJson: JSON.stringify(intake), retrieval: null });
  out(`结果：${call.ok ? "成功" : `失败 ${call.code}`}`);
  if (!call.ok) {
    out(`  错误码：${call.code}  尝试次数：${call.attempts ?? "-"}  HTTP 状态：${call.status ?? "-"}`);
    out(`  未生成任何候选，也没有用模拟数据顶替。`);
    out(`落盘账本真实调用总数：${realCallCount()}`);
    return 1;
  }
  out(`HTTP 状态：${call.http_status ?? "-"}   尝试次数：${call.attempts ?? "-"}   输出格式重试：${call.output_attempts ?? "-"}`);
  out(`耗时：${call.elapsed_ms ?? "-"}ms   finish_reason：${call.finish_reason ?? "(未提供)"}`);
  out(`usage：${JSON.stringify(call.usage)}`);
  const parsed = parseModelJson(call.outputs.candidates_json, { requireKey: "candidates" });
  if (!parsed.ok) {
    out(`输出不合法：${parsed.code} ${parsed.reason}`);
    return 1;
  }
  out(`候选数量：${parsed.value.candidates.length}  id：${parsed.value.candidates.map((c) => c.id).join(",")}`);
  for (const candidate of parsed.value.candidates) {
    out(`  - ${candidate.id} ${candidate.name} ${candidate.estimated_total} ${candidate.currency} ${candidate.estimated_preparation_days}天`);
  }
  const validation = validate(requestJson, call.outputs.candidates_json, strictParse);
  out(`独立 checker 复核：all_passed=${validation.all_passed}，逐项=${JSON.stringify(validation.candidate_results.map((r) => ({ id: r.id, passed: r.passed, errors: r.errors.map((e) => e.code) })))}`);
  out(`落盘账本真实调用总数：${realCallCount()}`);
  return 0;
}

const [, , command = "status", ...args] = process.argv;

const commands = {
  status: cmdStatus,
  matrix: cmdMatrix,
  plan: cmdPlan,
  smoke: () => cmdSmoke(args),
  recommend: () => cmdRecommend(args),
};

const handler = commands[command];
if (!handler) {
  out(`未知子命令：${command}`);
  out(`可用：${Object.keys(commands).join(" / ")}`);
  process.exitCode = 2;
} else {
  const code = await handler();
  if (typeof code === "number") process.exitCode = code;
}
