/**
 * 最小页面探针（CDP）：只做一件事——加载页面，报告首帧是否真的渲染出来、有没有页面异常。
 *
 * 用途：改完 web/public/* 后，先用它 3 秒确认「没有首帧崩溃」，再跑完整的 browser-check.mjs。
 * 背景：2026-10-30 深夜发现过一个致命 bug —— bootstrap() 在 state.config 为 null 时渲染表单，
 * 抛 TypeError 导致事件绑定与 /api/config 请求全部不执行，首屏完全点不动；
 * 而 40 项服务端单测与 59 项 HTTP 冒烟全都是绿的。这个探针就是为了不再漏掉这一类问题。
 *
 * 前置：Chrome 带 --remote-debugging-port=9333（命令见 web/HANDOFF-2026-10-30.md 第 1 节）。
 * 运行：GW_CDP=http://127.0.0.1:9333 node web/tools/page-probe.mjs
 *   跑检查前会先做**服务身份自检**（比对 /landing.css 与 / 的字节数是否等于本工作区 web/public）：
 *   不一致则非零退出（防止静默测到别的工作区）；未显式指定目标时会在空闲端口自起独占服务。
 * 退出码：页面有异常或首帧未渲染时为 1。
 */

import { ensureLocalServer, stopOwnServer } from "./server-identity.mjs";

const CDP = process.env.GW_CDP || "http://127.0.0.1:9333";
// 开工前服务身份自检（与 browser-check / smoke-http 共用同一模块）：
// GW_URL / GW_BASE 显式指定时视为"用户指定的目标"，自检不过就非零退出；否则必要时自起独占端口。
const EXPLICIT_TARGET = (process.env.GW_URL || process.env.GW_BASE || "").trim().length > 0;
const TARGET_BASE = (process.env.GW_URL || process.env.GW_BASE || "http://127.0.0.1:8787").replace(/\/+$/, "");
const TARGET = `${await ensureLocalServer(TARGET_BASE, { explicit: EXPLICIT_TARGET })}/`;

const version = await (await fetch(`${CDP}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error(`无法连接 CDP：${CDP}`)), { once: true });
});

let seq = 1;
const waiters = new Map();
const events = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
  if (msg.id !== undefined && waiters.has(msg.id)) {
    const { resolve, reject } = waiters.get(msg.id);
    waiters.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
    return;
  }
  events.push(msg);
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = seq++;
    waiters.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Runtime.enable", {}, sessionId);
await send("Page.enable", {}, sessionId);
// 关缓存：复用调试端口时不然会拿到旧 app.js，把已修的问题误报成还在
await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
await send("Page.navigate", { url: TARGET }, sessionId);
await new Promise((resolve) => setTimeout(resolve, 3000));

const evaluate = async (body) => {
  const result = await send("Runtime.evaluate", { expression: `(() => { ${body} })()`, returnByValue: true }, sessionId);
  if (result.exceptionDetails) return `EXC: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`;
  return result.result ? result.result.value : undefined;
};

const report = {
  url: TARGET,
  browser: version.Browser,
  readyState: await evaluate("return document.readyState"),
  badges: await evaluate("return document.querySelector('#badges')?.children.length ?? null"),
  view: await evaluate("return document.querySelector('#view')?.children.length ?? null"),
  banners: await evaluate("return document.querySelector('#banner-slot')?.children.length ?? null"),
  modeFlagHidden: await evaluate("return document.querySelector('#mode-flag')?.hidden ?? null"),
  heroFlagHidden: await evaluate("return document.querySelector('#hero-flag')?.hidden ?? null"),
  footerMeta: await evaluate("return document.querySelector('#footer-meta')?.textContent ?? null"),
  horizontalOverflow: await evaluate(
    "return document.documentElement.scrollWidth > document.documentElement.clientWidth + 1",
  ),
};

const pageErrors = events
  .filter((m) => m.method === "Runtime.exceptionThrown" || (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params?.type)))
  .map((m) =>
    m.method === "Runtime.exceptionThrown"
      ? m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text
      : (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "),
  );

for (const [key, value] of Object.entries(report)) process.stdout.write(`${key.padEnd(19)} ${value}\n`);
process.stdout.write(`pageExceptions      ${pageErrors.length}\n`);
for (const err of pageErrors) process.stdout.write(`  ! ${err}\n`);

const healthy = pageErrors.length === 0 && (report.view ?? 0) > 0 && report.modeFlagHidden === false;
await send("Target.closeTarget", { targetId });
ws.close();
stopOwnServer();
process.stdout.write(`\n结论：${healthy ? "首帧已渲染、模拟标识可见、无页面异常" : "首帧有问题，先修这个再跑 browser-check.mjs"}\n`);
process.exit(healthy ? 0 : 1);
