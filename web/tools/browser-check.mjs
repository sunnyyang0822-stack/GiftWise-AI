/**
 * 真实浏览器自查（Chrome DevTools Protocol，零依赖）。
 *
 * 目的：补上「未在真实浏览器验证界面」这个缺口。用真实 Chromium 渲染引擎跑完
 * 三步输入 → 三方案对比 → 明确选择 → 四段呈现，并逐屏截图 + 量化检查：
 *   · 横向溢出（长中文 / emoji / 不可断行长串是否撑破版）
 *   · 内容被 overflow:hidden 裁掉
 *   · 触控目标尺寸（< 44px）
 *   · 「模拟数据」标识是否在首屏与吸顶头部可见
 *   · 真实逐字按键输入是否丢焦点/丢光标
 *   · 控制台错误与未捕获异常
 *   · 首屏实际请求数、字节数、有无外部 CDN 依赖
 *
 * 前置：
 *   1. 接入层已启动（默认 http://127.0.0.1:8787）。脚本**跑用例前会先做服务一致性自检**：
 *      比对服务返回的 /landing.css 与 / 字节数与本地 web/public 是否一致。不一致会**非零退出**
 *      （防止静默测到别的工作区的服务）；未显式指定 GW_BASE 且默认端口不可用/不一致时，
 *      会在空闲端口自起一个属于本工作区的独占服务。
 *   2. 一个带远程调试端口的 Chrome：
 *      chrome.exe --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9333 \
 *        --user-data-dir=<临时目录> about:blank
 *
 * 运行： GW_CDP=http://127.0.0.1:9333 node web/tools/browser-check.mjs
 *
 * 产物： .tmp/browser/shots/*.png 与 .tmp/browser/browser-report.json
 * 退出码：存在 FAIL 时为 1；脚本自身异常为 2。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ensureLocalServer, stopOwnServer } from "./server-identity.mjs";

// 注意：未显式指定 GW_BASE 时，下面的 resolveTarget() 可能把 BASE 改指向自起的独占服务，
// 因此这里必须用 let。默认端口仅供「先探一下」使用，绝不复用他人工作区的服务。
let BASE = process.env.GW_BASE || "http://127.0.0.1:8787";
const CDP = process.env.GW_CDP || "http://127.0.0.1:9333";
const OUT_DIR = process.env.GW_OUT || ".tmp/browser";
const SHOT_DIR = join(OUT_DIR, "shots");
mkdirSync(SHOT_DIR, { recursive: true });

const findings = [];
let failed = 0;

function check(name, ok, detail = "") {
  findings.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ↳ ${detail}`}\n`);
}
function note(text) {
  process.stdout.write(`      · ${text}\n`);
}
/* 步骤按钮：优先按稳定 id，缺失时降级为按文案选择（并记录"依赖未就绪"）。
 *
 * 为什么需要：三步流程已确定要改成四步（① 关系+熟悉度 ② 场合 ③ 预算+准备时间 ④ 兴趣+禁忌），
 * 现有按钮文案「下一步：兴趣与风格 / 下一步：排除与补充」**必然消失**，硬编码文案会让整轮
 * 浏览器检查再次崩在第二步。id 属契约面（同 page-probe.mjs 的 DOM 契约清单），文案属产品面。
 *
 * ⚠️ 依赖状态：截至 2026-10-31 01:2x，web/public/index.html 与 web/public/app.js 里
 * **都还没有** #step-next / #step-back（实测 grep 0 命中），故当前走降级分支，
 * 每轮都会打印「依赖未就绪」。前端线补上这两个 id 后，本文件无需再改即自动切换为按 id 选择。
 */
const stepFallbacks = new Set();
async function clickStep(page, which) {
  const id = which === "next" ? "step-next" : "step-back";
  const has = await page.eval(`return !!document.getElementById(${JSON.stringify(id)})`);
  if (has) {
    await page.clickId(id);
    return "id";
  }
  stepFallbacks.add(id);
  await page.click("button", which === "next" ? "下一步" : "上一步");
  return "text";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));



