#!/usr/bin/env node
/**
 * GiftWise AI 现场演示素材包 —— 真实截图捕获脚本（零依赖，Node ≥ 20 内置 WebSocket/fetch）
 *
 * 一条命令重新生成 docs/demo/pack/shots/** 全部截图：
 *
 *     node docs/demo/pack/capture.mjs
 *     node docs/demo/pack/capture.mjs --only=D5-01        # 只重出某一（几）张，流程照跑
 *
 * 设计纪律（为什么这样写）：
 *   1. **绝不画图/摆拍**：每一张都是本脚本连上真实 Chromium、加载本工作区的接入层服务后
 *      由 Chrome 自己渲染并 Page.captureScreenshot 导出的 PNG。没有任何图片是合成/PS/复用旧图的。
 *   2. **服务一致性自检前置**：`web/tools/browser-check.mjs` / `page-probe.mjs` 自己不起服务，
 *      默认连 127.0.0.1:8787 —— 那个端口上常年挂着**别的工作区**的服务，会把别人的界面截进来。
 *      本脚本因此**先把 8787 上的监听进程全部结束**，**显式从本工作区 web/ 起自己的服务**，
 *      再逐字节比对 `/landing.css` 与 `/` 的返回长度是否等于 web/public 磁盘长度；
 *      **不一致就立刻非零退出，不产出任何截图**。
 *   3. **模拟数据标识入镜**：每个「三候选 / 四段呈现 / 失败态」页面都在截图前断言 #mode-flag
 *      未隐藏并把结果写进清单与 capture-records.json。标识不可见的页面不出图。
 *
 * 前置：Node ≥ 20；本机 Chrome（或用 GW_CHROME 指定）。
 * 产物：docs/demo/pack/shots/*.png、MANIFEST.md、capture-records.json
 * 退出码：0 正常；3 服务一致性自检失败（不出图）；2 脚本自身异常。
 *
 * 边界：本脚本只写 docs/demo/pack/**；对 web/**、validator/**、tests/**、workflow/** 只读。
 *       不发起任何模型调用（本服务以 mock 模式运行，/api/config 里 mode=mock）。
 */

import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// server-identity.mjs 是与 browser-check / smoke-http / page-probe 共用的**同一份**字节比对实现，
// 这里直接复用它，避免"某个脚本忘了自检"造成再次静默。只读引用，不修改它。
import { auditService } from "../../../web/tools/server-identity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const WEB_DIR = join(REPO, "web");
const SHOTS_DIR = join(HERE, "shots");
const PORT = Number(process.env.GW_CAPTURE_PORT || 8787);
const BASE = `http://127.0.0.1:${PORT}`;
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length);
const NO_OPTIMIZE = process.argv.includes("--no-optimize");
/**
 * Chrome 的用户数据目录**绝不能**留在交付目录里（几百个浏览器内部文件、可能含本机访问痕迹）。
 * 因此固定放在系统临时目录，并在脚本退出时整体删除。
 */
const PROFILE_DIR = join(tmpdir(), `giftwise-demo-pack-chrome-${process.pid}`);
const MAX_SHOT_BYTES = Number(process.env.GW_MAX_SHOT_BYTES || 400 * 1024);

const LOG = [];
const say = (line = "") => {
  process.stdout.write(`${line}\n`);
  LOG.push(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmmss = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

const SHOTS = [];
let SERVER = null;
let CHROME = null;
let cdpPort = 0;

/* ---------------------------------------------------------------- 视口 */

const DESKTOP = { name: "desktop 1280×900", width: 1280, height: 900, mobile: false, dsf: 1 };
const DESKTOP_WIDE = { name: "desktop 1440×900", width: 1440, height: 900, mobile: false, dsf: 1 };
const NARROW390 = { name: "narrow 390×844 (dsf2)", width: 390, height: 844, mobile: true, dsf: 2 };
const NARROW390_1X = { name: "narrow 390×844 (dsf1)", width: 390, height: 844, mobile: true, dsf: 1 };
const TINY320 = { name: "tiny 320×640 (dsf2)", width: 320, height: 640, mobile: true, dsf: 2 };

/* --------------------------------- 一之二、静态资产指纹（开拍前 / 收工后各一次） */

/**
 * 为什么需要：共用的 server-identity 只比对 `/landing.css` 与 `/` 两个文件。
 * 2026-10-31 02:02:51 实测到**另一条线**把 `web/public/styles.css` 从 22,254 B 改成 22,703 B（+449 B），
 * 而首屏累计字节因此从 486,091 变成 486,540 —— 这种漂移 shared 自检抓不到。
 * 因此本脚本对**首屏实际加载的全部静态资产**做「服务返回 bytes+sha256 vs 磁盘 bytes+sha256」比对，
 * 并在开拍前、收工后各做一次：两次指纹必须相同，否则说明截图期间资产被人改过，本批截图不作数。
 */
const FROZEN_ASSETS = [
  ["/", "index.html"],
  ["/tokens.css", "tokens.css"],
  ["/styles.css", "styles.css"],
  ["/landing.css", "landing.css"],
  ["/app.js", "app.js"],
  ["/js/landing.js", "js/landing.js"],
  ["/img/image-1.webp", "img/image-1.webp"],
  ["/img/image-2.webp", "img/image-2.webp"],
  ["/img/image-3.webp", "img/image-3.webp"],
];

async function assetFingerprint(label) {
  const rows = [];
  for (const [url, rel] of FROZEN_ASSETS) {
    const p = join(WEB_DIR, "public", rel);
    const local = statSync(p).size;
    const localSha = createHash("sha256").update(readFileSync(p)).digest("hex");
    let served = null;
    let servedSha = null;
    let error = null;
    try {
      const res = await fetch(BASE + url);
      const buf = Buffer.from(await res.arrayBuffer());
      served = buf.length;
      servedSha = createHash("sha256").update(buf).digest("hex");
    } catch (err) {
      error = String(err.message);
    }
    rows.push({ url, rel, local, localSha, served, servedSha, ok: served === local && servedSha === localSha, error });
  }
  say(`[静态资产指纹 @ ${label}]`);
  for (const r of rows) {
    say(
      `  ${r.url.padEnd(20)} 服务=${r.error ? `取不到(${r.error})` : `${r.served}B/${r.servedSha.slice(0, 12)}`}` +
        `  磁盘=${r.local}B/${r.localSha.slice(0, 12)}  ${r.ok ? "一致" : "**不一致**"}`,
    );
  }
  const combined = createHash("sha256")
    .update(rows.map((r) => `${r.url}:${r.local}:${r.localSha}`).join("|"))
    .digest("hex");
  say(`  资产集合指纹 = ${combined}`);
  say("");
  return { rows, combined, ok: rows.every((r) => r.ok) };
}

/* ------------------------------------------------- 一、服务一致性自检 */

/** 该端口上所有 LISTENING 的 (local, pid)。Windows netstat -ano。 */
function listenersOn(port) {
  const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
  const rows = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.includes("LISTENING")) continue;
    const parts = line.split(/\s+/);
    const local = parts[1] || "";
    if (!local.endsWith(`:${port}`)) continue;
    rows.push({ local, pid: parts[parts.length - 1], line });
  }
  return rows;
}

