import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createResultViews } from "../public/js/results-view.js";

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.parent = null; this.style = { setProperty() {} }; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === "class") this.className = String(value); if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  addEventListener(key, fn) { this.events[key] = fn; }
  append(...children) { for (const child of children.filter(x => x != null && x !== false)) { this.children.push(child); if (child instanceof Element) child.parent = this; } }
  replaceChildren(...children) { for (const child of this.children) if (child instanceof Element) child.parent = null; this.children = []; this.append(...children); }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(x => typeof x === "string" ? x : x.textContent).join(""); }
  get isConnected() { return this.tagName === "main" || Boolean(this.parent?.isConnected); }
  get disabled() { return Object.hasOwn(this.attrs, "disabled"); }
  querySelectorAll(selector) { const match = node => selector.startsWith(".") ? (node.className || "").split(/\s+/).includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap(child => child instanceof Element ? [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
globalThis.location = { origin: "http://127.0.0.1:8911" };
const el = (tag, props = {}, children = []) => { const node = new Element(tag); for (const [key, value] of Object.entries(props)) { if (value == null || value === false) continue; if (key === "text") node.textContent = value; else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value); } node.append(...[].concat(children)); return node; };
const candidateIds = ["c1", "c2", "c3"];
function report(runId = "run-1") {
  return { recommendation_run_id: runId, status: "passed", candidates: candidateIds.map(id => ({ id, name: `方案${id}`, description: "受控候选文字", reason: "理由", unknowns: [] })),
    selectable_candidate_ids: [...candidateIds], validation: { candidate_results: candidateIds.map(id => ({ id, passed: true, errors: [], warnings: [] })) },
    retrieval: { products: [], references: [], evidence_id: "keep-existing-audit" }, media: { status: "unavailable", selected: null, candidates: candidateIds.map(candidate_id => ({ candidate_id, status: "pending", reference_id: null, image: null })) } };
}
// 协议夹具，不是真实采集；图片关联与真实字节解码另用C最终批次复核。
function snapshot(statuses = ["ready", "ready", "ready"], runId = "run-1") {
  const data = report(runId);
  data.media.candidates = candidateIds.map((candidate_id, i) => {
    const status = statuses[i], imageId = String(i + 1).repeat(32), reference_id = `ref_${imageId}`;
    if (status !== "ready") return { candidate_id, status, reference_id: null, image: null };
    data.retrieval.references.push({ reference_id, image_id: imageId, image_kind: "reference_image", reference_kind: "public_reference", source_url: `https://content.example/${candidate_id}`, observed_at: "2026-10-31T18:00:00Z", image_validation: { ok: true } });
    return { candidate_id, status, reference_id, image: { id: imageId, version: imageId, kind: "reference_image", url: `/api/reference/images/${imageId}`, alt: `方案${candidate_id}参考图` } };
  });
  return { ok: true, status: 200, data };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup(fetcher = async () => snapshot()) {
  let seq = 0, elapsed = 0, fullRenders = 0;
  const timers = new Map(), calls = [], selected = [];
  const state = { inFlow: true, requestVersion: 1, report: report(), busy: false };
  const ctx = { el, state, selectCandidate: id => selected.push(id), resetToForm() {}, stateView: () => ({ body: [], actions: [] }), render() { fullRenders++; }, apiFetch: async (...args) => { calls.push(args); return fetcher(...args); }, setTimeout: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const views = createResultViews(ctx);
  let root;
  const mount = () => { const result = views.renderRecommendation(); root = el("main", {}, [...result.body, ...result.actions]); return root; };
  mount();
  return { state, views, calls, timers, selected, mount, get root() { return root; }, get elapsed() { return elapsed; }, get fullRenders() { return fullRenders; }, async next() { const next = timers.entries().next().value; if (!next) return; timers.delete(next[0]); elapsed += next[1].delay; next[1].fn(); await flush(); } };
}
const cards = h => h.root.querySelectorAll(".gift-choice");
const choose = h => cards(h).forEach(card => { const button = card.querySelector(".suggest-row").querySelector("button"); assert.equal(button.disabled, false); button.events.click(); });

test("逐卡pending只显示自然等待，三条文字和选择立即可用，不等GET", () => {
  const h = setup();
  assert.equal(cards(h).length, 3); assert.equal(h.root.querySelectorAll("img").length, 0);
  assert.equal(h.root.querySelectorAll(".candidate-image-status").length, 3);
  assert.match(h.root.textContent, /配图准备中/); assert.doesNotMatch(h.root.textContent, /轮询|退避|task_id|180秒|SKU/);
  choose(h); assert.deepEqual(h.selected, candidateIds); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 1);
});

test("部分ready到三图只补图片位，已加载图片与文字按钮DOM不重建，也不覆盖可选性", async () => {
  let count = 0;
  const h = setup(async () => { const response = snapshot(++count === 1 ? ["ready", "pending", "pending"] : undefined); response.data.selectable_candidate_ids = []; response.data.candidates = []; return response; });
  const oldReport = h.state.report, candidates = oldReport.candidates, validation = oldReport.validation;
  const titles = cards(h).map(c => c.querySelector(".card__title")), buttons = cards(h).map(c => c.querySelector(".suggest-row").querySelector("button"));
  await h.next(); assert.equal(h.root.querySelectorAll("img").length, 1);
  const firstImage = cards(h)[0].querySelector("img");
  await h.next(); assert.equal(h.root.querySelectorAll("img").length, 3);
  assert.equal(cards(h)[0].querySelector("img"), firstImage);
  cards(h).forEach((card, i) => { assert.equal(card.querySelector(".card__title"), titles[i]); assert.equal(card.querySelector(".suggest-row").querySelector("button"), buttons[i]); assert.equal(card.querySelectorAll("img").length, 1); assert.equal(card.querySelector(".media-kind").textContent, "参考图片"); });
  assert.equal(h.state.report, oldReport); assert.equal(oldReport.candidates, candidates); assert.equal(oldReport.validation, validation);
  assert.deepEqual(oldReport.selectable_candidate_ids, candidateIds); assert.deepEqual(oldReport.retrieval.products, []); assert.equal(oldReport.retrieval.evidence_id, "keep-existing-audit");
  assert.equal(oldReport.media.status, "unavailable"); assert.equal(oldReport.media.selected, null); assert.equal(h.fullRenders, 0); assert.equal(h.timers.size, 0);
});

test("重复render与在途响应复用一个只读GET，终态重绘不再排程", async () => {
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  h.mount(); h.mount(); assert.equal(h.timers.size, 1); await h.next();
  h.mount(); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
  resolve(snapshot()); await flush(); h.mount(); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls[0], ["/api/runs/run-1", null, { timeoutMs: 10000, track: false }]);
});

test("run不符、候选错绑/重槽、无验证或AI图的快照拒绝合并", async () => {
  for (const alter of [d => { d.recommendation_run_id = "other-owner-run"; }, d => { d.media.candidates[0].candidate_id = "wrong"; }, d => { d.media.candidates.push(d.media.candidates[0]); }, d => { d.media.candidates[0].image.kind = "ai_illustration"; }, d => { d.retrieval.references[0].image_validation.ok = false; }, d => { d.retrieval.references.push(d.retrieval.references[0]); }, d => { d.media.candidates[0].image.url = "https://outside.example/image.jpg"; }]) {
    const h = setup(async () => { const response = snapshot(); alter(response.data); return response; });
    const previous = h.state.report.media; await h.next();
    assert.equal(h.state.report.media, previous); assert.equal(h.root.querySelectorAll("img").length, 0); assert.equal(h.timers.size, 0);
    assert.match(h.root.textContent, /暂时无法更新配图/); assert.ok(h.state.report.media.candidates.every(c => c.status === "pending"));
    choose(h);
  }
});

test("读取超时不改pending或可选性；手动刷新仍只读且重复点击不并发", async () => {
  let resolve;
  const h = setup(async () => { if (h.calls.length === 1) throw Object.assign(new Error("timeout"), { code: "CLIENT_TIMEOUT" }); return new Promise(done => { resolve = done; }); });
  await h.next(); assert.equal(h.timers.size, 0); choose(h);
  const refresh = h.root.querySelectorAll("button").find(b => b.textContent === "刷新配图");
  refresh.events.click(); refresh.events.click(); assert.equal(h.calls.length, 2);
  assert.ok(h.root.querySelectorAll("button").some(b => b.textContent === "正在更新配图" && b.disabled));
  resolve(snapshot()); await flush(); assert.equal(h.root.querySelectorAll("img").length, 3);
  assert.ok(h.calls.every(args => args[0] === "/api/runs/run-1" && args[1] === null && args[2].track === false));
});

test("owner404或TTL失效停止等待，不显示错图也不再次请求", async () => {
  for (const status of [401, 403, 404, 410]) {
    const h = setup(async () => ({ ok: false, status, data: { status: "error" } }));
    await h.next(); h.mount(); await h.next();
    assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0); assert.equal(h.root.querySelectorAll("img").length, 0);
    assert.ok(!h.root.querySelectorAll("button").some(b => b.textContent === "刷新配图"));
    assert.ok(h.state.report.media.candidates.every(c => c.status === "pending")); choose(h);
  }
});

test("覆盖180秒后最后只读一次并停，仍pending保持真实等待且可手动读终态", async () => {
  let ready = false;
  const h = setup(async () => snapshot(ready ? undefined : ["pending", "pending", "pending"]));
  let iterations = 0; while (h.timers.size && iterations++ < 50) await h.next();
  assert.equal(h.elapsed, 180000); assert.equal(h.calls.length, 25); assert.equal(h.timers.size, 0);
  assert.match(h.root.textContent, /配图还在准备/); assert.equal(h.root.querySelectorAll("img").length, 0);
  assert.ok(h.state.report.media.candidates.every(c => c.status === "pending"));
  h.mount(); assert.equal(h.timers.size, 0); ready = true;
  h.root.querySelectorAll("button").find(b => b.textContent === "刷新配图").events.click(); await flush();
  assert.equal(h.root.querySelectorAll("img").length, 3); assert.equal(h.timers.size, 0);
});

test("离开清理定时器，切换run后旧在途响应不能补到新卡或旧report", async () => {
  const waiting = setup(); waiting.state.inFlow = false; waiting.views.stopRecommendationMediaPoll(); await waiting.next(); assert.equal(waiting.calls.length, 0);
  let resolve;
  const h = setup(() => new Promise(done => { resolve = done; }));
  const old = h.state.report, original = old.media; await h.next(); h.views.stopRecommendationMediaPoll();
  h.state.report = report("new-run"); h.state.requestVersion++; h.mount();
  resolve(snapshot()); await flush();
  assert.equal(old.media, original); assert.equal(h.state.report.recommendation_run_id, "new-run"); assert.equal(h.root.querySelectorAll("img").length, 0);
  assert.equal(h.timers.size, 1); h.views.stopRecommendationMediaPoll(); assert.equal(h.timers.size, 0);
});

test("进入指南、requestVersion变化或冻结候选变化均拒绝旧响应", async () => {
  for (const alter of [h => { h.state.presentation = {}; }, h => { h.state.requestVersion++; }, h => { h.state.report.candidates[0].id = "replaced"; }]) {
    let resolve; const h = setup(() => new Promise(done => { resolve = done; }));
    const original = h.state.report.media; await h.next(); alter(h); resolve(snapshot()); await flush();
    assert.equal(h.state.report.media, original); assert.equal(h.root.querySelectorAll("img").length, 0); assert.equal(h.timers.size, 0);
  }
});

test("新run没有候选时也立即清理旧等待，不等旧timer到期", async () => {
  const h = setup(); h.state.report = report("new-empty-run"); h.state.report.candidates = [];
  h.mount(); assert.equal(h.timers.size, 0); await h.next(); assert.equal(h.calls.length, 0);
});

test("最后一读在途离开再返回也不突破已耗尽窗口或产生零延迟查询", async () => {
  let resolve;
  const h = setup(async () => h.calls.length < 25 ? snapshot(["pending", "pending", "pending"]) : new Promise(done => { resolve = done; }));
  for (let i = 0; i < 25; i++) await h.next();
  assert.equal(h.elapsed, 180000); assert.equal(h.calls.length, 25);
  h.views.stopRecommendationMediaPoll(); h.mount();
  assert.equal(h.timers.size, 0); assert.match(h.root.textContent, /配图还在准备/);
  resolve(snapshot()); await flush();
  assert.equal(h.root.querySelectorAll("img").length, 0, "取消的末次读不能越过epoch更新页面");
});

test("unavailable终态不伪造图片或加载，三个候选仍可选择", async () => {
  const h = setup(async () => snapshot(["ready", "unavailable", "ready"])); await h.next();
  assert.equal(h.timers.size, 0); assert.equal(cards(h).length, 3); assert.equal(h.root.querySelectorAll("img").length, 2);
  assert.equal(h.root.querySelectorAll(".candidate-image-status").length, 0); choose(h);
});

test("app选前离开入口与既有选后轮询独立清理", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /if \(!state.report \|\| state.presentation \|\| !state.inFlow \|\| state.busy \|\| state.encourage \|\| state.timeout \|\| state.error\) resultViews\?\.stopRecommendationMediaPoll\(\);/);
  assert.match(source, /resultViews\?\.stopMediaPoll\(\)/);
});

test("合并后骨架导出和选前清理入口共存，加载骨架不启动参考图轮询", () => {
  const h = setup(); h.views.stopRecommendationMediaPoll();
  for (const name of ["renderRecommendationLoading", "renderPresentationLoading", "stopMediaPoll", "stopRecommendationMediaPoll"]) assert.equal(typeof h.views[name], "function", name);
  const recommendation = h.views.renderRecommendationLoading();
  const before = el("main", {}, recommendation.body);
  assert.equal(before.querySelectorAll(".candidate-grid--loading").length, 1);
  assert.equal(before.querySelectorAll("img").length, 0);
  const presentation = h.views.renderPresentationLoading("c2");
  const after = el("main", {}, presentation.body);
  assert.match(after.textContent, /方案c2/);
  assert.equal(after.querySelectorAll(".present-layout--loading").length, 1);
  assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
});
