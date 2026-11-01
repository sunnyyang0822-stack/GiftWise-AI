// 用无头 Edge 把 SVG 渲染成 2× PNG（不拉伸、不裁切）。用法：CDP=9455 node render_png.mjs <in.svg> <out.png>
import { readFileSync, writeFileSync } from "node:fs";
const [inp, outp] = process.argv.slice(2);
const svg = readFileSync(inp, "utf8");
const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/).map(Number);
const v = await (await fetch(`http://127.0.0.1:${process.env.CDP || 9455}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let seq = 1; const m = new Map(); ws.onmessage = e => { const d = JSON.parse(e.data); if (d.id && m.has(d.id)) { m.get(d.id)(d.result || d); m.delete(d.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const id = seq++; m.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (a, b) => send(a, b, sessionId);
await S("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: false });
const { frameTree } = await S("Page.getFrameTree");
await S("Page.setDocumentContent", { frameId: frameTree.frame.id, html: `<!doctype html><html><body style="margin:0">${svg}</body></html>` });
await new Promise(r => setTimeout(r, 1200));
const { data } = await S("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
writeFileSync(outp, Buffer.from(data, "base64")); console.log("png", outp, w * 2, h * 2);
await send("Target.closeTarget", { targetId }); ws.close();