async function preflight() {
  say("================================================================");
  say("一、服务一致性自检（确保截到的是**本工作区**的界面，不是别的工作区的）");
  say("================================================================");
  say(`工作目录：${REPO}`);
  say(`目标服务：${BASE}`);
  say("");

  const before = listenersOn(PORT);
  if (before.length === 0) {
    say(`$ netstat -ano | grep -E ':${PORT} .*LISTENING'`);
    say("  → （无输出：该端口当前没有监听进程）");
  } else {
    say(`$ netstat -ano | grep -E ':${PORT} .*LISTENING'`);
    for (const row of before) say(`  ${row.line}`);
    const pids = [...new Set(before.map((r) => r.pid))];
    say(`  发现 ${pids.length} 个监听 PID：${pids.join(" / ")} —— 一律结束，避免截到别的工作区的服务`);
    for (const pid of pids) {
      try {
        const out = execFileSync("taskkill", ["/F", "/PID", pid], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        say(`  $ taskkill //F //PID ${pid}\n    ${out.trim().split(/\r?\n/).join("\n    ")}`);
      } catch (err) {
        say(`  $ taskkill //F //PID ${pid}\n    （已不存在或无法结束：${String(err.message).split("\n")[0]}）`);
      }
    }
  }

  const after = listenersOn(PORT);
  if (after.length > 0) {
    throw new Error(`端口 ${PORT} 上仍有监听进程，拒绝继续（会截到别人的界面）`);
  }

  say("");
  say(`$ cd web && GW_PORT=${PORT} node server/server.mjs    （显式从本工作区起服务）`);
  SERVER = spawn(process.execPath, [join(WEB_DIR, "server", "server.mjs")], {
    cwd: WEB_DIR,
    env: { ...process.env, GW_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  SERVER.stdout.on("data", (d) => process.stdout.write(`  [server] ${d}`));
  SERVER.stderr.on("data", (d) => process.stdout.write(`  [server:err] ${d}`));

  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) {
        ready = true;
        say(`  [healthz] ${await res.text()}`);
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(100);
  }
  if (!ready) throw new Error(`本工作区服务 6 秒内未就绪：${BASE}`);

  const own = listenersOn(PORT);
  say(`  本工作区服务的监听 PID：${[...new Set(own.map((r) => r.pid))].join(" / ") || "（取不到）"}`);
  say("");

  // 逐字节比对（与 browser-check / smoke-http / page-probe 共用实现）
  const audit = await auditService(BASE);
  say(`$ 服务返回字节数 vs 本地 web/public 磁盘字节数`);
  for (const row of audit.rows) {
    say(`  ${row.pathname.padEnd(14)} 服务=${row.remote === null ? `取不到(${row.error})` : row.remote}B  本地=${row.local}B  ${row.ok ? "一致" : "**不一致**"}`);
  }
  const css = audit.rows.find((r) => r.pathname === "/landing.css");
  say("");
  say(`$ curl -s -o /dev/null -w '%{size_download}\\n' ${BASE}/landing.css`);
  say(`  ${css ? css.remote : "?"}`);
  say(`$ stat -c%s web/public/landing.css`);
  say(`  ${css ? css.local : "?"}`);

  if (!audit.ok) {
    say("");
    say("❌ 服务内容与本地 web/public 不一致 —— 端口上很可能有另一个工作区的服务。");
    say("   **按纪律：立刻停下，不出任何截图。**");
    process.exitCode = 3;
    cleanup();
    throw new Error("service identity check failed");
  }
  say("");
  say("✅ 一致性自检通过：服务返回字节数与本地 web/public 完全一致 —— 以下截图全部来自本工作区。");
  say("");
}

/* -------------------------------------------------------- 二、Chrome */

function findChrome() {
  const candidates = [
    process.env.GW_CHROME,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("找不到 Chrome，请用 GW_CHROME 指定 chrome.exe 路径");
}

async function freePort() {
  return new Promise((res, rej) => {
    const probe = createServer();
    probe.on("error", rej);
    probe.listen(0, "127.0.0.1", () => {
      const p = probe.address().port;
      probe.close(() => res(p));
    });
  });
}

async function launchChrome() {
  const exe = findChrome();
  cdpPort = Number(process.env.GW_CDP_PORT || (await freePort()));
  mkdirSync(PROFILE_DIR, { recursive: true });
  say(`$ "${exe}" --headless=new --disable-gpu --no-sandbox --hide-scrollbars \\`);
  say(`    --remote-debugging-port=${cdpPort} --user-data-dir="%TEMP%\\${PROFILE_DIR.split(/[\\/]/).pop()}" about:blank`);
  say("  （profile 放在系统临时目录，脚本退出时整体删除；交付目录里不会留任何浏览器内部文件）");
  CHROME = spawn(
    exe,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${PROFILE_DIR}`,
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        const info = await res.json();
        say(`  浏览器：${info.Browser}`);
        return info;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error(`Chrome 未能在 20 秒内开放 CDP 端口 ${cdpPort}`);
}

/* ------------------------------------------------------------ CDP 客户端 */

class Client {
  constructor(ws) {
    this.ws = ws;
    this.seq = 1;
    this.waiters = new Map();
    this.listeners = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (msg.id !== undefined && this.waiters.has(msg.id)) {
        const { resolve, reject } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      for (const fn of this.listeners) fn(msg);
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error(`无法连接 CDP：${url}`)), { once: true });
    });
    return new Client(ws);
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.seq++;
      this.waiters.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

class Page {
  constructor(client, sessionId) {
    this.client = client;
    this.sessionId = sessionId;
    this.consoleErrors = [];
    this.requests = [];
    client.on((msg) => {
      if (msg.sessionId !== this.sessionId) return;
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
        this.consoleErrors.push({ kind: msg.params.type, text: (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ") });
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.consoleErrors.push({ kind: "exception", text: d.exception?.description || d.text });
      }
      if (msg.method === "Network.requestWillBeSent") {
        this.requests.push({ url: msg.params.request.url, encoded: 0 });
      }
      if (msg.method === "Network.loadingFinished" && this.requests.length > 0) {
        const pending = this.requests.find((r) => !r.encoded);
        if (pending) pending.encoded = msg.params.encodedDataLength || 0;
      }
    });
  }

  cmd(method, params = {}) {
    return this.client.send(method, params, this.sessionId);
  }

  async init() {
    await this.cmd("Runtime.enable");
    await this.cmd("Page.enable");
    await this.cmd("Network.enable");
    await this.cmd("Network.setCacheDisabled", { cacheDisabled: true });
  }

  async setViewport(vp) {
    await this.cmd("Emulation.setDeviceMetricsOverride", {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.dsf || 1,
      mobile: !!vp.mobile,
    });
    await this.cmd("Emulation.setTouchEmulationEnabled", { enabled: !!vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    this.viewport = vp;
  }

  async eval(body) {
    const result = await this.cmd("Runtime.evaluate", {
      expression: `(() => { ${body} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`页面脚本异常：${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
    }
    return result.result ? result.result.value : undefined;
  }

  async waitFor(body, { timeout = 25000, label = "条件" } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.eval(body)) return true;
      await sleep(200);
    }
    throw new Error(`等待超时：${label}`);
  }

  async goto(url, { settle = 500 } = {}) {
    this.requests.length = 0;
    this.consoleErrors.length = 0;
    await this.cmd("Page.navigate", { url });
    await this.waitFor("return document.readyState === 'complete'", { timeout: 15000, label: "页面加载" });
    await this.waitFor("return (document.querySelector('#badges')?.children.length || 0) > 0", { timeout: 15000, label: "配置加载完成" }).catch(() => {});
    await sleep(settle);
    this.url = url;
  }

  async scrollTo(y) {
    await this.eval(`window.scrollTo(0, ${Number(y)}); return window.scrollY;`);
    await sleep(250);
  }

  async scrollIntoView(selector) {
    const info = await this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40), top: Math.round(r.top) };
    `);
    await sleep(300);
    return info;
  }

  /** 真实鼠标点击：先取元素中心坐标，再派发 mousePressed/mouseReleased。 */
  async mouseClick(locator) {
    const info = await this.eval(`
      const hit = ${locator};
      if (!hit) return { ok: false };
      hit.scrollIntoView({ block: 'center' });
      const r = hit.getBoundingClientRect();
      return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: (hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) };
    `);
    if (!info.ok) return { ok: false };
    const common = { x: info.x, y: info.y, button: "left", clickCount: 1 };
    await this.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: info.x, y: info.y });
    await this.cmd("Input.dispatchMouseEvent", { type: "mousePressed", ...common });
    await this.cmd("Input.dispatchMouseEvent", { type: "mouseReleased", ...common });
    await sleep(120);
    return info;
  }

  async clickId(id) {
    const res = await this.mouseClick(`document.getElementById(${JSON.stringify(id)})`);
    if (!res.ok) throw new Error(`找不到 id「${id}」`);
    return res;
  }

  async click(kind, text) {
    const selector =
      kind === "seg" ? ".seg button" : kind === "button" ? "button" : kind === "confirm" ? "label.confirm-row" : "label.chip";
    const res = await this.mouseClick(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}))`,
    );
    if (!res.ok) {
      const available = await this.eval(
        `return [...document.querySelectorAll(${JSON.stringify(selector)})].map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 20));`,
      );
      throw new Error(`找不到 ${kind}「${text}」；可选：${available.join(" / ")}`);
    }
    return res;
  }

  /** 在指定兴趣行内点可信度分段按钮（而不是"第一个 .seg"）。 */
  async clickSegInRow(rowText, segText) {
    const res = await this.mouseClick(`
      (() => {
        const row = [...document.querySelectorAll('.interest-row')].find((r) => (r.textContent || '').includes(${JSON.stringify(rowText)}));
        if (!row) return null;
        return [...row.querySelectorAll('.seg button')].find((b) => (b.textContent || '').trim() === ${JSON.stringify(segText)}) || null;
      })()
    `);
    if (!res.ok) throw new Error(`找不到「${rowText}」行内的「${segText}」`);
    return res;
  }

  /** 真实逐字按键输入（走 keyDown/keyUp，检验重绘不打断焦点）。 */
  async typeKeys(selector, text) {
    await this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('找不到输入框 ' + ${JSON.stringify(selector)});
      el.focus();
      try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* number 输入框不支持选区 */ }
    `);
    for (const ch of text) {
      await this.cmd("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch });
      await this.cmd("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(15);
    }
    await sleep(150);
  }

  /** 模拟数据标识可见性（每个三候选/呈现/失败态页面截图前都必须过这一关）。 */
  async flagState() {
    return this.eval(`
      const flat = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
      const f = document.querySelector('#mode-flag');
      const h = document.querySelector('#hero-flag');
      const r = f ? f.getBoundingClientRect() : null;
      return {
        modeFlagHidden: f ? !!f.hidden : null,
        modeFlagText: f ? flat(f) : null,
        modeFlagHeight: r ? Math.round(r.height) : null,
        heroFlagHidden: h ? !!h.hidden : null,
        heroFlagText: h && !h.hidden ? flat(h).slice(0, 60) : null,
      };
    `);
  }

  async screenshot(id, { note, demo, fullPage = true } = {}) {
    const file = join(SHOTS_DIR, `${id}.png`);
    if (ONLY && !id.includes(ONLY)) {
      say(`  （跳过 ${id}，--only=${ONLY}）`);
      return null;
    }
    const shot = await this.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage });
    const buf = Buffer.from(shot.data, "base64");
    writeFileSync(file, buf);
    const rec = {
      id,
      file: `shots/${id}.png`,
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      time: hhmmss(),
      url: this.url,
      demo: demo || (this.url && new URL(this.url).searchParams.get("demo")) || "",
      viewport: this.viewport ? this.viewport.name : "",
      viewportPx: this.viewport ? `${this.viewport.width}x${this.viewport.height}@${this.viewport.dsf || 1}` : "",
      fullPage,
      note: note || "",
    };
    SHOTS.push(rec);
    say(`  SHOT ${rec.time}  ${rec.file}  ${rec.bytes} B  ${rec.viewport}  ${rec.url}`);
    return rec;
  }
}

