/**
 * 生成 JS↔Python 语义比对用的固定样例（fixtures）。
 *
 * 思路：不在两种语言里各写一遍用例构造逻辑（那本身就是分叉风险），
 * 而是由本脚本产出**字面 JSON 字符串**样例；Python 参考实现与 JS 接入层
 * 各自对这些完全相同的字符串求值，再逐项比对结果。
 *
 * 运行： node web/tools/gen-parity-fixtures.mjs
 * 产物： .tmp/web-parity/fixtures.json（本地产物，不提交）
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { adaptIntakeObject } from "../server/intake.mjs";
import { buildMockCandidates, buildMockRevision } from "../server/mock-model.mjs";
import { strictParse, dump } from "../server/jsonstrict.mjs";
import { validate } from "../server/checker.mjs";
import { INTERESTS } from "../server/labels.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const outDir = join(repoRoot, ".tmp", "web-parity");
mkdirSync(outDir, { recursive: true });

const exampleIntake = JSON.parse(readFileSync(join(repoRoot, "workflow", "examples", "intake.json"), "utf8"));

/* ------------------------------------------------------------ intake 用例 */

const intakeCases = [
  { id: "example-pursuit", intake: exampleIntake },
  {
    id: "partner-恋人",
    intake: { ...exampleIntake, recipient_relation: "partner", additional_context: "恋人生日，可以表达亲密，但不承诺对方反应。" },
  },
  { id: "未知兴趣", intake: { ...exampleIntake, interests: [], interest_confidence: {} } },
  { id: "零天准备", intake: { ...exampleIntake, deadline_days: 0 } },
  {
    id: "全推断兴趣",
    intake: {
      ...exampleIntake,
      interests: ["tech_digital", "sports_outdoors"],
      interest_confidence: { tech_digital: "inferred", sports_outdoors: "inferred" },
    },
  },
  { id: "空禁忌", intake: { ...exampleIntake, hard_exclusions: { tags: [], terms: [], unresolved: [] } } },
  { id: "仅字面词禁忌", intake: { ...exampleIntake, hard_exclusions: { tags: [], terms: ["酒", "香水"], unresolved: [] } } },
  {
    id: "缺失预算",
    intake: { ...exampleIntake, budget_amount: undefined },
  },
  { id: "预算写成区间", intake: { ...exampleIntake, budget_amount: "100-200" } },
  { id: "币种非 CNY", intake: { ...exampleIntake, currency: "USD" } },
  {
    id: "未知置信度",
    intake: { ...exampleIntake, interest_confidence: { coffee_food: "unknown", design_art: "inferred" } },
  },
  {
    id: "待澄清禁忌",
    intake: { ...exampleIntake, hard_exclusions: { tags: ["alcohol"], terms: [], unresolved: ["不要看起来像在暗示关系"] } },
  },
  { id: "关系未知", intake: { ...exampleIntake, recipient_relation: "unknown" } },
  { id: "同事仅技术回归", intake: { ...exampleIntake, recipient_relation: "colleague" } },
  { id: "未知标签", intake: { ...exampleIntake, interests: ["coffee_food", "board_games"] } },
  { id: "重复兴趣", intake: { ...exampleIntake, interests: ["coffee_food", "coffee_food"] } },
  { id: "超长补充说明", intake: { ...exampleIntake, additional_context: "很长".repeat(600) } },
  {
    id: "超限兴趣数组",
    intake: {
      ...exampleIntake,
      interests: [...INTERESTS.map((x) => x.id), ...INTERESTS.slice(0, 9).map((x) => x.id)],
    },
  },
  { id: "置信度多余键", intake: { ...exampleIntake, interest_confidence: { coffee_food: "confirmed", plants_nature: "confirmed" } } },
  { id: "additional_context 为 null", intake: { ...exampleIntake, additional_context: null } },
  { id: "浏览器伪造派生字段", intake: { ...exampleIntake, facts: [{ id: "fake", text: "伪造事实" }], repair_count: 99, passed: true } },
  {
    id: "浮点天数",
    raw: '{"recipient_relation":"pursuit","deadline_days":2.0,"budget_amount":"200.00","currency":"CNY","occasion":"birthday"}',
  },
  {
    id: "重复键原文",
    raw: '{"recipient_relation":"pursuit","recipient_relation":"partner","occasion":"birthday","budget_amount":"200.00","currency":"CNY","deadline_days":2}',
  },
  {
    id: "NaN 常量",
    raw: '{"recipient_relation":"pursuit","deadline_days":NaN,"budget_amount":"200.00","currency":"CNY","occasion":"birthday"}',
  },
  {
    id: "布尔天数",
    raw: '{"recipient_relation":"pursuit","deadline_days":true,"budget_amount":"200.00","currency":"CNY","occasion":"birthday"}',
  },
  { id: "空字符串原文", raw: "" },
  { id: "根节点为数组", raw: '[1,2,3]' },
];

