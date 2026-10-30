/**
 * JS↔Python 语义比对（任务号 WEB-WF-001 的「适配有实际测试」证据）。
 *
 * 前置（两步，都在仓库根执行）：
 *   1. node web/tools/gen-parity-fixtures.mjs   → .tmp/web-parity/fixtures.json
 *   2. python web/tools/parity-reference.py     → .tmp/web-parity/python-out.json
 * 本脚本对同一批**字面 JSON 字符串**跑 JS 接入层实现，再与 Python 参考结果逐项比对。
 *
 * 运行： node web/tools/parity-check.mjs   （发现差异时退出码 1）
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { adaptIntake } from "../server/intake.mjs";
import { validate } from "../server/checker.mjs";
import { strictParse, dump } from "../server/jsonstrict.mjs";
import { PURSUIT_CONTRACT_READY } from "../server/config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const workDir = join(repoRoot, ".tmp", "web-parity");

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

function load(name) {
  const path = join(workDir, name);
  try {
    // 样例文件本身不受契约的 32768 字节限制限制（那是 intake/request 的业务上限）
    return strictParse(readFileSync(path, "utf8"), 32 * 1024 * 1024);
  } catch (err) {
    process.stderr.write(`读取 ${path} 失败：${String(err.message)}\n请先运行 gen-parity-fixtures.mjs 与 parity-reference.py\n`);
    process.exit(2);
  }
}

const fixtures = load("fixtures.json");
const reference = load("python-out.json");
const mismatches = [];
const orderingOnly = [];
let compared = 0;

/**
 * Python 参考实现的「未声明字段」错误来自集合差运算（`data.keys() - fields`），
 * 实测同一输入在 PYTHONHASHSEED=0/1/2 下顺序各不相同（见报告），因此顺序不参与判定；
 * 但**集合必须完全一致**：错误码、路径、中文文案与 request_json 逐字节相等。
 */
function sortErrors(list) {
  return [...(list || [])].map((e) => `${e.code}|${e.path}|${e.message}`).sort();
}

/* ------------------------------------------------------------ intake 比对 */

const referenceIntake = new Map(reference.intake_results.map((r) => [r.id, r]));
for (const caseItem of fixtures.intake_cases) {
  const py = referenceIntake.get(caseItem.id);
  if (!py) {
    mismatches.push({ kind: "intake", id: caseItem.id, detail: "Python 侧缺少该用例结果" });
    continue;
  }
  compared += 1;
  const js = adaptIntake(caseItem.intake_json); // 与 Python 收到完全相同的字符串
  const a = { status: js.status, errors: js.errors, request_json: js.request_json };
  const b = { status: py.status, errors: py.errors, request_json: py.request_json };
  if (canonical(a) !== canonical(b)) {
    const aNorm = { status: a.status, errors: sortErrors(a.errors), request_json: a.request_json };
    const bNorm = { status: b.status, errors: sortErrors(b.errors), request_json: b.request_json };
    if (canonical(aNorm) === canonical(bNorm)) {
      orderingOnly.push({ kind: "intake", id: caseItem.id });
    } else {
      mismatches.push({
        kind: "intake",
        id: caseItem.id,
        detail:
          `JS=${a.status} / PY=${b.status}\n    JS errors: ${dump(a.errors)}\n    PY errors: ${dump(b.errors)}\n` +
          `    request_json 相同：${a.request_json === b.request_json}`,
      });
    }
  }
}

/* ------------------------------------------------- candidates 校验比对 */