/* --------------------------------------------------------------- CDP 通道 */

class Client {
  constructor(ws) {
    this.ws = ws;
    this.seq = 1;
    this.waiters = new Map();
    this.handlers = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      if (msg.id !== undefined && this.waiters.has(msg.id)) {
        const { resolve, reject } = this.waiters.get(msg.id);
        this.waiters.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}（${msg.error.code}）`));
        else resolve(msg.result);
        return;
      }
      for (const handler of this.handlers) handler(msg);
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`无法连接 CDP：${url}`)), { once: true });
    });
    return new Client(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(fn) {
    this.handlers.push(fn);
  }
}

/* --------------------------------------------------------------- 页面封装 */

/**
 * eval() 接收的是**函数体**：内部自己写 return。这样既能跑表达式也能跑多语句。
 */
class Page {
  constructor(client, sessionId) {
    this.client = client;
    this.sessionId = sessionId;
    this.consoleErrors = [];
    this.requests = [];
    client.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params.type)) {
        this.consoleErrors.push({
          kind: msg.params.type,
          text: (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" "),
        });
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.consoleErrors.push({ kind: "exception", text: d.exception?.description || d.text });
      }
      if (msg.method === "Network.requestWillBeSent") {
        this.requests.push({ url: msg.params.request.url, method: msg.params.request.method, encoded: 0 });
      }
      if (msg.method === "Network.loadingFinished" && this.requests.length > 0) {
        // 简化归因：按完成顺序回填到最近一条未计字节的请求
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
    // 关掉 HTTP 缓存：否则复用调试端口时会拿到旧的 app.js，把已修的问题误报成还在。
    await this.cmd("Network.setCacheDisabled", { cacheDisabled: true });
  }

  async setViewport(width, height, mobile = false) {
    await this.cmd("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    });
    await this.cmd("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
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

  /** 谓词同样传函数体，例如 waitFor("return document.body.textContent.includes('x')")。 */
  async waitFor(body, { timeout = 25000, label = "条件" } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.eval(body)) return true;
      await sleep(200);
    }
    throw new Error(`等待超时：${label}`);
  }

  async goto(url, { settle = 400 } = {}) {
    this.requests.length = 0;
    this.consoleErrors.length = 0;
    await this.cmd("Page.navigate", { url });
    await this.waitFor("return document.readyState === 'complete'", { timeout: 10000, label: "页面加载" });
    // 等 bootstrap 取回 /api/config 并完成首帧渲染
    await this.waitFor("return (document.querySelector('#badges')?.children.length || 0) > 0", {
      timeout: 10000,
      label: "配置加载完成",
    }).catch(() => {});
    await sleep(settle);
  }

  /**
   * 按**稳定 id** 点击，不依赖可见文案。
   * 为什么需要：CTA 文案改过一次（「填写三步需求」→「开始选礼物」）就让整轮检查在第一个
   * 交互点崩掉（退出码 2），于是**移动端视口与四个流程页从未被浏览器验证过**。
   * 文案属于产品面、会继续变；id 属于契约面（见 web/tools/page-probe.mjs 的 DOM 契约清单）。
   */
  async clickId(id) {
    const result = await this.eval(`
      const hit = document.getElementById(${JSON.stringify(id)});
      if (!hit) return { ok: false, available: [...document.querySelectorAll('[id]')].map((n) => n.id).slice(0, 40) };
      const input = hit.querySelector('input');
      (input || hit).click();
      return { ok: true, label: (hit.textContent || '').trim().slice(0, 30) };
    `);
    if (!result.ok) throw new Error(`找不到 id「${id}」；现有 id：${result.available.join(" / ")}`);
    await sleep(80);
    return result;
  }

  /** 按可见文本点击 chip / button / seg 项，走真实事件链。 */
  async click(kind, text) {
    const selector = kind === "seg" ? ".seg button" : kind === "button" ? "button" : kind === "confirm" ? "label.confirm-row" : "label.chip";
    const result = await this.eval(`
      const want = ${JSON.stringify(text)};
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const hit = nodes.find((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().includes(want));
      if (!hit) return { ok: false, available: nodes.map((n) => (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18)) };
      const input = hit.querySelector('input');
      (input || hit).click();
      return { ok: true, label: (hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30) };
    `);
    if (!result.ok) throw new Error(`找不到 ${kind}「${text}」；可选：${result.available.join(" / ")}`);
    await sleep(80);
    return result;
  }

  /** 用真实按键逐字输入（检验重绘是否打断焦点与光标）。 */
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

  /** 程序化赋值 + 派发 input 事件（用于稳定推进流程，不测焦点）。 */
  async setInput(selector, value) {
    const result = await this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false };
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, value: el.value };
    `);
    if (!result.ok) throw new Error(`找不到输入框 ${selector}`);
    await sleep(80);
  }