async function openPage(client, vp, url) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(client, sessionId);
  await page.init();
  await page.setViewport(vp);
  await page.goto(url);
  return { page, targetId };
}

async function closePage(client, targetId) {
  try {
    await client.send("Target.closeTarget", { targetId });
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------ 三、填表（基线） */
/* 基线 = docs/demo-script.md 第三节：追求对象 / 了解不多 / 生日 / 200.00 CNY / 2 天 /
   咖啡与美食（已确认）+ 设计与艺术（推断）/ 实用型 + 精致但不张扬 / 禁忌：酒类 + 字面词「酒」 */

const BUDGET_INPUT = 'input[aria-label="预算上限金额"]';
const DAYS_INPUT = 'input[aria-label="可用准备天数"]';
const EXCLUDE_TERMS = 'input[aria-label="明确禁忌的字面词"]';
const CONTEXT = 'textarea[aria-label="补充说明"]';

async function fillStep1Baseline(page) {
  await page.click("chip", "追求对象");
  await page.click("chip", "了解不多");
  await page.click("chip", "生日");
  await page.click("chip", "100–200 元");
  await page.typeKeys(BUDGET_INPUT, "200.00");
  await page.click("confirm", "就是本次礼物＋包装＋贺卡＋装饰＋配送的全量上限");
  await page.click("chip", "不着急");
  await page.typeKeys(DAYS_INPUT, "2");
  await page.click("confirm", "我确认可用的完整准备时间是 2 天");
}

async function fillStep2Baseline(page) {
  await page.click("chip", "咖啡与美食");
  await page.clickSegInRow("咖啡与美食", "明确知道");
  await page.click("chip", "设计与艺术");
  await page.click("chip", "实用型");
  await page.click("chip", "精致但不张扬");
}

async function fillStep3Baseline(page) {
  await page.click("chip", "酒类");
  await page.typeKeys(EXCLUDE_TERMS, "酒");
  // 真实按键输入非 ASCII 文字若未被接受，退回程序化 input 事件（并在日志里如实说明）
  const typed = await page.eval(`const el = document.querySelector(${JSON.stringify(EXCLUDE_TERMS)}); return el ? el.value : null;`);
  if (typed !== "酒") {
    say(`  ⚠ 逐字按键未写入「酒」（当前值 ${JSON.stringify(typed)}），退回程序化 input 事件`);
    await page.eval(`
      const el = document.querySelector(${JSON.stringify(EXCLUDE_TERMS)});
      el.value = "酒";
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    `);
    await sleep(200);
  }
  await page.eval(`
    const el = document.querySelector(${JSON.stringify(CONTEXT)});
    if (el) { el.value = "完全虚构的演示请求：希望表达生日祝福，不制造关系压力。"; el.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  `);
  await sleep(200);
}

async function clickStep(page, which) {
  return page.clickId(which === "next" ? "step-next" : "step-back");
}

/** 从首屏跑到三方案对比页。返回 {status} */
async function runToRecommendation(page) {
  await page.clickId("cta-start");
  await page.waitFor("return document.querySelector('#view').children.length > 0");
  await fillStep1Baseline(page);
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('对方的兴趣')", { label: "第二步" });
  await fillStep2Baseline(page);
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('不喜欢或不适合的类型')", { label: "第三步" });
  await fillStep3Baseline(page);
  await page.click("button", "生成三个方案");
  await page.waitFor(
    "return document.body.textContent.includes('推荐结果') || document.body.textContent.includes('空状态') || !!document.querySelector('.error-box')",
    { label: "三方案对比页", timeout: 40000 },
  );
}

/** 读三候选卡片：名称/全量估算/准备天数/是否可选。 */
async function readCandidates(page) {
  return page.eval(`
    const flat = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
    return [...document.querySelectorAll('#view section.card')].filter((s) => s.querySelector('.how__num')).map((s) => {
      const dl = s.querySelector('dl.kv');
      const pairs = {};
      if (dl) {
        const kids = [...dl.children];
        for (let i = 0; i < kids.length - 1; i += 1) {
          if (kids[i].tagName === 'DT') pairs[flat(kids[i])] = flat(kids[i + 1]);
        }
      }
      return {
        num: flat(s.querySelector('.how__num')),
        name: flat(s.querySelector('.card__title')),
        total: pairs['全量估算费用'] || null,
        days: pairs['准备时间'] || null,
        passText: pairs['独立检查结果'] || null,
        selectable: [...s.querySelectorAll('button')].some((b) => (b.textContent || '').includes('选择这个方案')),
      };
    });
  `);
}

/** 选中最"稳"的可选候选：优先准备天数装得下、总价最低。 */
async function selectBestCandidate(page, availableDays) {
  const cands = await readCandidates(page);
  const centsOf = (s) => {
    const m = /([0-9]+(?:\.[0-9]{1,2})?)\s*CNY/.exec(s || "");
    return m ? Math.round(Number(m[1]) * 100) : Number.POSITIVE_INFINITY;
  };
  const daysOf = (s) => {
    const m = /([0-9]+)\s*天/.exec(s || "");
    return m ? Number(m[1]) : 999;
  };
  const usable = cands.filter((c) => c.selectable);
  const fitting = usable.filter((c) => daysOf(c.days) <= availableDays);
  const pool = fitting.length > 0 ? fitting : usable;
  if (pool.length === 0) return { picked: null, cands };
  pool.sort((a, b) => centsOf(a.total) - centsOf(b.total));
  const target = pool[0];
  const targetId = (/·\s*([A-Za-z0-9_-]+)\s*$/.exec(target.num) || [])[1] || target.num;
  const res = await page.mouseClick(`
    (() => {
      const secs = [...document.querySelectorAll('#view section.card')].filter((s) => s.querySelector('.how__num'));
      const sec = secs.find((s) => (s.querySelector('.how__num').textContent || '').includes(${JSON.stringify(targetId)}));
      if (!sec) return null;
      return [...sec.querySelectorAll('button')].find((b) => (b.textContent || '').includes('选择这个方案')) || null;
    })()
  `);
  if (!res.ok) throw new Error("点不到「选择这个方案」按钮");
  return { picked: target, cands, clicked: res.label };
}

/* ------------------------------------------------------------ 四、场景 */

async function scenarioLanding(client) {
  say("=== 场景 A：D10 首屏 + 常驻吸顶「模拟数据」标识 ===");
  // 1280×900 与 browser-check 冻结口径一致（首屏请求 10 条 / 486,091 字节就是在这个视口下量的）
  {
    const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/`);
    const flag = await page.flagState();
    say(`  #mode-flag hidden=${flag.modeFlagHidden} text="${flag.modeFlagText}" #hero-flag hidden=${flag.heroFlagHidden}`);
    if (flag.modeFlagHidden) throw new Error("首屏 #mode-flag 被隐藏，按纪律不出图");
    await page.screenshot("D10-01-firstscreen-desktop-1280x900", { note: "首屏（scrollY=0，仅视口）：顶部常驻吸顶「模拟数据 · 未接真实模型」+ 首屏数据来源说明可见", fullPage: false });
    await page.screenshot("D10-05-landing-full-desktop-1280x900", { note: "首屏整页（含六屏来源说明、页脚模式行）" });
    await page.scrollTo(900);
    await page.screenshot("D10-04-sticky-scrolled-desktop-1280x900", { note: "向下滚动 900px 后仍可见吸顶标识（position: sticky）", fullPage: false });
    say(`  控制台异常：${page.consoleErrors.length}`);
    await closePage(client, targetId);
  }
  for (const [vp, id, note] of [
    [NARROW390, "D10-02-firstscreen-narrow390", "窄屏 390×844 首屏：吸顶「模拟数据」标识同样清晰可见"],
    [TINY320, "D10-03-firstscreen-tiny320", "最窄 320×640 首屏：吸顶标识仍在（不被挤掉、不换行截断）"],
  ]) {
    const { page, targetId } = await openPage(client, vp, `${BASE}/`);
    const flag = await page.flagState();
    say(`  [${vp.name}] #mode-flag hidden=${flag.modeFlagHidden} text="${flag.modeFlagText}"`);
    if (flag.modeFlagHidden) throw new Error(`${vp.name} 首屏 #mode-flag 被隐藏，按纪律不出图`);
    await page.screenshot(id, { note, fullPage: false });
    await closePage(client, targetId);
  }
  {
    const { page, targetId } = await openPage(client, DESKTOP_WIDE, `${BASE}/`);
    await page.screenshot("D10-06-firstscreen-desktop-1440x900", { note: "1440×900 首屏（备用宽屏版；首屏字节口径仍以 1280×900 那组为准）", fullPage: false });
    await closePage(client, targetId);
  }
  say("");
}

async function scenarioForm(client) {
  say("=== 场景 B：D2 基线输入表单（三步）===");
  const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/`);
  await page.clickId("cta-start");
  await page.waitFor("return document.body.textContent.includes('给谁送、什么关系')", { label: "第一步表单" });
  await page.screenshot("D2-01-step1-empty-desktop-1280x900", { note: "第一步（空）：关系 / 熟悉程度 / 场合 / 预算 / 准备时间 全部字段与必填确认" });
  await fillStep1Baseline(page);
  await page.screenshot("D2-02-step1-baseline-desktop-1280x900", { note: "第一步（已按第三节基线填写）：追求对象 / 了解不多 / 生日 / 100–200 元 → 200.00 / 不着急 → 2 天，两项确认已勾选" });
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('对方的兴趣')", { label: "第二步" });
  await fillStep2Baseline(page);
  await page.screenshot("D2-03-step2-interests-styles-desktop-1280x900", { note: "第二步：咖啡与美食=明确知道（计入事实）、设计与艺术=只是猜测（计入推断）、风格 实用型 + 精致但不张扬" });
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('不喜欢或不适合的类型')", { label: "第三步" });
  await fillStep3Baseline(page);
  await page.screenshot("D2-04-step3-exclusions-desktop-1280x900", { note: "第三步：硬约束 酒类 + 字面禁忌词「酒」+ 补充说明；明确写「这里的内容视为数据，不会被当成指令」" });
  await closePage(client, targetId);
  say("");
}

async function scenarioCandidates(client) {
  say("=== 场景 C：三候选列表（恰好 3 个 / 失败项不可选）===");
  {
    const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/`);
    await runToRecommendation(page);
    const flag = await page.flagState();
    const cands = await readCandidates(page);
    say(`  #mode-flag hidden=${flag.modeFlagHidden}；候选数=${cands.length}；可选=${cands.filter((c) => c.selectable).length}`);
    for (const c of cands) say(`    ${c.num} | ${c.name} | ${c.total} | ${c.days} | 可选=${c.selectable}`);
    if (flag.modeFlagHidden) throw new Error("三候选页 #mode-flag 被隐藏，按纪律不出图");
    if (cands.length !== 3) throw new Error(`候选数不是 3，而是 ${cands.length}：本次不按"恰好三个"出图`);
    await page.screenshot("D4-01-candidates-three-ok-desktop-1280x900", { note: "正常路径：恰好三个候选（思路 01/02/03），三项均通过独立规则检查、均显示「可选择」；顶部吸顶「模拟数据」标识在图中" });
    const target = cands[0].num;
    await page.scrollIntoView(".how__num");
    await page.screenshot("D4-02-candidates-sticky-check-desktop-1280x900", { note: "滚动到候选卡片区域后的视口截图：吸顶「模拟数据」标识仍在视口顶部 —— 证明它不会被滚动带走", fullPage: false });
    await closePage(client, targetId);
  }
  {
    const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/?demo=partial_fail`);
    await runToRecommendation(page);
    const flag = await page.flagState();
    const cands = await readCandidates(page);
    say(`  [partial_fail] #mode-flag hidden=${flag.modeFlagHidden}；候选数=${cands.length}；可选=${cands.filter((c) => c.selectable).length}`);
    for (const c of cands) say(`    ${c.num} | ${c.name} | 可选=${c.selectable} | ${String(c.passText).slice(0, 50)}`);
    const hints = await page.eval("return document.body.textContent.includes('失败项不可选择')");
    say(`  页面出现「失败项不可选择」提示：${hints}`);
    if (cands.length !== 3) throw new Error(`partial_fail 候选数不是 3，而是 ${cands.length}`);
    await page.screenshot("D4-03-candidates-partial-fail-desktop-1280x900", { note: "?demo=partial_fail：仍恰好三个候选，其中一项未通过独立检查 → 显示「未通过，不可选择」+ 错误码，且没有选择按钮、没有自动替选" });
    await closePage(client, targetId);
  }
  say("");
}

