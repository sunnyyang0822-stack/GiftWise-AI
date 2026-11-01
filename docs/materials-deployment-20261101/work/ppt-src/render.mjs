// 用无头 Edge（CDP 9342）把每页 HTML 截成 1920×1080 的 PNG（scale 可调）
import { writeFile, mkdir } from "node:fs/promises";
const pages = process.argv.slice(2);
const SCALE = +(process.env.SCALE || 1);
await mkdir("E:/黑客松/.tools/ppt/deck/out", { recursive: true });
const v = await (await fetch(`http://127.0.0.1:${process.env.CDP || 9342}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let seq = 1; const w = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m.result || m); w.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const id = seq++; w.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId); const wait = ms => new Promise(r => setTimeout(r, ms));
await S("Runtime.enable"); await S("Network.setCacheDisabled", { cacheDisabled: true });
await S("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: SCALE, mobile: false });
for (const p of pages) {
  await S("Page.navigate", { url: `http://127.0.0.1:8921/${p}.html` });
  for (let i = 0; i < 40; i++) { await wait(250); const r = await S("Runtime.evaluate", { expression: "document.body?.dataset.ready", returnByValue: true }); if (r.result?.value) break; }
  await wait(1200);
  const errs = await S("Runtime.evaluate", { expression: "[...document.querySelectorAll('[data-icon]')].length", returnByValue: true });
  const { data } = await S("Page.captureScreenshot", { format: "png" });
  await writeFile(`E:/黑客松/.tools/ppt/deck/out/${p}.png`, Buffer.from(data, "base64"));
  console.log(p, "unhydrated icons:", errs.result?.value);
}
await send("Target.closeTarget", { targetId }); ws.close();
