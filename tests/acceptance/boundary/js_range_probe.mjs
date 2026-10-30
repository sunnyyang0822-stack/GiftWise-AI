/**
 * QA-001 独立发现：JS 侧 `web/server/checker.mjs` **尚未同步**请求侧数值范围校验。
 *
 * 本探针把与 Python 侧边界套件**完全相同**的输入送进 JS 实现，输出 JSON 供 Python 脚本逐项对照。
 * 它**不修改** `web/**`，只调用其公开导出 `validate`。
 *
 * 运行： node tests/acceptance/boundary/js_range_probe.mjs
 */

import { validate } from "../../../web/server/checker.mjs";
import { strictParse } from "../../../web/server/jsonstrict.mjs";

function request(overrides) {
  return Object.assign(
    {
      recipient_relation: "追求对象",
      recipient_relation_id: "pursuit",
      occasion: "生日",
      budget_amount: "200.00",
      currency: "CNY",
      available_days: 3,
      facts: [{ id: "f1", text: "对方喜欢手冲咖啡" }],
      forbidden_tags: [],
      forbidden_terms: [],
      notes: "希望低调一些",
      closeness: "unknown",
      preference_inferences: [],
      gift_styles: [],
      hard_exclusions_original: { tags: [], terms: [], unresolved: [] },
    },
    overrides,
  );
}

function candidate(cid, name, total, days) {
  return {
    id: cid,
    name,
    description: `${name}：虚构方案说明`,
    estimated_total: total,
    currency: "CNY",
    estimated_preparation_days: days,
    tags: ["other"],
    reason: "匹配用户已确认的偏好与预算上限",
    fact_refs: ["f1"],
    inferences: ["可能偏好实用礼物"],
    unknowns: ["实际价格以商家为准"],
    presentation: "简要呈现",
  };
}

function batch() {
  return {
    candidates: [
      candidate("c1", "手冲咖啡礼盒", "150.00", 1),
      candidate("c2", "陶瓷马克杯", "120.00", 2),
      candidate("c3", "咖啡豆订阅卡", "80.00", 3),
    ],
  };
}

function collectCodes(result) {
  const all = [...(result.errors || [])];
  for (const item of result.candidate_results || []) all.push(...(item.errors || []));
  return [...new Set(all.map((e) => e.code))].sort();
}

function codesAt(result, path) {
  const all = [...(result.errors || [])];
  for (const item of result.candidate_results || []) all.push(...(item.errors || []));
  return [...new Set(all.filter((e) => e.path === path).map((e) => e.code))].sort();
}

const PROBES = [
  ["budget=0（越界，Python 须拒）", { budget_amount: "0" }, null],
  ["budget=0.00（越界，Python 须拒）", { budget_amount: "0.00" }, null],
  ["budget=1（端点，本身不报范围错）", { budget_amount: "1" }, null],
  ["budget=10000（端点，须通过）", { budget_amount: "10000" }, null],
  ["budget=10000.01（越界，Python 须拒）", { budget_amount: "10000.01" }, null],
  ["budget=10001（越界，Python 须拒）", { budget_amount: "10001" }, null],
  ["days=0（端点，本身不报范围错）", { available_days: 0 }, null],
  ["days=365（端点，须通过）", { available_days: 365 }, null],
  ["days=366（越界，Python 须拒）", { available_days: 366 }, null],
  ["days=10**20（越界，Python 须拒）", { available_days: 10 ** 20 }, null],
  ["格式 -1（须 INVALID_AMOUNT）", { budget_amount: "-1" }, null],
  ["格式 01.00（须 INVALID_AMOUNT）", { budget_amount: "01.00" }, null],
  ["候选 20000（只应 OVER_BUDGET）", { budget_amount: "10000" }, { allTotals: "20000" }],
  ["候选 prep=0（须通过）", { available_days: 3 }, { c1prep: 0 }],
];

const rows = [];
for (const [label, reqOver, batchOver] of PROBES) {
  const req = request(reqOver);
  const b = batch();
  if (batchOver && batchOver.allTotals) {
    for (const c of b.candidates) c.estimated_total = batchOver.allTotals;
  }
  if (batchOver && batchOver.c1prep !== undefined) {
    b.candidates[0].estimated_preparation_days = batchOver.c1prep;
  }
  const result = validate(JSON.stringify(req), JSON.stringify(b), strictParse);
  rows.push({
    label,
    request_overrides: reqOver,
    js_status: result.status,
    js_all_passed: result.all_passed,
    js_codes: collectCodes(result),
    js_codes_at_budget_path: codesAt(result, "request.budget_amount"),
    js_codes_at_days_path: codesAt(result, "request.available_days"),
  });
}

process.stdout.write(JSON.stringify({ probe: "js-range-parity", node: process.version, rows }, null, 2) + "\n");