async function scenarioPresentation(client, demo, tag) {
  const url = demo ? `${BASE}/?demo=${demo}` : `${BASE}/`;
  say(`=== 场景 D：四段呈现${demo ? ` @ ?demo=${demo}` : ""} ===`);
  const { page, targetId } = await openPage(client, DESKTOP, url);
  await runToRecommendation(page);
  const { picked, cands, clicked } = await selectBestCandidate(page, 2);
  say(`  选中的候选：${picked ? `${picked.num} | ${picked.name} | ${picked.total} | ${picked.days}` : "（没有可选候选）"}`);
  if (!picked) throw new Error("没有可选择的候选，无法进入呈现页");
  await page.waitFor("return document.body.textContent.includes('选择后复核')", { label: "四段呈现页", timeout: 40000 });
  const flag = await page.flagState();
  const sections = await page.eval(`
    return [...document.querySelectorAll('#view section.card')]
      .map((s) => (s.querySelector('.card__title') || {}).textContent || '')
      .map((t) => t.trim())
      .filter((t) => /^[①②③④]/.test(t));
  `);
  say(`  #mode-flag hidden=${flag.modeFlagHidden}；四段标题=${JSON.stringify(sections)}`);
  if (flag.modeFlagHidden) throw new Error("呈现页 #mode-flag 被隐藏，按纪律不出图");

  const prefix = tag || "D5";
  if (!demo) {
    await page.screenshot(`${prefix}-01-presentation-full-desktop-1280x900`, { note: "四段呈现整页：顶部即吸顶「模拟数据」标识；含选择后复核（礼物＋包装＋贺卡＋装饰＋配送）与被选候选的复核结论" });
  } else {
    await page.screenshot(`${prefix}-01-over-budget-full-desktop-1280x900`, {
      note: `${prefix === "E4" ? "超预算拒绝" : "呈现"}整页（?demo=${demo}）：首次复核给出 OVER_BUDGET（估算超预算），卡内中文说明「已用唯一一次全局自动修订」`,
    });
  }
  // 四段逐段视口截图（每张都在视口顶部保留吸顶标识）
  // E4（超预算）那一次只出整页图：它的重点在「首次复核 OVER_BUDGET」那张错误框，四段内容与 D5 完全重复。
  const titles = ["① 风格与配色", "② 包装材料与步骤", "③ 贺卡正文与装饰物建议", "④ 赠送时机、方式与话术"];
  for (let i = 0; i < titles.length; i += 1) {
    const found = await page.eval(`
      const want = ${JSON.stringify(titles[i])};
      const h = [...document.querySelectorAll('#view h2')].find((x) => (x.textContent || '').includes(want));
      if (!h) return false;
      h.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -96);   // 让开顶部吸顶横幅，标题不被压住
      return true;
    `);
    if (!found) throw new Error(`呈现页缺少四段之一的标题：${titles[i]}`);
    await sleep(300);
    if (sections.length >= 4 && !demo) {
      const id = `${prefix}-0${i + 2}-${["sec1-style-palette", "sec2-packaging", "sec3-card-decor", "sec4-giving"][i]}-desktop-1280x900`;
      await page.screenshot(id, { note: `四段呈现第 ${i + 1} 段「${titles[i]}」（视口截图，顶部吸顶「模拟数据」标识可见）`, fullPage: false });
    }
  }
  if (!demo) {
    await page.eval("window.scrollTo(0, 0); return true;");
    await sleep(200);
    await closePage(client, targetId);
    const narrow = await openPage(client, NARROW390_1X, url);
    await runToRecommendation(narrow.page);
    const sel = await selectBestCandidate(narrow.page, 2);
    say(`  [narrow390] 选中候选：${sel.picked ? sel.picked.num : "（无）"}`);
    await narrow.page.waitFor("return document.body.textContent.includes('选择后复核')", { label: "窄屏四段呈现", timeout: 40000 });
    await narrow.page.screenshot("D5-06-presentation-full-narrow390", { note: "窄屏 390 的四段呈现整页（证明窄屏下吸顶「模拟数据」标识与四段排版仍成立）" });
    await closePage(client, narrow.targetId);
  }
  say(`  控制台异常：${page.consoleErrors.length}`);
  await closePage(client, targetId);
  say("");
}