  async tickConfirm(text) {
    await this.click("confirm", text);
  }

  async screenshot(name, { fullPage = true } = {}) {
    const shot = await this.cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage });
    const file = join(SHOT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    note(`截图 ${file}`);
    return file;
  }

  /** 版面体检。 */
  async layoutAudit() {
    return this.eval(`
      const de = document.documentElement;
      const vw = de.clientWidth;
      const out = {
        viewport: vw,
        docScrollWidth: de.scrollWidth,
        horizontalOverflow: de.scrollWidth > vw + 1,
        offenders: [],
        smallTargets: [],
        clipped: [],
      };
      const describe = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
      const flat = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim();
      for (const el of document.querySelectorAll('body *')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const label = describe(el);
        const text = flat(el);
        if (rect.right > vw + 1 || rect.left < -1) {
          if (out.offenders.length < 8) out.offenders.push({ label, left: Math.round(rect.left), right: Math.round(rect.right), text: text.slice(0, 26) });
        }
        if (el.scrollWidth > el.clientWidth + 1 && style.overflowX === 'hidden') {
          if (out.clipped.length < 8) out.clipped.push({ label, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, text: text.slice(0, 26) });
        }
        const interactive = el.closest('label.chip, label.confirm-row') || (/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName) ? el : null);
        if (interactive) {
          const tRect = interactive.getBoundingClientRect();
          if (tRect.height > 0 && tRect.height < 44 && out.smallTargets.length < 8) {
            out.smallTargets.push({ label: describe(interactive), height: Math.round(tRect.height), text: flat(interactive).slice(0, 18) });
          }
        }
      }
      const seen = new Set();
      out.smallTargets = out.smallTargets.filter((item) => { const k = item.label + item.height + item.text; if (seen.has(k)) return false; seen.add(k); return true; });
      const inFirstScreen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1; };
      const flag = document.querySelector('#mode-flag');
      const heroFlag = document.querySelector('#hero-flag');
      out.modeFlag = flag && !flag.hidden ? { text: flat(flag), top: Math.round(flag.getBoundingClientRect().top), inFirstScreen: inFirstScreen(flag) } : null;
      out.heroFlag = heroFlag && !heroFlag.hidden ? { text: flat(heroFlag).slice(0, 34), inFirstScreen: inFirstScreen(heroFlag) } : null;
      out.banners = [...document.querySelectorAll('#banner-slot .banner')].map((b) => flat(b).slice(0, 26));
      out.innerHeight = Math.round(window.innerHeight);
      return out;
    `);
  }
}

/* --------------------------------------------------------------- 流程步骤 */

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "narrow390", width: 390, height: 844, mobile: true },
  { name: "tiny320", width: 320, height: 640, mobile: true },
];

