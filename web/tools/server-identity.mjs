/**
 * 服务身份自检（browser-check / smoke-http / page-probe 三个脚本共用）。
 *
 * 为什么需要（真实事故，PM 被它骗到过两次）：
 *   8787 上常年挂着**别的工作区**启动的服务（8 个 agent 并行时尤其常见）。于是
 *   "在 A 工作区跑测试、量到的其实是 B 工作区的页面"，结论会变成"缺陷存在 / 修复无效"，
 *   而所有数字看上去完全正常——**完全静默**。
 *   实测：受控地从 giftwise-alt 起服务后，alt 的真实成绩是 100 项 / 0 失败；
 *   而此前误测主工作区服务时得到的结论是"alt 有 4 个缺陷"。四个全是假的。
 *
 * 本模块做三件事：
 *   1. 比对「服务返回的字节数」与「本工作区 web/public 的磁盘字节数」；
 *   2. 不一致 → 打印诊断（含真查出来的 PID 与两条处置命令）并**非零退出**（码 3）；
 *   3. 未显式指定目标时，改为**自起一个独占端口**的服务，绝不复用他人服务。
 *
 * 收敛口径：三个脚本用同一份实现，避免"某个脚本忘了自检"这种再次静默。
 */

import { statSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, "..", "public");
const SERVER_ENTRY = resolve(HERE, "..", "server", "server.mjs");

/** 必须逐字节同源的静态资源（服务端直接吐磁盘文件，所以字节数即可判定身份）。 */
const WATCHED = [
  ["/landing.css", join(PUBLIC_DIR, "landing.css")],
  ["/", join(PUBLIC_DIR, "index.html")],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ownServer = null;
let exitHookInstalled = false;

/** 结束本模块自起的服务（调用方退出前调用；也自动挂在 exit 上兜底）。 */
export function stopOwnServer() {
  if (ownServer && ownServer.exitCode === null) {
    try {
      ownServer.kill();
    } catch {
      /* 进程可能已退出，忽略 */
    }
  }
  ownServer = null;
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", stopOwnServer);
}

async function fetchSize(base, pathname) {
  const res = await fetch(base + pathname, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).length;
}

/** 逐项比对「服务返回字节数」与「本地磁盘字节数」。 */
export async function auditService(base) {
  const rows = [];
  for (const [pathname, localPath] of WATCHED) {
    const local = statSync(localPath).size;
    let remote = null;
    let error = null;
    try {
      remote = await fetchSize(base, pathname);
    } catch (err) {
      error = String(err.message);
    }
    rows.push({ pathname, local, remote, error, ok: remote === local });
  }
  return { rows, ok: rows.every((r) => r.ok) };
}

/** 从 netstat 找监听该端口的 PID（仅 Windows；取不到返回 null）。 */
function listeningPid(base) {
  try {
    const port = new URL(base).port || "80";
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    const line = out.split(/\r?\n/).find((l) => l.includes("LISTENING") && new RegExp(`[:.]${port}\\s`).test(l));
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

function describe(rows) {
  return rows
    .map((r) => `${r.pathname}=${r.remote === null ? `取不到(${r.error})` : `${r.remote}B`}，本地=${r.local}B`)
    .join("；");
}

function reportPass(rows) {
  process.stdout.write(`✅ 服务一致性自检通过：${rows.map((r) => `${r.pathname}=${r.remote}B`).join(" / ")}\n`);
}

function reportFail(rows, base) {
  const pid = listeningPid(base);
  process.stderr.write(`❌ 服务内容与本地 web/public 不一致：${describe(rows)}。\n`);
  process.stderr.write(`   ${base} 上很可能有另一个工作区的服务在跑。\n`);
  process.stderr.write(
    `   处置：taskkill //F //PID ${pid === null ? "<pid>" : pid}    （查 PID：netstat -ano | findstr :${new URL(base).port}）\n`,
  );
  process.stderr.write(
    "   或改指向本工作区的服务：GW_PORT=18790 node web/server/server.mjs 然后设 GW_BASE=http://127.0.0.1:18790\n",
  );
}

/** 起一个属于**本工作区**的独占服务（随机空闲端口），就绪后返回其 base。 */
async function startOwnServer() {
  const port = await new Promise((res, rej) => {
    const probe = createServer();
    probe.on("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const p = probe.address().port;
      probe.close(() => res(p));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  ownServer = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: resolve(HERE, ".."),
    env: { ...process.env, GW_PORT: String(port) },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/`, { redirect: "follow" });
      if (res.ok) return base;
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(100);
  }
  stopOwnServer();
  throw new Error("自起服务未能在 6 秒内就绪");
}

/**
 * 决定本次要测哪个服务，并返回**实际使用**的 base。
 *
 * @param {string} base  期望的目标（来自 GW_BASE / GW_URL / 默认 8787）
 * @param {{explicit?: boolean}} options  explicit=true 表示用户显式指定，脚本不替他改写目标
 * @returns {Promise<string>} 实际使用的 base（可能与入参不同 = 自起了独占端口）
 */
export async function ensureLocalServer(base, { explicit = false } = {}) {
  installExitHook();
  const target = String(base || "").replace(/\/+$/, "");
  const first = await auditService(target);
  if (first.ok) {
    reportPass(first.rows);
    return target;
  }
  if (explicit) {
    reportFail(first.rows, target);
    process.stderr.write("（目标由你显式指定，脚本不替你改写；请先处置上面的服务。）\n");
    process.exit(3);
  }
  process.stdout.write(`⚠ 默认 ${target} 与本地 web/public 不一致或不可达（${describe(first.rows)}），改为自起独占服务。\n`);
  const own = await startOwnServer();
  const second = await auditService(own);
  if (!second.ok) {
    reportFail(second.rows, own);
    process.exit(3);
  }
  reportPass(second.rows);
  process.stdout.write(`（已在本工作区自起独占服务 ${own}，随脚本退出而结束）\n`);
  return own;
}
