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
const taskId = "a".repeat(64);
const media = (status = "pending", candidateId = "c1", id = taskId) => ({ contract_version: "retrieval-media-v2", status, candidates: [], selected: { task_id: id, candidate_id: candidateId, status, annotations: [], image: status === "ready" ? { id: "ready-image", version: "ready-v1", url: `/api/media/assets/${id}`, kind: "ai_illustration", alt: "测试包装效果示意" } : null } });
const presentation = () => ({ status: "completed", recommendation_run_id: "run-1", selected_candidate_id: "c1", candidate: { id: "c1", name: "一本摄影集" }, sections: [{ title: "贺卡", items: ["生日快乐，愿你继续发现生活里的好风景。"] }, { title: "包装", items: ["用素色纸搭配细带。"] }, { title: "赠送", items: ["见面时轻松地送给对方。"] }], recheck_summary: { passed: true, gift_estimated_total: "80.00", currency: "CNY" }, media: media() });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(fetcher = async () => ({ ok: true, data: media("ready") })) {
  let seq = 0, fullRenders = 0;
  const timers = new Map(), calls = [];
  const state = { inFlow: true, requestVersion: 1, presentation: presentation() };
  const ctx = { el, state, render() { fullRenders++; }, apiFetch: async (...args) => { calls.push(args); return fetcher(...args); }, errorBox: () => null, setTimeout: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const views = createResultViews(ctx);
  let root;
  const mount = () => { const result = views.renderPresentation(); root = el("main", {}, [...result.body, ...result.actions]); return root; };
  mount();
  return { state, views, calls, timers, mount, get root() { return root; }, get fullRenders() { return fullRenders; }, async next() { const next = timers.entries().next().value; if (!next) return; timers.delete(next[0]); next[1].fn(); await flush(); } };
}

test("文字立即可见，只有真实pending+合法任务显示生成中，初次渲染不等待GET", () => {
  const h = setup();
  assert.match(h.root.textContent, /生日快乐|素色纸|见面时轻松/);
  assert.match(h.root.textContent, /效果图生成中/);
  assert.ok(h.root.querySelector(".media-stage--pending"));
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 1);
  assert.doesNotMatch(h.root.textContent, /自动查询|逐次退避|task_id|前端也不会|后端不会/);
});

test("pending到ready仅替换图片区，文字DOM保持，读取正确同源图片", async () => {
  const h = setup(); const greeting = h.root.querySelector(".greeting-card"); const sections = h.root.querySelector(".present-grid");
  await h.next();
  assert.equal(h.state.presentation.media.status, "ready");
  assert.equal(h.root.querySelector(".greeting-card"), greeting);
  assert.equal(h.root.querySelector(".present-grid"), sections);
  assert.equal(h.fullRenders, 0);
  assert.equal(h.root.querySelector("img").src, `http://127.0.0.1:8911/api/media/assets/${taskId}`);
  assert.equal(h.root.querySelector(".gift-media").dataset.imageKind, "ai_illustration");
  assert.equal(h.timers.size, 0);
});

test("重复渲染不重复排程，始终只有只读状态GET", async () => {
  const h = setup(); h.mount(); h.mount();
  assert.equal(h.timers.size, 1);
  await h.next();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], `/api/media/tasks/${taskId}`);
  assert.equal(h.calls[0][1], null);
  assert.equal(h.calls[0][2].track, false);
});

test("未启用、非法task、错绑候选不伪造生成状态，也不发轮询", () => {
  for (const selected of [media("unavailable"), media("pending", "c1", null), media("pending", "another")]) {
    const h = setup(); h.views.stopMediaPoll(); h.state.presentation = { ...presentation(), media: selected }; h.mount();
    assert.equal(h.timers.size, 0);
    assert.equal(h.calls.length, 0);
    assert.doesNotMatch(h.root.textContent, /效果图生成中/);
    assert.match(h.root.textContent, /生日快乐/);
  }
});