async function fillStep1(page, { realKeys = false } = {}) {
  await page.click("chip", "追求对象");
  await page.click("chip", "了解不多");
  await page.click("chip", "生日");
  await page.click("chip", "100–200 元");
  if (realKeys) await page.typeKeys('input[aria-label="预算上限金额"]', "180.00");
  else await page.setInput('input[aria-label="预算上限金额"]', "180.00");
  await page.tickConfirm("全量上限");
  await page.click("chip", "3–7 天");
  if (realKeys) await page.typeKeys('input[aria-label="可用准备天数"]', "5");
  else await page.setInput('input[aria-label="可用准备天数"]', "5");
  await page.tickConfirm("完整准备时间");
}

async function fillStep2(page) {
  await page.click("chip", "咖啡与美食");
  await page.click("seg", "明确知道");
  await page.click("chip", "设计与艺术");
  await page.click("chip", "实用型");
  await page.click("chip", "精致但不张扬");
}

async function fillStep3(page) {
  await page.click("chip", "酒类");
  await page.setInput('input[aria-label="明确禁忌的字面词"]', "酒、香水");
  await page.setInput('textarea[aria-label="补充说明"]', "完全虚构的演示请求：希望表达生日祝福，不制造关系压力。");
}

/** 从首屏一路跑到三方案对比页。 */
async function runToRecommendation(page, { step2 = true, step3 = true } = {}) {
  await page.clickId("cta-start");
  await page.waitFor("return document.querySelector('#view').children.length > 0");
  await fillStep1(page);
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('对方的兴趣')", { label: "第二步" });
  if (step2) await fillStep2(page);
  await clickStep(page, "next");
  await page.waitFor("return document.body.textContent.includes('不喜欢或不适合的类型')", { label: "第三步" });
  if (step3) await fillStep3(page);
  await page.click("button", "生成三个方案");
  await page.waitFor(
    "return document.body.textContent.includes('推荐结果') || document.body.textContent.includes('空状态') || !!document.querySelector('.error-box')",
    { label: "三方案对比页", timeout: 30000 },
  );
}

async function open(client, vp, url) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  const page = new Page(client, sessionId);
  await page.init();
  await page.setViewport(vp.width, vp.height, vp.mobile);
  await page.goto(url);
  return { page, targetId };
}

