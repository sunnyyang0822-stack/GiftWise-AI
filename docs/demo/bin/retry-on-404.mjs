/**
 * GiftWise AI · 「404 是不是别人正在写文件」判定与重试（DEMO-001）
 *
 * 背景：8 条线共用同一工作目录。演示时若某个页面/静态资源 404 或 5xx，
 * 可能是**别的 Agent 正在写文件的中间态**（写一半、被替换、mtime 刚变），
 * 而不是真缺陷。任务书要求：先看相关文件 mtime，再重试一次；
 * 确认是真问题才记录。
 *
 * 本工具把这条规则实现成可复用的判定，并对两种情形给出不同结论：
 *   · 目标文件 mtime 在最近 N 秒内  → 判为 TRANSIENT（有人正在写）→ 等一会重试一次
 *   · 目标文件 mtime 很旧或不存在    → 判为 REAL（真问题）      → 记录下来，不要掩盖
 *
 * 用法：
 *   node docs/demo/bin/retry-on-404.mjs <url> <被服务的文件路径> [mtime窗口秒数]
 *
 * 退出码：0 = 最终成功，或确认是 TRANSIENT 且重试后成功
 *         1 = 确认是 REAL 问题
 *         2 = TRANSIENT 但重试后仍失败
 */
import { statSync, existsSync } from "node:fs";

const url = process.argv[2];
const filePath = process.argv[3];
const windowSec = Number(process.argv[4] || 60);

if (!url || !filePath) {
  process.stderr.write("用法: node docs/demo/bin/retry-on-404.mjs <url> <被服务的文件路径> [mtime窗口秒数]\n");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fileAgeMs() {
  if (!existsSync(filePath)) return null;
  return Date.now() - statSync(filePath).mtimeMs;
}

async function tryFetch() {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { redirect: "manual" });
    const body = await res.arrayBuffer();
    return { http: res.status, bytes: body.byteLength, ms: Date.now() - t0 };
  } catch (e) {
    return { http: 0, error: String(e.message || e), ms: Date.now() - t0 };
  }
}

function classify(attempt) {
  const age = fileAgeMs();
  const fresh = age !== null && age <= windowSec * 1000;
  return {
    file: filePath,
    file_exists: age !== null,
    file_age_s: age === null ? null : Number((age / 1000).toFixed(1)),
    mtime_窗口_s: windowSec,
    judged_as: fresh ? "TRANSIENT（文件刚被写过，很可能是并发写入的中间态）" : "REAL（文件很旧或不存在，基本可判定为真问题）",
    fresh,
  };
}

const out = { url, ...classify(null) };

/* 第一次 */
const a1 = await tryFetch();
out.attempt_1 = a1;
let code;
if (a1.http >= 200 && a1.http < 400) {
  const c = classify(a1);
  out.file_age_s = c.file_age_s;
  out.judged_as = "无需重试（首次即成功）";
  out.conclusion = "SUCCESS";
  code = 0;
} else {
  const c = classify(a1);
  out.file_exists = c.file_exists;
  out.file_age_s = c.file_age_s;
  out.judged_as = c.judged_as;
  if (!c.fresh) {
    out.conclusion = "REAL_PROBLEM";
    out.advice = "这是真问题：记录下来并如实报告，不要用重试掩盖。检查该文件是否真的存在、路径是否正确。";
    code = 1;
  } else {
    out.advice = `判定为并发写入中间态，等 1.5 秒重试一次。`;
    await sleep(1500);
    const a2 = await tryFetch();
    out.attempt_2 = a2;
    const c2 = classify(a2);
    out.file_age_s_after_retry = c2.file_age_s;
    if (a2.http >= 200 && a2.http < 400) {
      out.conclusion = "TRANSIENT_RECOVERED";
      out.advice = "重试后成功 → 确认是并发写入的中间态，不是缺陷。这**不算**翻车，但演示前应冻结相关文件。";
      code = 0;
    } else {
      out.conclusion = "TRANSIENT_UNRESOLVED";
      out.advice = "重试后仍失败 → 需要人工确认。可能是别的 Agent 把文件删了/改名了。";
      code = 2;
    }
  }
}

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
process.exit(code);