async function scenarioFailures(client) {
  say("=== 场景 E：失败态 ===");
  /* E1 model_error */
  {
    const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/?demo=model_error`);
    await runToRecommendation(page);
    const flag = await page.flagState();
    const text = await page.eval("return document.querySelector('#view').textContent.replace(/\\s+/g, ' ').trim().slice(0, 200)");
    say(`  [model_error] #mode-flag hidden=${flag.modeFlagHidden}`);
    say(`  [model_error] #view 文本：${text}`);
    await page.screenshot("E1-01-model-error-desktop-1280x900", { note: "?demo=model_error：模型输出损坏 JSON → 不把空结果当成功，给出中文错误/空状态说明与错误码，无任何可选方案" });
    await closePage(client, targetId);
  }
  /* E2 timeout (?demo=slow: 服务端 45s > 客户端 20s) */
  {
    const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/?demo=slow`);
    await runToRecommendation_untilSubmit(page);
    await sleep(1200);
    const loading = await page.eval("return !!document.querySelector('.spinner') && document.body.textContent.includes('正在')");
    say(`  [slow] 请求期间显示中文加载中：${loading}`);
    await page.screenshot("E2-01-loading-desktop-1280x900", { note: "?demo=slow：客户端 20s 超时窗口内的中文加载态「正在生成三个不同思路…」", fullPage: false });
    await page.waitFor("return document.body.textContent.includes('请求超时')", { timeout: 40000, label: "超时状态" });
    const retry = await page.eval(`
      const bs = [...document.querySelectorAll('#view button, #actions button')].map((b) => (b.textContent || '').trim());
      return { buttons: bs, hasRetry: bs.some((t) => t.includes('重试')), hasBack: bs.some((t) => t.includes('回到表单')) };
    `);
    say(`  [slow] 超时态按钮：${JSON.stringify(retry)}`);
    await page.screenshot("E2-02-timeout-desktop-1280x900", { note: `?demo=slow：超时态，中文说明「未在设定时间内拿到结果 / 超时不会被当作成功」+ 重试入口（重试=${retry.hasRetry}，回到表单=${retry.hasBack}）` });
    await closePage(client, targetId);
  }
  /* E3 empty: 旧记录失效 */
  {
    const { page, targetId } = await openPage(client, DESKTOP, `${BASE}/`);
    await page.eval("sessionStorage.setItem('gw_last_run', 'gw-not-exist'); return true;");
    await page.goto(`${BASE}/`);
    const ok = await page.eval("return document.body.textContent.includes('上一次的任务记录已不存在')");
    const flag = await page.flagState();
    say(`  [empty] 中文空状态出现：${ok}；#mode-flag hidden=${flag.modeFlagHidden}`);
    await page.screenshot("E3-01-empty-record-expired-desktop-1280x900", { note: "空状态（记录失效）：sessionStorage 里的旧运行编号在内存服务上取不到 → 中文说明「接入层为内存实现，服务重启即失效」，不静默假装有数据" });
    await closePage(client, targetId);
  }
  /* E4 over budget in presentation */
  {
    await scenarioPresentation(client, "presentation_over_budget", "E4");
  }
  say("");
}