const referenceValidate = new Map(reference.validation_results.map((r) => [r.id, r]));
for (const batch of [...fixtures.candidate_batches, ...(fixtures.broken_batches || [])]) {
  const py = referenceValidate.get(batch.id);
  if (!py) {
    mismatches.push({ kind: "validation", id: batch.id, detail: "Python 侧缺少该批次结果" });
    continue;
  }
  compared += 1;
  const js = validate(batch.request_json, batch.candidates_json, strictParse);
  const a = {
    status: js.status,
    all_passed: js.all_passed,
    errors: js.errors,
    candidate_results: js.candidate_results.map((r) => ({ id: r.id, passed: r.passed, errors: r.errors })),
    business_data_verification: js.business_data_verification,
  };
  const b = {
    status: py.status,
    all_passed: py.all_passed,
    errors: py.errors,
    candidate_results: py.candidate_results,
    business_data_verification: py.business_data_verification,
  };
  if (canonical(a) !== canonical(b)) {
    const normalize = (side) => ({
      status: side.status,
      all_passed: side.all_passed,
      errors: sortErrors(side.errors),
      candidate_results: side.candidate_results.map((r) => ({ id: r.id, passed: r.passed, errors: sortErrors(r.errors) })),
      business_data_verification: side.business_data_verification,
    });
    if (canonical(normalize(a)) === canonical(normalize(b))) {
      orderingOnly.push({ kind: "validation", id: batch.id });
    } else {
      mismatches.push({
        kind: "validation",
        id: batch.id,
        detail:
          `JS=${a.status}/${a.all_passed} vs PY=${b.status}/${b.all_passed}\n    JS: ${dump(a.errors)}\n    PY: ${dump(b.errors)}\n` +
          `    候选结果：JS ${dump(a.candidate_results.map((r) => [r.id, r.passed, r.errors.map((e) => e.code)]))}\n` +
          `             PY ${dump(b.candidate_results.map((r) => [r.id, r.passed, r.errors.map((e) => e.code)]))}`,
      });
    }
  }
}

/* -------------------------------------------------------------- 报告 */

process.stdout.write(
  `JS↔Python 语义比对：共 ${compared} 组样例（intake ${fixtures.intake_cases.length} 条 / 校验批次 ` +
    `${fixtures.candidate_batches.length + (fixtures.broken_batches || []).length} 条）\n` +
    `参考实现：${reference.reference}（Python ${reference.python_version}）\n` +
    `追求对象契约开关：PURSUIT_CONTRACT_READY=${PURSUIT_CONTRACT_READY}\n`,
);

if (mismatches.length === 0) {
  process.stdout.write(`结果：全部一致（0 处语义差异）\n`);
  if (orderingOnly.length > 0) {
    process.stdout.write(
      `  其中 ${orderingOnly.length} 组仅错误顺序不同（Python 侧集合迭代顺序随哈希种子变化，` +
        `错误码/路径/文案/请求完全一致）：${orderingOnly.map((o) => `[${o.kind}] ${o.id}`).join("、")}\n`,
    );
  }
} else {
  process.stdout.write(`结果：发现 ${mismatches.length} 处差异\n`);
  for (const item of mismatches) process.stdout.write(`  · [${item.kind}] ${item.id}\n    ${item.detail}\n`);
  process.exit(1);
}

/* ---------------------------- 附加：契约开关关闭时的行为（本层新增，不与 Python 比对） */

const exampleText = readFileSync(join(repoRoot, "workflow", "examples", "intake.json"), "utf8");
const gateOff = adaptIntake(JSON.stringify(JSON.parse(exampleText)), { pursuitReady: false });
const codes = gateOff.errors.map((e) => e.code);
const rejectedWithoutRewrite = gateOff.status === "needs_input" && gateOff.request_json === null;
process.stdout.write(
  `\n附加检查（把契约开关当作未落地）：错误码 ${codes.join("、") || "无"}；未生成请求：${rejectedWithoutRewrite}\n`,
);
if (!codes.includes("PURSUIT_CONTRACT_NOT_READY") || !rejectedWithoutRewrite) {
  process.stdout.write("附加检查失败：契约未落地时必须明确拒绝，且不得改写关系或静默映射。\n");
  process.exit(1);
}
process.stdout.write("附加检查：通过（拒绝且不静默映射）\n");
