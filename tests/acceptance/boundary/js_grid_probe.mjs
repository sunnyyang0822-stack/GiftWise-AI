/**
 * QA-001 JS 侧批量回放器：从 stdin 读取用例表，逐条调用 JS `validate`，把结果以 JSON 回给 Python。
 *
 * 用例表由 Python 侧生成（单一事实来源），因此两侧**输入逐字节相同**，避免"两边各写一份用例"造成的伪对照。
 * 只调用 `web/server/checker.mjs` 的公开导出，**不修改 web/**。
 *
 * 输入： stdin JSON  { "cases": [ { "label": str, "request": str, "candidates": str }, ... ] }
 * 输出： stdout JSON { "node": str, "results": [ { "label", "status", "all_passed", "codes",
 *                                                  "codes_deep", "parse_only" }, ... ] }
 */

import { validate } from "../../../web/server/checker.mjs";
import { strictParse } from "../../../web/server/jsonstrict.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));

function collect(result) {
  const all = [...(result.errors || [])];
  for (const item of result.candidate_results || []) all.push(...(item.errors || []));
  return all;
}

const results = [];
for (const item of input.cases) {
  let result;
  try {
    result = validate(item.request, item.candidates, strictParse);
  } catch (err) {
    result = {
      status: "threw",
      all_passed: false,
      errors: [{ code: "JS_THREW", path: "$", message: String(err && err.message) }],
      candidate_results: [],
    };
  }
  const all = collect(result);
  results.push({
    label: item.label,
    status: result.status,
    all_passed: result.all_passed,
    codes: [...new Set(all.map((e) => e.code))].sort(),
    codes_deep: [...new Set(all.map((e) => `${e.code}@${e.path}`))].sort(),
    candidate_passed: (result.candidate_results || []).map((c) => c.passed),
  });
}

process.stdout.write(JSON.stringify({ node: process.version, results }, null, 2) + "\n");