/** ?demo=slow 专用：走到"生成三个方案"就返回（不等待结果，因为要 45s）。 */
async function runToRecommendation_untilSubmit(page) {
  await page.clickId("cta-start");
  await page.waitFor("return document.querySelector('#view').children.length > 0");
  await fillStep1Baseline(page);
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('对方的兴趣')", { label: "第二步" });
  await fillStep2Baseline(page);
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('不喜欢或不适合的类型')", { label: "第三步" });
  await fillStep3Baseline(page);
  await page.click("button", "生成三个方案");
}

/* ------------------------------------------- 五、首屏字节口径复核（只读测量） */

async function measureFirstScreen(client) {
  say("================================================================");
  say("五、首屏请求数与字节数复核（与冻结口径比对，只测量、不改口径）");
  say("================================================================");
  say("方法对齐说明：web/tools/browser-check.mjs 是在「整页截图之后」才统计 page.requests 的；");
  say("整页渲染（captureBeyondViewport）会把首屏之外、由 CSS 背景引用的 image-3.webp（89,788 B）也拉下来。");
  say("本脚本因此先丢弃式地做一次整页渲染，再统计，才是同一口径。");
  say("");
  const rows = [];
  for (const vp of [DESKTOP, NARROW390, TINY320]) {
    const { page, targetId } = await openPage(client, vp, `${BASE}/`);
    await sleep(1500);
    await page.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }); // 丢弃，只为触发同一批请求
    await sleep(1500);
    const bytes = page.requests.reduce((sum, r) => sum + (r.encoded || 0), 0);
    const external = page.requests.filter(
      (r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("chrome-extension:") && !r.url.startsWith("devtools:"),
    );
    rows.push({ vp: vp.name, count: page.requests.length, bytes, external: external.length });
    say(`  ${vp.name.padEnd(22)} 请求 ${page.requests.length} 条，累计 ${bytes} 字节；外部/CDN 请求 ${external.length} 条`);
    for (const r of page.requests) {
      const path = r.url.startsWith(BASE) ? r.url.slice(BASE.length) : r.url.slice(0, 60);
      say(`      ${String(r.encoded).padStart(8)} B  ${path}`);
    }
    await closePage(client, targetId);
  }
  const expect = [
    { vp: "desktop 1280×900", count: 10, bytes: 486091 },
    { vp: "narrow 390×844 (dsf2)", count: 9, bytes: 366825 },
    { vp: "tiny 320×640 (dsf2)", count: 9, bytes: 366825 },
  ];
  for (const e of expect) {
    const got = rows.find((r) => r.vp === e.vp);
    const ok = got && got.count === e.count && got.bytes === e.bytes;
    say(`  ${ok ? "✅" : "⚠"} ${e.vp}: 实测 ${got ? `${got.count} 条 / ${got.bytes} B` : "（未测到）"} vs 冻结口径 ${e.count} 条 / ${e.bytes} B`);
  }
  say("");
  return rows;
}

