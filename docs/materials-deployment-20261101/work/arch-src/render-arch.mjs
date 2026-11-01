// 架构文档：逐页截图自检 + 打印 PDF。自带静态服务（本目录），连接无头 Edge（CDP 端口由环境变量 CDP 指定）。
// 用法：CDP=9455 PDF_OUT=<输出.pdf> OUT=<截图目录> node render-arch.mjs
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || join(HERE, "out");
const PDF = process.env.PDF_OUT || join(HERE, "out", "GiftWise-AI-系统架构设计.pdf");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml" };
const srv = createServer(async (q, s) => { const p = normalize(join(HERE, decodeURIComponent(new URL(q.url, "http://x").pathname))); if (!p.startsWith(HERE)) { s.writeHead(403); return s.end(); } try { const b = await readFile(p); s.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" }); s.end(b); } catch { s.writeHead(404); s.end(); } });
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const PORT = srv.address().port;
await mkdir(OUT, { recursive: true });
const v = await (await fetch(`http://127.0.0.1:${process.env.CDP || 9455}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let seq = 1; const w = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m.result || m); w.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const id = seq++; w.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId); const wait = ms => new Promise(r => setTimeout(r, ms));
const ev = async expr => (await S("Runtime.evaluate", { expression: expr, returnByValue: true })).result?.value;
await S("Runtime.enable"); await S("Network.setCacheDisabled", { cacheDisabled: true });
await S("Emulation.setDeviceMetricsOverride", { width: 900, height: 1200, deviceScaleFactor: 2, mobile: false });
await S("Page.navigate", { url: `http://127.0.0.1:${PORT}/architecture.html` });
for (let i = 0; i < 60; i++) { await wait(250); if (await ev("document.body?.dataset.ready")) break; }
await wait(1000);
// 自检：未替换图标、溢出页面/父容器的元素
const report = await ev(`(() => {
  const out = { unhydrated: document.querySelectorAll('[data-icon],[data-ext]').length, overflow: [] };
  document.querySelectorAll('.page').forEach((pg, i) => {
    const pr = pg.getBoundingClientRect();
    pg.querySelectorAll('*').forEach(el => {
      if (el.closest('.aura,.glow,.riser') || el.classList.contains('ribbon')) return;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
      if (r.right > pr.right + 1 || r.bottom > pr.bottom + 1 || r.left < pr.left - 1 || r.top < pr.top - 1)
        out.overflow.push((i + 1) + ': ' + el.tagName + '.' + el.className + ' ' + (el.textContent || '').trim().slice(0, 24));
      if (el.scrollHeight > el.clientHeight + 2 && getComputedStyle(el).overflow === 'hidden' && !el.classList.contains('page'))
        out.overflow.push((i + 1) + ': clipped ' + el.tagName + '.' + el.className);
    });
  });
  return out;
})()`);
console.log(JSON.stringify(report, null, 1));
const n = await ev("document.querySelectorAll('.page').length");
for (let i = 0; i < n; i++) {
  const box = await ev(`(() => { const r = document.querySelectorAll('.page')[${i}].getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);
  const { data } = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 } });
  await writeFile(`${OUT}/p${String(i + 1).padStart(2, "0")}.png`, Buffer.from(data, "base64"));
}
await S("Emulation.setEmulatedMedia", { media: "print" });
// 大文件用流式读回，避免单条 CDP 消息过大
const pdf = await S("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, transferMode: "ReturnAsStream" });
const parts = [];
for (;;) { const c = await S("IO.read", { handle: pdf.stream, size: 1 << 20 }); parts.push(Buffer.from(c.data, c.base64Encoded ? "base64" : "utf8")); if (c.eof) break; }
await S("IO.close", { handle: pdf.stream });
await writeFile(PDF, Buffer.concat(parts));
console.log("pages", n, "pdf", PDF);
await send("Target.closeTarget", { targetId }); ws.close(); srv.close();
