// font-fix 探针：新建自己的 CDP target，记录字体网络请求，读取手写体元素实际渲染字体；结束只关闭自己的 target。
// 用法：node fontprobe-ff.mjs <url> <mode: home|dynamic>
const url = process.argv[2]; const mode = process.argv[3] || "dynamic";
const version = await (await fetch("[REDACTED:LOCAL_TEST_ORIGIN]/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let seq = 1; const w = new Map(); const fontReqs = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent" && /\/fonts\//.test(m.params.request.url)) fontReqs.push(m.params.request.url.replace(/^.*\/fonts\//, ""));
  if (m.id && w.has(m.id)) { w.get(m.id)(m.result || m); w.delete(m.id); } };
const send = (method, params = {}, sessionId) => new Promise(r => { const id = seq++; w.set(id, r); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
try {
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Network.enable"); await S("Network.setCacheDisabled", { cacheDisabled: true });
  await S("Page.navigate", { url }); await new Promise(r => setTimeout(r, 3000));
  await S("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
  console.log("font requests after load:", JSON.stringify(fontReqs));
  const samples = [["gw-understand__quote", "「别送香水、衣服和铁链手链」"], ["gw-understand__quote", "「不要杭州城市纪念品，他听不懂」"], ["media-label-text", "丝带系成蝴蝶结"], ["media-notes", "卡片插在左侧，铁盒除险后再包"], ["gw-parse-block__quote", "君子之交，幻想与言听计从"], ["hand-note", "好好送出去吧 ① → 2 ≈ 3"]];
  let selector;
  if (mode === "dynamic") {
    await S("Runtime.evaluate", { expression: `(()=>{const box=document.createElement('div');box.id='probe';${JSON.stringify(samples)}.forEach(([c,t])=>{const p=document.createElement(c==='media-notes'?'li':'p');p.className=c;p.style.fontFamily='var(--gw-font-hand)';p.textContent=t;box.append(p)});document.body.prepend(box);return document.fonts.ready.then(()=>1)})()`, awaitPromise: true });
    await new Promise(r => setTimeout(r, 2500));
    await S("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
    console.log("font requests after inject:", JSON.stringify(fontReqs));
    selector = "#probe > *";
  } else selector = ".lp-hand, .lp-sign, .lp-hero__sub, .lp-note, .lp-step__no, .lp-closing__hand, .lp-footer__hand";
  await S("DOM.enable"); await S("CSS.enable");
  const { root } = await S("DOM.getDocument", { depth: 1 });
  const { nodeIds } = await S("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
  for (const id of nodeIds) {
    const t = (await S("DOM.getOuterHTML", { nodeId: id })).outerHTML.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
    const r = await S("CSS.getPlatformFontsForNode", { nodeId: id });
    console.log(`${t} => ${r.fonts.map(f => `${f.familyName}:${f.glyphCount}`).join(" + ")}`);
  }
} finally { await send("Target.closeTarget", { targetId }); ws.close(); }