/* --------------------------------------------- 六、PNG 体积控制（无损优先） */

const PY_CANDIDATES = [
  process.env.GW_PYTHON,
  "C:\\Users\\lenovo\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
  "python3",
  "python",
].filter(Boolean);

function findPillowPython() {
  for (const py of PY_CANDIDATES) {
    try {
      execFileSync(py, ["-c", "import PIL"], { stdio: "ignore" });
      return py;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

const PY_OPTIMIZE = `
import sys, os
from PIL import Image
limit = int(sys.argv[1])
ladder = [int(x) for x in sys.argv[2].split(",")]
before_total = after_total = 0
rows = []
for path in sys.argv[3:]:
    before = os.path.getsize(path)
    before_total += before
    after = before
    if before > limit:
        Image.open(path).save(path, optimize=True, compress_level=9)   # 第一步：无损重编码
        after = os.path.getsize(path)
    if after > limit:
        for colors in ladder:                                          # 第二步：逐步降色板（低损）
            pal = Image.open(path).convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=colors)
            pal.save(path, optimize=True, compress_level=9)
            after = os.path.getsize(path)
            if after <= limit:
                break
    after_total += after
    if after != before:
        rows.append((os.path.basename(path), before, after))
for name, b, a in rows:
    print("  %-52s %8d -> %8d  (-%d%%)" % (name, b, a, round((b - a) * 100 / b)))
print("  PNG optimize total: %d -> %d bytes" % (before_total, after_total))
`;

function optimizeShots() {
  say("================================================================");
  say("六、PNG 体积控制（先无损重编码；仍超限才降色板；**不裁剪、不改内容**）");
  say("================================================================");
  const overBefore = SHOTS.filter((s) => existsSync(join(HERE, s.file)) && statSync(join(HERE, s.file)).size > MAX_SHOT_BYTES);
  if (NO_OPTIMIZE) {
    say("  （--no-optimize：跳过）");
    return { skipped: true, oversized: overBefore.length };
  }
  const py = findPillowPython();
  if (!py) {
    say("  ⚠ 找不到带 Pillow 的 Python，跳过优化（截图仍可用，只是体积偏大）");
    return { skipped: true, oversized: overBefore.length, reason: "no-pillow" };
  }
  const files = SHOTS.map((s) => join(HERE, s.file)).filter((p) => existsSync(p));
  if (files.length === 0) return { skipped: true, oversized: 0 };
  const out = execFileSync(py, ["-c", PY_OPTIMIZE, String(MAX_SHOT_BYTES), "256,192,128,96,64", ...files], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  for (const line of out.trimEnd().split(/\r?\n/)) say(line);
  // 回填最终字节数与哈希（清单里写的必须是最终文件的实际值）
  for (const s of SHOTS) {
    const p = join(HERE, s.file);
    if (!existsSync(p)) continue;
    const buf = statSync(p).size;
    s.bytes = buf;
    s.sha256 = createHash("sha256").update(readFileSync(p)).digest("hex");
  }
  const still = SHOTS.filter((s) => s.bytes > MAX_SHOT_BYTES);
  say(`  仍超过 ${Math.round(MAX_SHOT_BYTES / 1024)} KB 的截图：${still.length} 张${still.length ? `（${still.map((s) => `${s.id} ${Math.round(s.bytes / 1024)}KB`).join("；")}）` : ""}`);
  const total = SHOTS.reduce((sum, s) => sum + s.bytes, 0);
  say(`  优化后截图合计：${SHOTS.length} 张 / ${total} 字节（${(total / 1024 / 1024).toFixed(2)} MiB）`);
  say("");
  return { skipped: false, oversized: still.length, total };
}

/* ------------------------------------------------------------ 七、收尾 */

function cleanup() {
  try {
    if (SERVER && SERVER.exitCode === null) SERVER.kill();
  } catch {
    /* 忽略 */
  }
  try {
    if (CHROME && CHROME.exitCode === null) CHROME.kill();
  } catch {
    /* 忽略 */
  }
  // 临时 profile 必须删干净：交付目录与临时目录都不留浏览器内部文件。
  try {
    rmSync(PROFILE_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* 文件被占用时忽略；它不在交付目录内 */
  }
}

const MANIFEST_ROWS = [];

function writeManifest(clientInfo, fpBefore, fpAfter) {
  const okRows = SHOTS.filter((s) => s.id).sort((a, b) => a.id.localeCompare(b.id));
  const total = okRows.reduce((sum, s) => sum + s.bytes, 0);
  const lines = [];
  lines.push("# 现场演示素材包 · 截图清单（MANIFEST）");
  lines.push("");
  lines.push("> 本文件由 `docs/demo/pack/capture.mjs` **自动生成**，请勿手改；重跑脚本即刷新。");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("| --- | --- |");
  lines.push(`| 清单生成时间 | ${new Date().toLocaleString("zh-CN", { hour12: false })} |`);
  lines.push(`| 服务地址 | ${BASE}（**本工作区** web/server/server.mjs，端口 ${PORT}） |`);
  lines.push(`| 一致性自检 | \`/landing.css\` 服务返回 ${statSync(join(WEB_DIR, "public", "landing.css")).size}B = 本地磁盘 ${statSync(join(WEB_DIR, "public", "landing.css")).size}B ✅（见捕获报告） |`);
  lines.push(`| 渲染引擎 | ${clientInfo.Browser}（headless=new，真实 Chromium 渲染，非设计稿、非合成） |`);
  lines.push(`| 截图张数 / 总字节 | **${okRows.length} 张 / ${total} 字节（${(total / 1024 / 1024).toFixed(2)} MiB）** |`);
  lines.push(`| PNG 体积处理 | 仅当单张 > ${Math.round(MAX_SHOT_BYTES / 1024)} KB 时：先无损重编码，仍超限再逐步降到 256/192/128/96/64 色板。**不裁剪、不改内容**，吸顶「模拟数据」标识始终在画面内 |`);
  lines.push(`| 重出全部截图 | \`node docs/demo/pack/capture.mjs\` |`);
  lines.push(`| 只重出某一类 | \`node docs/demo/pack/capture.mjs --only=D5-01\` |`);
  lines.push("");
  lines.push("列说明：`对应编号` 是 `docs/demo-script.md` 第六节的素材编号；`时间` 是该 PNG 的**实际截取时刻**（本机时区）；");
  lines.push("`目标 URL` 含全部查询参数；`viewport` 为 `宽×高@设备像素比`；`复现命令` 里的 `--only=` 值即该图 ID。");
  lines.push("");
  lines.push("| 文件 | 对应编号 | 时间 | 目标 URL | viewport | 复现命令 | 图上证明了什么 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of okRows) {
    const demo = demoIdOf(s.id);
    lines.push(
      `| [\`${s.file}\`](./${s.file}) | ${demo} | ${s.time} | \`${s.url}\` | ${s.viewportPx} | \`node docs/demo/pack/capture.mjs --only=${s.id}\` | ${s.note} |`,
    );
  }
  lines.push("");
  lines.push("## 本批截图面对的静态资产（开拍前 / 收工后各校验一次，逐字节 + sha256）");
  lines.push("");
  lines.push(`资产集合指纹：开拍前 \`${fpBefore.combined}\`，收工后 \`${fpAfter.combined}\` —— **${fpBefore.combined === fpAfter.combined ? "一致，截图期间资产未被改动" : "不一致，本批截图不作数"}**`);
  lines.push("");
  lines.push("| URL | 磁盘字节 | sha256 | 服务返回 | 结论 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of fpBefore.rows) {
    lines.push(`| \`${r.url}\` | ${r.local} | \`${r.localSha.slice(0, 16)}\` | ${r.served} B | ${r.ok ? "一致" : "**不一致**"} |`);
  }
  lines.push("");
  lines.push("## 逐图校验记录（脚本记录，非人工填写）");
  lines.push("");
  lines.push("| 文件 | 字节 | sha256（前 16 位） | 整页/视口 |");
  lines.push("| --- | --- | --- | --- |");
  for (const s of okRows) {
    lines.push(`| \`${s.file}\` | ${s.bytes} | \`${s.sha256.slice(0, 16)}\` | ${s.fullPage ? "整页" : "视口"} |`);
  }
  lines.push("");
  writeFileSync(join(HERE, "MANIFEST.md"), lines.join("\n"), "utf8");
  writeFileSync(
    join(HERE, "capture-records.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, browser: clientInfo.Browser, totalBytes: total, shots: okRows }, null, 2),
    "utf8",
  );
  say(`清单：${relative(REPO, join(HERE, "MANIFEST.md"))}（${okRows.length} 张 / ${total} 字节）`);
}

function demoIdOf(id) {
  if (id.startsWith("D10")) return "D10";
  if (id.startsWith("D2")) return "D2";
  if (id.startsWith("D4")) return "D4 / 三候选";
  if (id.startsWith("D5")) return "D5 / 四段呈现";
  if (id.startsWith("E1")) return "失败态 model_error（本包新增 E1）";
  if (id.startsWith("E2")) return "失败态 超时（本包新增 E2）";
  if (id.startsWith("E3")) return "失败态 空/记录失效（本包新增 E3）";
  if (id.startsWith("E4")) return "超预算 OVER_BUDGET（等价 D9 界面侧）";
  return "—";
}

/* ---------------------------------------------------------------- main */

async function main() {
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(join(HERE, "terminal"), { recursive: true });

  await preflight();
  const version = await launchChrome();
  const client = await Client.connect(version.webSocketDebuggerUrl);
  say("二、开始逐场景真实驱动与截图");
  say("");

  const fpBefore = await assetFingerprint("开拍前");
  if (!fpBefore.ok) {
    say("❌ 静态资产校验未通过（开拍前），按纪律不出图。");
    cleanup();
    process.exit(3);
  }
  await scenarioLanding(client);
  await scenarioForm(client);
  await scenarioCandidates(client);
  await scenarioPresentation(client, null, "D5");
  await scenarioFailures(client);
  const measured = await measureFirstScreen(client);
  const fpAfter = await assetFingerprint("收工后");

  const opt = optimizeShots();

  say("================================================================");
  say("七、产出汇总");
  say("================================================================");
  const total = SHOTS.reduce((sum, s) => sum + s.bytes, 0);
  say(`截图 ${SHOTS.length} 张，合计 ${total} 字节（${(total / 1024 / 1024).toFixed(2)} MiB）`);
  say(`单张上限 ${Math.round(MAX_SHOT_BYTES / 1024)} KB：超限 ${opt.oversized} 张`);
  const frozen = fpBefore.combined === fpAfter.combined;
  say(`静态资产指纹：开拍前 ${fpBefore.combined.slice(0, 16)} / 收工后 ${fpAfter.combined.slice(0, 16)}`);
  say(
    frozen
      ? "  → 一致：本批截图全程面对同一份 web/public 资产（截图可复核）"
      : "  → **不一致：截图期间有人改过 web/public，本批截图不作数**",
  );
  if (!frozen) {
    say("  差异明细（收工后）：");
    for (const r of fpAfter.rows) say(`    ${r.url} 磁盘=${r.local}B/${r.localSha.slice(0, 12)}`);
    process.exitCode = 4;
  }
  if (ONLY) {
    say(`（--only=${ONLY} 模式：不覆盖 MANIFEST.md / capture-records.json，避免把完整清单改成子集）`);
  } else {
    writeManifest(version, fpBefore, fpAfter);
  }
  say("");
  say("（说明：本脚本以 mock 模式运行接入层，全程 **0 次模型调用**；未做任何 git 分支操作。）");

  await client.send("Browser.close").catch(() => {});
  await sleep(400);
  cleanup();
  writeFileSync(join(HERE, "terminal", "capture-output.txt"), LOG.join("\n") + "\n", "utf8");
  process.exit(0);
}

main().catch((err) => {
  say("");
  say(`❌ 捕获失败：${err && err.message ? err.message : String(err)}`);
  process.stdout.write(`${err && err.stack ? err.stack : ""}\n`);
  cleanup();
  try {
    mkdirSync(join(HERE, "terminal"), { recursive: true });
    writeFileSync(join(HERE, "terminal", "capture-output.txt"), LOG.join("\n") + `\n❌ 捕获失败：${err && err.message}\n`, "utf8");
  } catch {
    /* 忽略 */
  }
  process.exit(process.exitCode === 3 ? 3 : 2);
});