/* ------------------------------------------------------ candidates 用例 */

const readyIntake = adaptIntakeObject(exampleIntake);
if (readyIntake.status !== "ready") throw new Error("示例 intake 应当可适配，实际：" + dump(readyIntake.errors));
const requestJson = readyIntake.request_json;
const request = strictParse(requestJson);

const baseBuilt = buildMockCandidates(request);
const baseBatch = strictParse(baseBuilt.candidates_json);
const baseValidation = validate(requestJson, baseBuilt.candidates_json, strictParse);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function omitUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
function batchWith(mutate) {
  const batch = clone(baseBatch);
  mutate(batch);
  return batch;
}
function centsFrom(amountText) {
  const [int, frac = ""] = String(amountText).split(".");
  return BigInt(int) * 100n + BigInt((frac + "00").slice(0, 2));
}
function textFromCents(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

const candidateBatches = [
  { id: "mock-默认三候选", candidates: baseBatch },
  { id: "边界-刚好等于预算", candidates: batchWith((b) => (b.candidates[0].estimated_total = request.budget_amount)) },
  {
    id: "超预算一分钱",
    candidates: batchWith((b) => (b.candidates[0].estimated_total = textFromCents(centsFrom(request.budget_amount) + 1n))),
  },
  {
    id: "天数等于上限",
    candidates: batchWith((b) => b.candidates.forEach((c) => (c.estimated_preparation_days = request.available_days))),
  },
  { id: "天数超一天", candidates: batchWith((b) => (b.candidates[2].estimated_preparation_days = request.available_days + 1)) },
  { id: "触犯禁忌类别 alcohol", candidates: batchWith((b) => (b.candidates[1].tags = ["alcohol"])) },
  { id: "触犯禁忌类别 food", candidates: batchWith((b) => (b.candidates[0].tags = ["food"])) },
  { id: "文本含字面词酒", candidates: batchWith((b) => (b.candidates[0].description = "搭配一瓶红酒更有氛围。")) },
  {
    id: "名称与描述重复",
    candidates: batchWith((b) => {
      b.candidates[1].name = b.candidates[0].name;
      b.candidates[1].description = b.candidates[0].description;
    }),
  },
  { id: "候选 ID 非法", candidates: batchWith((b) => (b.candidates[2].id = "c4")) },
  { id: "只有两个候选", candidates: batchWith((b) => b.candidates.pop()) },
  { id: "币种不一致", candidates: batchWith((b) => (b.candidates[0].currency = "USD")) },
  { id: "引用不存在事实", candidates: batchWith((b) => (b.candidates[0].fact_refs = ["interest:nonexistent"])) },
  { id: "空 tags", candidates: batchWith((b) => (b.candidates[0].tags = [])) },
  { id: "未知 tag", candidates: batchWith((b) => (b.candidates[0].tags = ["pets"])) },
  { id: "缺字段 unknowns", candidates: batchWith((b) => delete b.candidates[1].unknowns) },
  { id: "金额为浮点", candidates: batchWith((b) => (b.candidates[0].estimated_total = 150.5)) },
  { id: "金额为前导零", candidates: batchWith((b) => (b.candidates[0].estimated_total = "0150.00")) },
  { id: "金额为负", candidates: batchWith((b) => (b.candidates[0].estimated_total = "-10.00")) },
  { id: "天数为布尔", candidates: batchWith((b) => (b.candidates[0].estimated_preparation_days = true)) },
  { id: "空批次", candidates: {} },
  { id: "候选根为数组", candidates: [] },
  {
    id: "修订后批次",
    candidates: strictParse(buildMockRevision(request, baseBatch.candidates, baseValidation).candidates_json),
  },
  {
    id: "全字段超长",
    candidates: batchWith((b) => {
      b.candidates[0].reason = "理".repeat(1200);
      b.candidates[0].unknowns = Array.from({ length: 25 }, () => "未知项");
    }),
  },
];

/* ---------------------------------------- 请求侧越界网格与反向断言（新增） */

/**
 * ⚠️ 历史盲区（本次修正）：此前本文件顶层只有**一个**固定合法的 request_json，
 * 且所有候选批次都复用它（见旧版写出逻辑），因此 `validator/rules.py:131-134`
 * 的**请求侧数值范围校验在 parity 里永远不可能被触发**。
 * 这不是"这次恰好没覆盖"，而是**结构性的**：样例集合本身在设计上就排除了越界请求。
 *
 * 修法：让**请求本身也变化**——显式生成越界网格，并让每个用例携带自己的 request_json，
 * 使 JS 接入层与 Python 参考实现对同一批越界请求**字面量**各自求值后逐项比对。
 */
const requestBase = strictParse(requestJson);

/** 以基准请求为模板替换字段后重新序列化（保持与 intake 产物同形的字面 JSON）。 */
function requestWith(overrides) {
  return dump({ ...requestBase, ...overrides });
}

/** 预算 ∈ {0,1,10000,10000.01,10001} × 天数 ∈ {0,365,366}，共 15 组。 */
const budgetRange = ["0", "1", "10000", "10000.01", "10001"];
const daysRange = [0, 365, 366];
const requestRangeCases = budgetRange.flatMap((budget_amount) =>
  daysRange.map((available_days) => ({
    id: `请求越界-预算${budget_amount}-天数${available_days}`,
    request_json: requestWith({ budget_amount, available_days }),
    candidates_json: dump(baseBatch),
  })),
);

/**
 * 格式优先：当金额或天数的**格式**本身已非法时，共用的 amount()/days() 先失败，
 * 请求侧范围检查必须被**跳过**（不得出现 LIMIT_EXCEEDED）。两个方向各一条。
 */
const requestFormatCases = [
  {
    id: "请求格式优先-金额非法且天数越界",
    request_json: requestWith({ budget_amount: "100-200", available_days: 366 }),
    candidates_json: dump(baseBatch),
  },
  {
    id: "请求格式优先-天数非整数且预算越界",
    request_json: requestWith({ budget_amount: "10001", available_days: 2.5 }),
    candidates_json: dump(baseBatch),
  },
];

/**
 * 反向断言：候选侧的 0 值**不得**被误伤。
 * 若请求侧范围约束被错误地下沉进与候选侧共用的 amount()/days()，
 * 这两条就会冒出 LIMIT_EXCEEDED，而不是像现在这样照常通过。
 */
const reverseAssertCases = [
  {
    id: "反向断言-三候选金额与准备时间全为0",
    candidates: batchWith((b) => {
      b.candidates.forEach((c) => {
        c.estimated_total = "0";
        c.estimated_preparation_days = 0;
      });
    }),
  },
  {
    id: "反向断言-单候选金额为0其余不变",
    candidates: batchWith((b) => {
      b.candidates[0].estimated_total = "0";
      b.candidates[0].estimated_preparation_days = 0;
    }),
  },
];

/* ----------------------------------------------------------- 写出产物 */

const fixtures = {
  generated_by: "web/tools/gen-parity-fixtures.mjs",
  request_json: requestJson,
  intake_cases: intakeCases.map((item) => ({
    id: item.id,
    // undefined 表示「该键不出现」，与 Python 侧缺键语义一致
    intake_json: "raw" in item ? item.raw : dump(omitUndefined(item.intake)),
  })),
  candidate_batches: [...candidateBatches, ...reverseAssertCases].map((item) => ({
    id: item.id,
    request_json: requestJson,
    candidates_json: dump(item.candidates),
  })),
  // 请求侧用例自带 request_json（这是修掉结构性盲区的关键）
  request_cases: [...requestRangeCases, ...requestFormatCases],
  broken_batches: [
    { id: "截断 JSON", request_json: requestJson, candidates_json: '{"candidates":[{"id":"c1","name":"示例",' },
    { id: "非字符串输入", request_json: requestJson, candidates_json: null },
    { id: "重复键候选", request_json: requestJson, candidates_json: '{"candidates":[],"candidates":[]}' },
    { id: "请求为空串", request_json: "", candidates_json: dump(baseBatch) },
  ],
};

const outFile = join(outDir, "fixtures.json");
writeFileSync(outFile, dump(fixtures), "utf8");
process.stdout.write(
  `已写出 ${outFile}\n  intake 用例 ${fixtures.intake_cases.length} 条\n` +
    `  候选批次 ${fixtures.candidate_batches.length} 批 + 请求侧越界/格式 ${fixtures.request_cases.length} 条 + ` +
    `损坏样例 ${fixtures.broken_batches.length} 条\n`,
);
