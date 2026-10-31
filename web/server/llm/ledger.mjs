/**
 * 真实调用账本：每一次**真实**（联网）大模型调用追加一行 JSONL。
 *
 * 为什么单独记账：本任务要求「真实调用只在验收那一次发生，并且要计数」。
 * 账本落在 .tmp/ 下（.gitignore:15 已忽略 .tmp/），不进仓库、不进报告附件。
 *
 * 只记结构性信息：时间、用途、模型、主机名、HTTP 状态、耗时、attempts、token 用量。
 * **不记**密钥、完整提示词、请求体或响应正文。
 *
 * 记账口径：只有**没有被注入 fetch 的**默认 transport 才算真实调用；
 * 注入假 fetch 的（单元测试、本机假端点自检）由 provider 侧跳过，不写账本也不计数。
 *
 * ── 2026-10-31 缺陷修复：账本路径隔离（必修 2）────────────────────────────
 * 事故：独立验收时真实账本 `.tmp/llm-calls/ledger.jsonl`（15 行）被**跑全量测试**清空，
 * 因为 `web/tests/llm-provider.test.mjs` 的 `resetLedger()` 作用在**默认路径**上，
 * 而账本是「真的调了模型」的唯一硬证据 ⇒ 证据被测试销毁。
 *
 * 现在有两道代码级闸门，任何人（含测试）都不可能再误删真实账本：
 *   1. **测试进程自动改道**：`node:test` 子进程带 `NODE_TEST_CONTEXT` ⇒ 账本自动落到
 *      `test-ledger-<pid>.jsonl`，测试的增删读写一律与真实账本无关（也可用
 *      `GW_LLM_TEST_MODE=1` 手动声明测试态）；
 *   2. **resetLedger 默认拒绝对真实账本执行**：只有显式 `GW_LLM_LEDGER_ALLOW_REAL_RESET=1`
 *      或 `resetLedger({force:true})` 才允许，且返回值会如实说明被拒绝的原因。
 * 路径改为**惰性解析**，因此「先 import 模块、再设 GW_LLM_LEDGER_FILE」同样生效
 *（原来的模块级常量在 import 时就定死了，测试根本来不及改道）。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LEDGER_DIR = fileURLToPath(new URL("../../../.tmp/llm-calls/", import.meta.url));

/** 仓库**真实**账本（举证材料）。默认路径由本文件唯一决定。 */
export const DEFAULT_LEDGER_FILE = `${LEDGER_DIR}ledger.jsonl`;

/** 测试进程专用账本：每个测试进程一份，跑完即丢，与真实账本互不影响。 */
export const TEST_LEDGER_FILE = `${LEDGER_DIR}test-ledger-${process.pid}.jsonl`;

/** 是否处于测试运行态（node:test 子进程会带 NODE_TEST_CONTEXT）。 */
export function isTestRunner() {
  return Boolean(String(process.env.NODE_TEST_CONTEXT || "").trim()) || String(process.env.GW_LLM_TEST_MODE || "").trim() === "1";
}

/**
 * 账本路径的**唯一解析点**（惰性求值）。
 * 优先级：GW_LLM_LEDGER_FILE（显式指定，测试/自检用）> 测试态临时账本 > 真实账本。
 */
export function ledgerFile() {
  const configured = String(process.env.GW_LLM_LEDGER_FILE || "").trim();
  if (configured) return resolve(configured);
  if (isTestRunner()) return TEST_LEDGER_FILE;
  return DEFAULT_LEDGER_FILE;
}

/** 该路径是否就是仓库真实账本（用于拒绝破坏性操作与报告展示）。 */
export function isRealLedger(file = ledgerFile()) {
  return resolve(String(file)) === resolve(DEFAULT_LEDGER_FILE);
}

/** 内存计数：进程内真实调用次数（HTTP 请求次数，含重试）。 */
const counters = { calls: 0, attempts: 0, byKind: Object.create(null) };

export function recordRealCall(entry) {
  counters.calls += 1;
  counters.attempts += Number.isFinite(entry?.attempts) ? entry.attempts : 1;
  const kind = String(entry?.kind || "unknown");
  counters.byKind[kind] = (counters.byKind[kind] || 0) + 1;
  const line = {
    at: new Date().toISOString(),
    kind,
    model: entry?.model ?? null,
    base_url_host: entry?.base_url_host ?? null,
    http_status: entry?.http_status ?? null,
    outcome: entry?.outcome ?? (entry?.ok ? "ok" : "failed"),
    code: entry?.code ?? null,
    attempts: entry?.attempts ?? 1,
    elapsed_ms: entry?.elapsed_ms ?? null,
    // 必修 3：截断类故障必须能从账本一眼看出 finish_reason / usage（不只看响应）。
    finish_reason: entry?.finish_reason ?? null,
    max_tokens: entry?.max_tokens ?? null,
    usage: entry?.usage ?? null,
  };
  try {
    const file = ledgerFile();
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // 账本写不进去不改变业务结果，但进程内计数仍准确。
  }
  return line;
}

/** 进程内计数快照。 */
export function counterSnapshot() {
  return { calls: counters.calls, attempts: counters.attempts, by_kind: { ...counters.byKind } };
}

export function resetCounters() {
  counters.calls = 0;
  counters.attempts = 0;
  for (const key of Object.keys(counters.byKind)) delete counters.byKind[key];
}

/** 读取落盘账本（用于报告与 CLI）；文件不存在返回空数组。 */
export function readLedger() {
  const file = ledgerFile();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { at: null, kind: "unparsable", outcome: "unparsable" };
      }
    });
}

/** 落盘账本里的真实调用条数。 */
export function realCallCount() {
  return readLedger().filter((row) => row && row.outcome !== "unparsable").length;
}

/**
 * ⚠ 清空账本。**只给测试与人工验收使用**，故意不挂到任何 CLI 子命令上：
 * 账本是「真实调用次数」的举证材料，随手清空等于销毁证据。
 *
 * 硬闸：目标就是仓库真实账本时**默认拒绝**（返回 `LEDGER_RESET_REFUSED`，不删任何东西），
 * 必须显式 `GW_LLM_LEDGER_ALLOW_REAL_RESET=1` 或 `{force:true}` 才执行。
 * 测试进程已经被 `ledgerFile()` 自动改道到 `test-ledger-<pid>.jsonl`，因此正常测试
 * 永远命中不了这个拒绝分支，也永远碰不到真实账本。
 *
 * @param {{force?: boolean}} [options]
 * @returns {{ok: boolean, file: string, code?: string, reason?: string, removed?: boolean}}
 */
export function resetLedger(options = {}) {
  const target = ledgerFile();
  const force = options?.force === true;
  if (isRealLedger(target) && !force && String(process.env.GW_LLM_LEDGER_ALLOW_REAL_RESET || "").trim() !== "1") {
    return {
      ok: false,
      file: target,
      code: "LEDGER_RESET_REFUSED",
      reason:
        "拒绝清空仓库真实账本：它是「真的调了模型」的唯一硬证据。测试请改用独立账本" +
        "（GW_LLM_LEDGER_FILE=<临时路径>，或在 node:test 下自动改道）；确需人工清理时显式设置 GW_LLM_LEDGER_ALLOW_REAL_RESET=1。",
    };
  }
  try {
    if (existsSync(target)) rmSync(target, { force: true });
    return { ok: true, file: target, removed: true };
  } catch {
    return { ok: false, file: target, code: "LEDGER_RESET_FAILED", reason: "账本文件删除失败；未影响业务结果。" };
  }
}
