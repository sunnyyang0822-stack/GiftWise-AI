import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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
  replaceWith(next) { const parent = this.parent; if (!parent) return; parent.children[parent.children.indexOf(this)] = next; next.parent = parent; this.parent = null; }
  querySelectorAll(selector) { const match = node => selector.startsWith(".") ? (node.className || "").split(/\s+/).includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap(child => child instanceof Element ? [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
globalThis.location = { origin: "http://127.0.0.1:8911" };
const el = (tag, props = {}, children = []) => { const node = new Element(tag); for (const [key, value] of Object.entries(props)) { if (value == null || value === false) continue; if (key === "text") node.textContent = value; else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value); } node.append(...[].concat(children)); return node; };
// User cancelled recommendation network images. These replace the retired recommendation-poll UI contract.
const taskId = "a".repeat(64), ids = ["c1", "c2", "c3"];
function recommendation(status = "ready") {
  return { recommendation_run_id: "controlled-run", request: { budget_range: { min: "0", max: "300" }, facts: [{ id: "f1", text: "受控资料事实" }] },
    candidates: ids.map((id, i) => ({ id, name: `建议${id}`, description: "真实文字素材融合的受控示例", reason: "结合资料与用户偏好延伸", fact_refs: ["f1"], unknowns: [], estimated_total: String((i + 1) * 100), currency: "CNY" })),
    selectable_candidate_ids: [...ids], validation: { candidate_results: ids.map(id => ({ id, passed: true, errors: [], warnings: [] })) },
    retrieval: { references: ids.map((id, i) => ({ reference_id: `ref_${id}`, image_id: String(i + 1).repeat(32), image_kind: "reference_image", image_validation: { ok: true }, source_url: `https://content.example/${id}`, summary: `资料${id}` })) },
    media: { status, selected: null, candidates: ids.map((candidate_id, i) => ({ candidate_id, status, reference_id: `ref_${candidate_id}`, image: status === "ready" ? { id: String(i + 1).repeat(32), kind: "reference_image", url: `/api/reference/images/${String(i + 1).repeat(32)}` } : null })) } };
}
const media = (status = "pending", candidateId = "c1", id = taskId) => ({ contract_version: "retrieval-media-v2", status, candidates: [], selected: { task_id: id, candidate_id: candidateId, status, annotations: [], image: status === "ready" ? { id: "selected-image", version: "v1", kind: "ai_illustration", url: `/api/media/assets/${id}` } : null } });
const presentation = status => ({ status: "completed", recommendation_run_id: "controlled-run", selected_candidate_id: "c1", candidate: { id: "c1", name: "建议c1" }, sections: [{ title: "贺卡", items: ["祝你度过美好的一天。"] }, { title: "赠送方式", items: ["双方方便时自然递出。"] }], recheck_summary: { passed: true, currency: "CNY", gift_estimated_total: "100" }, media: media(status) });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup({ report = recommendation(), selected = null, fetcher = async () => ({ ok: true, data: media("ready") }) } = {}) {
  let seq = 0, fullRenders = 0;
  const timers = new Map(), calls = [], choices = [], state = { report, presentation: selected, busy: false, inFlow: true, requestVersion: 1 };
  const ctx = { el, state, selectCandidate: id => choices.push(id), resetToForm() {}, backToEncourage() {}, backToHome() {}, stateView: () => ({ body: [], actions: [] }), errorBox: () => null, render() { fullRenders++; }, apiFetch: async (...args) => { calls.push(args); return fetcher(...args); }, setTimeout: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const views = createResultViews(ctx); let root;
  const mount = () => { const result = state.presentation ? views.renderPresentation() : views.renderRecommendation(); root = el("main", {}, [...result.body, ...result.actions]); return root; };
  mount();
  return { state, views, calls, choices, timers, mount, get root() { return root; }, get fullRenders() { return fullRenders; }, async next() { const entry = timers.entries().next().value; if (!entry) return; timers.delete(entry[0]); entry[1].fn(); await flush(); } };
}
const cards = h => h.root.querySelectorAll(".gift-choice");
const noRecommendationImage = h => { for (const selector of ["img", ".gift-media", ".candidate-media-slot", ".candidate-image-status", ".media-stage"]) assert.equal(h.root.querySelectorAll(selector).length, 0, selector); };

test("停推荐网图：真实参考图响应也无img/空框，三文字与来源数据不变", () => {
  const report = recommendation(), before = JSON.stringify(report), h = setup({ report });
  noRecommendationImage(h); assert.equal(cards(h).length, 3);
  cards(h).forEach(card => card.querySelector(".suggest-row").querySelector("button").events.click());
  assert.deepEqual(h.choices, ids); assert.match(h.root.textContent, /受控资料事实|结合资料与用户偏好延伸/);
  assert.equal(JSON.stringify(report), before); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
});
test("停推荐网图：pending与重复render均不排程或发推荐GET", async () => {
  const h = setup({ report: recommendation("pending") }); h.mount(); h.mount(); await h.next();
  noRecommendationImage(h); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
  assert.doesNotMatch(h.root.textContent, /配图准备中|刷新配图|图片加载中/);
});
test("停推荐网图：错绑/重复/缺失图片不影响服务端三个可选候选", () => {
  for (const change of [r => { r.media.candidates = []; }, r => { r.media.candidates.push(r.media.candidates[0]); }, r => { r.retrieval.references[0].image_validation.ok = false; }]) {
    const report = recommendation(); change(report); const h = setup({ report }); noRecommendationImage(h);
    assert.deepEqual(cards(h).map(c => c.dataset.candidateId), ids); assert.ok(cards(h).every(c => !c.querySelector(".suggest-row").querySelector("button").disabled));
  }
});
test("停推荐网图：无图片字段也保留预算、事实与WHY文字", () => {
  const report = recommendation(); delete report.media; const h = setup({ report });
  noRecommendationImage(h); assert.equal(cards(h).length, 3); assert.match(h.root.textContent, /0–300 元|参考 ¥100|受控资料事实/);
});
test("停推荐网图：业务失败交集和忙碌防重复选择仍按原服务决策", () => {
  const report = recommendation(); report.validation.candidate_results[1].passed = false;
  const h = setup({ report }); assert.deepEqual(cards(h).map(c => c.dataset.candidateId), ["c1", "c3"]);
  h.state.busy = true; h.mount(); assert.ok(cards(h).every(c => c.querySelector(".suggest-row").querySelector("button").disabled));
});
test("停推荐网图：选前加载骨架没有图片区占位，选后效果框仍在", () => {
  const h = setup(); const before = el("main", {}, h.views.renderRecommendationLoading().body);
  assert.equal(before.querySelector(".skel--media"), null); assert.equal(before.querySelector("img"), null);
  const after = el("main", {}, h.views.renderPresentationLoading("c1").body);
  assert.ok(after.querySelector(".media-frame")); assert.ok(after.querySelector(".present-layout--loading"));
});
test("停推荐网图：运行时不引入推荐poll，共享图类型与选后接口保留", async () => {
  const source = await readFile(new URL("../public/js/results-view.js", import.meta.url), "utf8"), app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createRecommendationMedia|candidateSlot|stopRecommendationMediaPoll/); assert.doesNotMatch(app, /stopRecommendationMediaPoll/);
  assert.match(source, /packagingMedia\(view/); assert.match(source, /\/api\/media\/tasks\//); assert.match(app, /\/api\/presentations/);
  const shared = await import("../public/js/media-view.js"); assert.equal(typeof shared.candidateMedia, "function"); assert.equal(typeof shared.packagingMedia, "function");
});
test("停推荐网图：选后AI pending依然文字先读且只排既有任务读取", () => {
  const h = setup({ selected: presentation("pending") });
  assert.match(h.root.textContent, /祝你度过美好的一天|效果图生成中/); assert.ok(h.root.querySelector(".media-stage--pending"));
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 1);
});
test("停推荐网图：选后AI ready原位补图，正文/按钮/AI标识保持", async () => {
  const h = setup({ selected: presentation("pending") }), greeting = h.root.querySelector(".greeting-card"), guide = h.root.querySelector(".guide"), actions = h.root.querySelector(".present-summary__actions");
  await h.next(); assert.equal(h.root.querySelector(".greeting-card"), greeting); assert.equal(h.root.querySelector(".guide"), guide); assert.equal(h.root.querySelector(".present-summary__actions"), actions);
  assert.equal(h.root.querySelector("img").src, `http://127.0.0.1:8911/api/media/assets/${taskId}`);
  assert.equal(h.root.querySelector(".gift-media").dataset.imageKind, "ai_illustration"); assert.equal(h.root.querySelector(".gift-media").dataset.imageKindLabel, "AI 效果示意");
  assert.deepEqual(h.calls[0], [`/api/media/tasks/${taskId}`, null, { timeoutMs: 10000, track: false }]); assert.equal(h.fullRenders, 0); assert.equal(h.timers.size, 0);
});
test("停推荐网图：选后AI failed保留文字与只读刷新，不伪造图片", async () => {
  const h = setup({ selected: presentation("pending"), fetcher: async () => ({ ok: true, data: media("failed") }) }); await h.next();
  assert.match(h.root.textContent, /效果图生成未成功|祝你度过美好的一天/); assert.equal(h.root.querySelector("img"), null); assert.equal(h.timers.size, 0);
  assert.ok(h.root.querySelectorAll("button").some(b => b.textContent === "刷新图片状态"));
});
test("停推荐网图：选后读取受阻的刷新继续纯GET，重复点击无并发", async () => {
  let resolve; const h = setup({ selected: presentation("pending"), fetcher: async () => h.calls.length === 1 ? { ok: false } : new Promise(done => { resolve = done; }) }); await h.next();
  const refresh = h.root.querySelectorAll("button").find(b => b.textContent === "刷新图片状态"); refresh.events.click(); refresh.events.click(); assert.equal(h.calls.length, 2);
  resolve({ ok: true, data: media("ready") }); await flush(); assert.ok(h.root.querySelector("img"));
  assert.ok(h.calls.every(c => c[0] === `/api/media/tasks/${taskId}` && c[1] === null));
});
test("停推荐网图：错候选或错任务的AI快照仍被拒绝", async () => {
  for (const data of [media("ready", "c2"), media("ready", "c1", "b".repeat(64))]) {
    const h = setup({ selected: presentation("pending"), fetcher: async () => ({ ok: true, data }) }), original = h.state.presentation.media; await h.next();
    assert.equal(h.state.presentation.media, original); assert.equal(h.root.querySelector("img"), null); assert.equal(h.timers.size, 0);
  }
});
test("停推荐网图：离开选后页回文字三卡，旧AI响应不会串入", async () => {
  let resolve; const h = setup({ selected: presentation("pending"), fetcher: () => new Promise(done => { resolve = done; }) });
  const old = h.state.presentation, original = old.media; await h.next(); h.views.stopMediaPoll(); h.state.presentation = null; h.mount();
  resolve({ ok: true, data: media("ready") }); await flush(); assert.equal(old.media, original); noRecommendationImage(h); assert.equal(cards(h).length, 3); assert.equal(h.timers.size, 0);
});
test("停推荐网图：选择仍提交原生图呈现POST且pending文字立即进入状态", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8"), fn = source.slice(source.indexOf("async function selectCandidate("), source.indexOf("/* ------------------------------------------------------------------ 组装 */"));
  const state = { busy: false, requestVersion: 1, report: recommendation() }, calls = []; let textRendered = false;
  await vm.runInNewContext(`${fn}\nselectCandidate("c1")`, { state, render() { textRendered ||= Boolean(state.presentation?.sections); }, apiFetch: async (...args) => { calls.push(args); return { ok: true, data: presentation("pending") }; } });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "/api/presentations"); assert.equal(calls[0][1].selected_candidate_id, "c1"); assert.equal(calls[0][1].recommendation_run_id, "controlled-run"); assert.equal(textRendered, true); assert.equal(state.presentation.media.status, "pending");
});