test("状态读取失败保留文字，手动刷新明确为GET且重复点击不会多发", async () => {
  let resolveReady;
  const h = setup(async () => h.calls.length === 1 ? { ok: false } : new Promise(resolve => { resolveReady = resolve; }));
  await h.next();
  assert.match(h.root.textContent, /暂时无法更新图片/);
  assert.equal(h.timers.size, 0);
  const button = h.root.querySelectorAll("button").find(node => node.textContent === "刷新图片状态");
  button.events.click(); button.events.click();
  assert.equal(h.calls.length, 2);
  assert.ok(h.root.querySelectorAll("button").find(node => node.textContent === "正在更新图片状态").disabled);
  resolveReady({ ok: true, data: media("ready") }); await flush();
  assert.equal(h.state.presentation.media.status, "ready");
  assert.match(h.root.textContent, /生日快乐/);
  assert.ok(h.calls.every(args => args[0].startsWith("/api/media/tasks/") && args[1] === null));
});

test("failed和unavailable终态停止自动查询，文字和完成入口仍在", async () => {
  for (const status of ["failed", "unavailable"]) {
    const h = setup(async () => ({ ok: true, data: media(status) }));
    await h.next(); h.mount();
    assert.equal(h.timers.size, 0);
    assert.match(h.root.textContent, status === "failed" ? /效果图生成未成功/ : /暂时没有效果图/);
    assert.match(h.root.textContent, /生日快乐|完成/);
    assert.doesNotMatch(h.root.textContent, /重新生成/);
  }
});

test("离开立即清理定时器，已发请求的旧响应不写入其他方案", async () => {
  const waiting = setup(); waiting.state.encourage = true; waiting.views.stopMediaPoll(); await waiting.next();
  assert.equal(waiting.calls.length, 0); assert.equal(waiting.timers.size, 0);
  let resolve;
  const h = setup(async () => new Promise(done => { resolve = done; }));
  const old = h.state.presentation; const originalMedia = old.media;
  await h.next();
  h.views.stopMediaPoll(); h.state.presentation = { ...presentation(), selected_candidate_id: "c2", media: media("pending", "c2", "b".repeat(64)) };
  resolve({ ok: true, data: media("ready") }); await flush();
  assert.equal(old.media, originalMedia);
  assert.equal(h.state.presentation.media.selected.candidate_id, "c2");
  assert.equal(h.fullRenders, 0);
});

test("错绑task或候选的状态响应不能覆盖当前图片区", async () => {
  for (const response of [media("ready", "wrong"), media("ready", "c1", "b".repeat(64))]) {
    const h = setup(async () => ({ ok: true, data: response })); const originalMedia = h.state.presentation.media;
    await h.next();
    assert.equal(h.state.presentation.media, originalMedia);
    assert.match(h.root.textContent, /暂时无法更新图片/);
    assert.equal(h.timers.size, 0);
  }
});

test("持续pending保留有上限的读取，重绘不能重置计数或付费重生", async () => {
  const h = setup(async () => ({ ok: true, data: media() }));
  for (let i = 0; i < 8; i++) await h.next();
  assert.equal(h.calls.length, 8); assert.equal(h.timers.size, 0);
  h.mount(); assert.equal(h.timers.size, 0);
  assert.match(h.root.textContent, /效果图还在生成|刷新图片状态/);
  assert.doesNotMatch(h.root.textContent, /查询 8|退避|自动刷新/);
});

test("离开再返回同一方案时，离开前的在途响应仍失效", async () => {
  let resolveOld;
  const h = setup(async () => h.calls.length === 1 ? new Promise(resolve => { resolveOld = resolve; }) : { ok: true, data: media("ready") });
  await h.next(); h.views.stopMediaPoll(); h.mount();
  resolveOld({ ok: true, data: media("ready") }); await flush();
  assert.equal(h.state.presentation.media.status, "pending");
  await h.next(); assert.equal(h.state.presentation.media.status, "ready");
  assert.equal(h.calls.length, 2);
});

test("app选中后接到completed+pending立即展示文字，不等待图片轮询", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function selectCandidate("), source.indexOf("/* ------------------------------------------------------------------ 组装 */"));
  const data = presentation(), calls = [];
  const state = { busy: false, requestVersion: 1, report: { recommendation_run_id: "run-1", selectable_candidate_ids: ["c1"], validation: { candidate_results: [{ id: "c1", passed: true }] } } };
  let textWasRendered = false;
  await vm.runInNewContext(`${fn}\nselectCandidate("c1")`, { state, render: () => { if (state.presentation?.sections) textWasRendered = true; }, apiFetch: async (...args) => { calls.push(args); return { ok: true, data }; } });
  assert.equal(state.busy, false); assert.equal(state.presentation, data); assert.equal(textWasRendered, true);
  assert.deepEqual(calls.map(args => args[0]), ["/api/presentations"]);
});