async function close(client, targetId) {
  try {
    await client.send("Target.closeTarget", { targetId });
  } catch {
    /* 忽略 */
  }
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  // 开工前服务身份自检（共用模块 web/tools/server-identity.mjs）：
  // 绝不在不知情的情况下测别的工作区的服务；必要时自起独占端口。
  BASE = await ensureLocalServer(BASE, { explicit: (process.env.GW_BASE || "").trim().length > 0 });
  const version = await (await fetch(`${CDP}/json/version`)).json();
  process.stdout.write(`浏览器：${version.Browser}\n目标站点：${BASE}\n`);
  const client = await Client.connect(version.webSocketDebuggerUrl);

  /* 场景 1：主流程，三种视口 */
  for (const vp of VIEWPORTS) {
    const tag = vp.name;
    const { page, targetId } = await open(client, vp, `${BASE}/`);
    process.stdout.write(`\n=== 主流程 @ ${tag} ${vp.width}×${vp.height} ===\n`);

    const landing = await page.layoutAudit();
    check(`[${tag}] 首屏无横向溢出`, !landing.horizontalOverflow, JSON.stringify(landing.offenders));
    check(`[${tag}] 吸顶「模拟数据」标识已渲染`, !!landing.modeFlag, "#mode-flag 未渲染或被隐藏");
    check(`[${tag}] 吸顶标识在首屏内可见`, !!landing.modeFlag && landing.modeFlag.inFirstScreen, JSON.stringify(landing.modeFlag));
    check(`[${tag}] 首屏数据来源说明可见`, !!landing.heroFlag && landing.heroFlag.inFirstScreen, JSON.stringify(landing.heroFlag));
    await page.screenshot(`01-landing-${tag}`);

    const bytes = page.requests.reduce((sum, r) => sum + (r.encoded || 0), 0);
    const external = page.requests.filter(
      (r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("chrome-extension:") && !r.url.startsWith("devtools:"),
    );
    check(`[${tag}] 首屏无外部/CDN 请求`, external.length === 0, external.map((r) => r.url).join(" "));
    note(`首屏请求 ${page.requests.length} 条，累计 ${bytes} 字节`);

    await page.clickId("cta-start");
    await page.waitFor("return document.querySelector('#view').children.length > 0");
    const step1 = await page.layoutAudit();
    check(`[${tag}] 第一步无横向溢出`, !step1.horizontalOverflow, JSON.stringify(step1.offenders));
    check(`[${tag}] 第一步无 44px 以下触控目标`, step1.smallTargets.length === 0, JSON.stringify(step1.smallTargets));
    const hasColleague = await page.eval("return [...document.querySelectorAll('label.chip')].some((n) => (n.textContent || '').includes('同事'))");
    check(`[${tag}] 界面不出现「同事」`, !hasColleague);
    await page.screenshot(`02-step1-${tag}`);

    // 未确认就点下一步必须被拦住
    await clickStep(page, "next");
    const blocked = await page.eval("return !!document.querySelector('.error-box') || document.body.textContent.includes('请先选择')");
    check(`[${tag}] 未确认预算/天数时被拦住（不静默补默认值）`, blocked);
    check(`[${tag}] 被拦后仍停在第一步`, await page.eval("return document.body.textContent.includes('给谁送、什么关系？')"));

    await fillStep1(page);
    await clickStep(page, "next");
    await page.waitFor("return document.body.textContent.includes('对方的兴趣')", { label: "第二步" });
    const step2 = await page.layoutAudit();
    check(`[${tag}] 第二步无横向溢出`, !step2.horizontalOverflow, JSON.stringify(step2.offenders));
    await page.screenshot(`03-step2-${tag}`);

    await fillStep2(page);
    const confirmedHint = await page.eval("return document.body.textContent.includes('当前会生成 1 条用户事实')");
    check(`[${tag}] 只有「明确知道」计入事实（提示 1 条）`, confirmedHint);
    // 互斥：勾「暂时不知道」后 12 项兴趣全部置灰
    await page.click("chip", "暂时不知道");
    const mutex = await page.eval(`
      const inputs = [...document.querySelectorAll('.interest-row input')];
      return { total: inputs.length, disabled: inputs.filter((i) => i.disabled).length };
    `);
    check(`[${tag}] 「暂时不知道」与 12 项兴趣互斥（全部置灰）`, mutex.total === 12 && mutex.disabled === 12, JSON.stringify(mutex));
    await page.click("chip", "暂时不知道");

    await clickStep(page, "next");
    await page.waitFor("return document.body.textContent.includes('不喜欢或不适合的类型')", { label: "第三步" });
    const step3 = await page.layoutAudit();
    check(`[${tag}] 第三步无横向溢出`, !step3.horizontalOverflow, JSON.stringify(step3.offenders));
    await page.screenshot(`04-step3-${tag}`);

    await fillStep3(page);
    await page.setInput('input[aria-label="待澄清的禁忌"]', "不要看起来像在暗示关系");
    const clarify = await page.eval("return document.body.textContent.includes('INTAKE_CLARIFICATION_REQUIRED')");
    check(`[${tag}] 待澄清禁忌在提交前就说明`, clarify);
    await page.setInput('input[aria-label="待澄清的禁忌"]', "");

    await page.click("button", "生成三个方案");
    await page.waitFor("return document.body.textContent.includes('推荐结果')", { label: "推荐结果", timeout: 30000 });
    const reco = await page.layoutAudit();
    check(`[${tag}] 三方案对比页无横向溢出`, !reco.horizontalOverflow, JSON.stringify(reco.offenders));
    check(`[${tag}] 三方案对比页无 44px 以下触控目标`, reco.smallTargets.length === 0, JSON.stringify(reco.smallTargets));
    const cards = await page.eval(`
      const nodes = [...document.querySelectorAll('#view section.card')];
      const has = (kw) => nodes.filter((n) => (n.textContent || '').includes(kw)).length;
      return {
        check: has('独立检查结果'),
        cost: has('全量估算费用'),
        days: has('准备时间'),
        reason: has('理由'),
        unknown: has('仍未知'),
        notSelected: document.body.textContent.includes('在你明确选择之前'),
        selectedNull: document.body.textContent.includes('尚未选择'),
        mockNotice: document.body.textContent.includes('模拟'),
      };
    `);
    check(`[${tag}] 三个候选都带独立检查结果/费用/天数/理由/未知`, cards.check === 3 && cards.cost === 3 && cards.days >= 3 && cards.reason >= 3 && cards.unknown >= 3, JSON.stringify(cards));
    check(`[${tag}] 推荐阶段显示「尚未选择」`, cards.selectedNull);
    check(`[${tag}] 未选择状态说明存在`, cards.notSelected);
    check(`[${tag}] 推荐页仍带模拟数据标识`, cards.mockNotice);
    await page.screenshot(`05-recommend-${tag}`);

    await page.click("button", "选择这个方案");
    await page.waitFor("return document.body.textContent.includes('选择后复核')", { label: "四段呈现页", timeout: 30000 });
    const pres = await page.layoutAudit();
    check(`[${tag}] 呈现页无横向溢出`, !pres.horizontalOverflow, JSON.stringify(pres.offenders));
    const order = await page.eval("return [...document.querySelectorAll('#view h2.card__title')].map((h) => h.textContent.replace(/\\s+/g, ' ').trim()).filter((t) => /^[①②③④]/.test(t))");
    check(
      `[${tag}] 四段顺序固定：①风格与配色 ②包装材料与步骤 ③贺卡正文与装饰物 ④赠送时机、方式与话术`,
      order.length === 4 && order[0].includes("风格与配色") && order[1].includes("包装材料与步骤") && order[2].includes("贺卡正文与装饰物") && order[3].includes("赠送时机、方式与话术"),
      JSON.stringify(order),
    );
    const summary = await page.eval("const t = document.body.textContent; return t.includes('复核结论') && (t.includes('not_verified') || t.includes('未核实'))");
    check(`[${tag}] 呈现页含复核小结与未核实声明`, summary);
    await page.screenshot(`06-presentation-${tag}`);
    check(`[${tag}] 全流程无控制台错误/警告`, page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors.slice(0, 3)));
    await close(client, targetId);
  }

  /* 场景 2：真实逐字按键输入的焦点与光标 */
  {
    const { page, targetId } = await open(client, VIEWPORTS[0], `${BASE}/`);
    process.stdout.write(`\n=== 真实逐字按键输入 ===\n`);
    await page.clickId("cta-start");
    await page.click("chip", "追求对象");
    await page.click("chip", "生日");
    await page.click("chip", "100–200 元");
    await page.typeKeys('input[aria-label="预算上限金额"]', "180.00");
    const budget = await page.eval(`
      const el = document.querySelector('input[aria-label="预算上限金额"]');
      return { value: el ? el.value : null, focused: !!el && document.activeElement === el, caret: el ? el.selectionStart : null };
    `);
    check("真实逐字输入预算后内容完整（180.00）", budget.value === "180.00", `value=${budget.value} focused=${budget.focused} caret=${budget.caret}`);
    check("真实逐字输入预算后焦点仍在该输入框", budget.focused === true, JSON.stringify(budget));
    await page.click("chip", "3–7 天");
    await page.typeKeys('input[aria-label="可用准备天数"]', "5");
    const days = await page.eval(`
      const el = document.querySelector('input[aria-label="可用准备天数"]');
      return { value: el ? el.value : null, focused: !!el && document.activeElement === el };
    `);
    check("真实逐字输入天数后值正确且焦点保留", days.value === "5" && days.focused === true, JSON.stringify(days));
    await page.screenshot("07-real-keyboard-input", { fullPage: false });
    await close(client, targetId);
  }

  /* 场景 3：压力文案（超长中文 + emoji + 不可断行长串） */
  for (const vp of [VIEWPORTS[0], VIEWPORTS[1]]) {
    const { page, targetId } = await open(client, vp, `${BASE}/?demo=stress`);
    const tag = `stress-${vp.name}`;
    process.stdout.write(`\n=== 压力文案 @ ${tag} ===\n`);
    await runToRecommendation(page);
    await page.waitFor("return document.body.textContent.includes('推荐结果')", { label: "压力三方案" });
    const audit = await page.layoutAudit();
    check(`[${tag}] 超长候选名/描述不撑破版`, !audit.horizontalOverflow, JSON.stringify(audit.offenders));
    check(`[${tag}] 长文本未被 overflow:hidden 裁掉`, audit.clipped.length === 0, JSON.stringify(audit.clipped));
    check(`[${tag}] 压力页无 44px 以下触控目标`, audit.smallTargets.length === 0, JSON.stringify(audit.smallTargets));
    await page.screenshot(`08-stress-recommend-${vp.name}`);
    await page.click("button", "选择这个方案");
    await page.waitFor("return document.body.textContent.includes('选择后复核')", { label: "压力呈现" });
    const audit2 = await page.layoutAudit();
    check(`[${tag}] 超长呈现文案不撑破版`, !audit2.horizontalOverflow, JSON.stringify(audit2.offenders));
    check(`[${tag}] 超长呈现文案未被裁掉`, audit2.clipped.length === 0, JSON.stringify(audit2.clipped));
    await page.screenshot(`09-stress-presentation-${vp.name}`);
    check(`[${tag}] 压力路径无控制台错误`, page.consoleErrors.length === 0, JSON.stringify(page.consoleErrors.slice(0, 3)));
    await close(client, targetId);
  }

  /* 场景 4：失败与部分通过状态 */
  for (const [demo, expectSelect] of [["model_error", 0], ["partial_fail", 2]]) {
    const { page, targetId } = await open(client, VIEWPORTS[1], `${BASE}/?demo=${demo}`);
    process.stdout.write(`\n=== 状态：${demo} ===\n`);
    await runToRecommendation(page);
    const state = await page.eval(`
      const buttons = [...document.querySelectorAll('#view button')];
      return {
        text: document.querySelector('#view').textContent.replace(/\\s+/g, ' ').trim().slice(0, 160),
        selectButtons: buttons.filter((b) => (b.textContent || '').includes('选择这个方案')).length,
        failHint: document.body.textContent.includes('失败项不可选择'),
        chinese: /[\\u4e00-\\u9fff]/.test(document.body.textContent),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    `);
    check(`[状态:${demo}] 选择按钮数量符合预期`, state.selectButtons === expectSelect, JSON.stringify(state));
    check(`[状态:${demo}] 中文状态说明`, state.chinese && state.text.length > 10, state.text);
    check(`[状态:${demo}] 无横向溢出`, !state.overflow);
    if (demo === "partial_fail") check(`[状态:${demo}] 失败项给出「不可选择」解释`, state.failHint);
    await page.screenshot(`10-state-${demo}`);
    await close(client, targetId);
  }

  /* 场景 5：空状态（旧记录失效） */
  {
    const { page, targetId } = await open(client, VIEWPORTS[0], `${BASE}/`);
    process.stdout.write(`\n=== 状态：空（记录失效） ===\n`);
    await page.eval("sessionStorage.setItem('gw_last_run', 'gw-not-exist')");
    await page.goto(`${BASE}/`);
    const empty = await page.eval("return document.body.textContent.includes('上一次的任务记录已不存在')");
    check("[状态:空] 旧记录失效时给出中文空状态", empty);
    await page.screenshot("11-empty-state");
    await close(client, targetId);
  }

  /* 场景 6：加载中与超时（服务端延迟 45 秒 > 客户端 20 秒） */
  {
    const { page, targetId } = await open(client, VIEWPORTS[0], `${BASE}/?demo=slow`);
    process.stdout.write(`\n=== 状态：加载中与超时 ===\n`);
    await page.clickId("cta-start");
    await fillStep1(page);
    await clickStep(page, "next");
    await page.waitFor("return document.body.textContent.includes('对方的兴趣')", { label: "第二步" });
    await clickStep(page, "next");
    await page.waitFor("return document.body.textContent.includes('不喜欢或不适合的类型')", { label: "第三步" });
    await fillStep3(page);
    await page.click("button", "生成三个方案");
    await sleep(1200);
    const loading = await page.eval("return !!document.querySelector('.spinner') && document.body.textContent.includes('正在')");
    check("[状态:超时] 请求期间显示中文加载中", loading);
    await page.screenshot("12-loading", { fullPage: false });
    // 预算 45 秒（原 32 秒）：客户端按 /api/config 的 client_timeout_ms=20000 中止请求，
    // 约 20 秒后就会出现「请求超时」。32 秒的余量在本机并行跑多条线（docker 构建等）时实测不够，
    // verify_all 因此把 browser_check 判成 rc=2（等待超时）。**断言内容未变**：
    // 真的不出现「请求超时」仍然会失败，这里放宽的只是等待预算。
    await page.waitFor("return document.body.textContent.includes('请求超时')", { timeout: 45000, label: "超时状态" });
    const timeoutState = await page.eval(
      // 本断言当前**如实失败**，原因是真实产品缺陷、不是文案过时：
      // 截图 .tmp/browser/shots/13-timeout.png 显示超时卡片只渲染了标题、两行说明与「错误码」框，
      // **底部两个按钮（「重试上一次动作」「回到表单」）没有渲染出来**——而 app.js:1190-1198 的
      // state.timeout 分支里明明是传了这两个按钮的，疑似 stateView() 的第 3 个参数未渲染。
      // 说明：我一度以为「未标记为通过」只存在于呈现阶段超时文案而放宽过本断言，那是**误判**
      // （该句实际由字符串拼接渲染出来），已回退为原始文案，不替产品缺陷打掩护。
      "return document.body.textContent.includes('未标记为通过') && [...document.querySelectorAll('#view button')].some((b) => b.textContent.includes('重试'))",
    );
    check("[状态:超时] 超时后给出中文说明与重试入口", timeoutState);
    await page.screenshot("13-timeout");
    await close(client, targetId);
  }

  if (stepFallbacks.size > 0) {
    note(
      `⚠ 依赖未就绪：web/public 中缺少稳定 id ${[...stepFallbacks].join(" / ")}，` +
        "步骤按钮已降级为按文案选择；四步化后该降级会失效（需前端线补 id）",
    );
  }
  writeFileSync(join(OUT_DIR, "browser-report.json"), JSON.stringify({ base: BASE, browser: version.Browser, failed, findings }, null, 2));
  process.stdout.write(`\n合计 ${findings.length} 项检查，失败 ${failed} 项；截图目录 ${SHOT_DIR}\n`);
  client.ws.close();
  stopOwnServer();
  // 不用裸 process.exit()：Windows 上 stdout 到文件/管道是异步的，退出会丢掉尚未刷出的尾部输出。
  // 实测出现过一次全绿运行（退出码 0、100 项全过）的报告里却缺了最后一条 PASS 与「合计」行，
  // 看起来像"某项检查没跑"；失败运行时同理可能丢掉尾部 FAIL 行（正是"假绿"的来源）。
  // 用一次空写回调把退出排在所有已排队输出之后，既不截断也不会挂住进程。
  process.stdout.write("", () => process.exit(failed === 0 ? 0 : 1));
}

main().catch((err) => {
  process.stderr.write(`浏览器自查异常：${err && err.stack ? err.stack : String(err)}\n`);
  process.stderr.write("", () => process.exit(2));
});
