import { test } from "node:test";
import assert from "node:assert/strict";
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
  replaceWith(next) { const parent = this.parent; if (!parent) return; parent.children[parent.children.indexOf(this)] = next; next.parent = parent; this.parent = null; }
  querySelectorAll(selector) { const match = node => selector.startsWith(".") ? (node.className || "").split(/\s+/).includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap(child => child instanceof Element ? [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
globalThis.location = { origin: "http://127.0.0.1:8911" };
const el = (tag, props = {}, children = []) => { const node = new Element(tag); for (const [key, value] of Object.entries(props)) { if (value == null || value === false) continue; if (key === "text") node.textContent = value; else if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else node.setAttribute(key, value === true ? "" : value); } node.append(...[].concat(children)); return node; };
const taskId = "a".repeat(64);
const media = (status = "unavailable", candidateId = "c1") => ({ contract_version: "retrieval-media-v2", status, candidates: [], selected: { task_id: taskId, candidate_id: candidateId, status, annotations: [], image: status === "ready" ? { id: "ready-image", version: "v1", url: `/api/media/assets/${taskId}`, kind: "ai_illustration" } : null } });
const section = (key, title, ...items) => ({ key, title, items });
const experience = () => [section("colors", "配色", "电子邀请使用低饱和蓝绿配色。"), section("greeting", "贺卡", "一起度过轻松的一天。"), section("giving_advice", "赠送方式", "用一封电子邀请说明行程，确认彼此方便的时间。", "先问对方是否有空，再一起确定安排。")];
const physical = () => [section("style", "包装风格", "用简洁自然的风格。"), section("color", "配色", "米白搭配深蓝。"), section("packaging", "包装材料与步骤", "材料：现有牛皮纸、纸绳。", "步骤：包好礼盒，再系纸绳。"), section("greeting", "贺卡", "生日快乐，愿你继续发现好风景。"), section("delivery", "赠送方式", "见面时自然递出。")];
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup(sections, initialMedia = media(), fetcher = async () => ({ ok: true, data: media("ready") }), candidateName = "受控所选礼物") {
  let seq = 0, fullRenders = 0; const timers = new Map(), calls = [];
  const view = { status: "completed", recommendation_run_id: "controlled-run", selected_candidate_id: "c1", candidate: { id: "c1", name: candidateName }, sections, recheck_summary: { passed: true, gift_estimated_total: "80.00", currency: "CNY" }, media: initialMedia };
  const state = { inFlow: true, requestVersion: 1, presentation: view };
  const ctx = { el, state, render() { fullRenders++; }, apiFetch: async (...args) => { calls.push(args); return fetcher(); }, errorBox: () => null, setTimeout: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) };
  const views = createResultViews(ctx), result = views.renderPresentation(), root = el("main", {}, [...result.body, ...result.actions]);
  return { state, view, root, views, timers, calls, get fullRenders() { return fullRenders; }, async next() { const next = timers.entries().next().value; if (!next) return; timers.delete(next[0]); next[1].fn(); await flush(); } };
}
const titles = h => h.root.querySelectorAll(".guide-step__title").map(node => node.textContent);

test("纯体验无包装章节或替代包装占位，有用邀请安排保留在赠送方式", () => {
  const sections = experience(), original = JSON.stringify(sections), h = setup(sections);
  assert.ok(sections.every(sec => sec.key !== "packaging"));
  assert.deepEqual(titles(h), ["配色", "赠送方式"]);
  assert.equal(h.root.querySelectorAll(".guide-step").length, 2);
  assert.match(h.root.querySelector(".greeting-card").textContent, /一起度过轻松的一天。/);
  assert.match(h.root.querySelector(".present-summary").textContent, /赠送建议配色、贺卡、赠送方式/);
  assert.match(h.root.textContent, /用一封电子邀请说明行程，确认彼此方便的时间。先问对方是否有空，再一起确定安排。/);
  assert.doesNotMatch(h.root.textContent, /呈现说明|包装说明|包装材料|包装与贺卡|包装效果示意|包起来|风格与色调建议|照着上面效果图|这一步按你们平时/);
  assert.equal(h.root.querySelector(".packaging-media").attrs["aria-label"], "所选礼物赠送效果示意");
  assert.equal(JSON.stringify(sections), original);
});

test("旧空包装和空白条目不留空步骤，不补默认准备指引", () => {
  const h = setup([section("packaging", "包装材料与步骤", "", " \n\t", null, false), ...experience()]);
  assert.deepEqual(titles(h), ["配色", "赠送方式"]);
  assert.equal(h.root.querySelectorAll(".guide-step__hint").length, 0);
  assert.deepEqual(h.root.querySelectorAll(".guide-step__no").map(node => node.textContent), ["01", "02"]);
  assert.doesNotMatch(h.root.textContent, /包装材料与步骤|颜色参考上一步/);
});

test("实体方案完整展示实际材料步骤和贺卡，timeline不硬凑三步", () => {
  const h = setup(physical());
  assert.deepEqual(titles(h), ["包装风格", "配色", "包装材料与步骤", "赠送方式"]);
  assert.equal(h.root.querySelectorAll(".guide-step").length, 4);
  assert.match(h.root.textContent, /材料：现有牛皮纸、纸绳。步骤：包好礼盒，再系纸绳。/);
  assert.match(h.root.querySelector(".greeting-card").textContent, /生日快乐，愿你继续发现好风景。/);
  assert.match(h.root.querySelector(".present-summary").textContent, /包装风格、配色、包装材料与步骤、贺卡、赠送方式/);
});

test("体验附实体邀请函按真实sections保留材料与安排，不按候选名称硬分流", () => {
  const h = setup([section("packaging", "包装材料与步骤", "使用现有卡纸绘制一张纪念邀请函。"), section("planning", "体验安排", "双方确定演出时间与见面地点。"), section("delivery", "邀请方式", "递出邀请函时说明可自由决定是否参加。")], media(), undefined, "演唱会与纪念卡");
  assert.deepEqual(titles(h), ["包装材料与步骤", "体验安排", "邀请方式"]);
  assert.match(h.root.textContent, /现有卡纸绘制一张纪念邀请函/);
  assert.match(h.root.textContent, /双方确定演出时间与见面地点/);
});

test("实体合理description-only沿包装说明完整保留，不按packaging键一刀切删除", () => {
  const description = "用礼物原有的木盒直接呈现，不另加外层包装；附上一张手写祝福卡。";
  const h = setup([section("packaging", "包装说明", description)]);
  assert.deepEqual(titles(h), ["包装说明"]);
  assert.equal(h.root.querySelector(".guide-step__body").querySelector("li").textContent, description);
  assert.doesNotMatch(h.root.querySelector(".present-summary").textContent, /包装与贺卡|包装材料/);
});

test("所有章节为空时不生成空timeline、空贺卡或虚构摘要行", () => {
  const h = setup([section("packaging", "包装材料与步骤"), section("greeting", "贺卡", "  ")]);
  assert.equal(h.root.querySelector(".guide"), null);
  assert.equal(h.root.querySelector(".greeting-card"), null);
  assert.doesNotMatch(h.root.querySelector(".present-summary").textContent, /赠送建议|包装与贺卡/);
  assert.match(h.root.querySelector(".present-summary").textContent, /礼物账单|完成/);
});

test("后端自定义标题与文字保持原语义，只作文本显示", () => {
  const title = "一同出发的约定", text = '<img src=x onerror="alert(1)"> 写在邀请里。';
  const h = setup([section("custom", title, text)]);
  assert.deepEqual(titles(h), [title]);
  assert.equal(h.root.querySelector(".guide-step__body").querySelector("li").textContent, text);
  assert.equal(h.root.querySelectorAll("img").length, 0);
});

test("AI图ready仅替换图片区，实际建议、贺卡、摘要与按钮DOM保持", async () => {
  for (const sections of [experience(), physical()]) {
    const h = setup(sections, media("pending"));
    const guide = h.root.querySelector(".guide"), card = h.root.querySelector(".greeting-card"), summary = h.root.querySelector(".present-summary"), actions = h.root.querySelector(".present-summary__actions");
    const sectionBytes = JSON.stringify(h.view.sections);
    assert.match(h.root.textContent, /效果图生成中/); assert.equal(h.calls.length, 0);
    await h.next();
    assert.equal(h.root.querySelector(".guide"), guide); assert.equal(h.root.querySelector(".greeting-card"), card);
    assert.equal(h.root.querySelector(".present-summary"), summary); assert.equal(h.root.querySelector(".present-summary__actions"), actions);
    assert.equal(JSON.stringify(h.view.sections), sectionBytes); assert.equal(h.fullRenders, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.root.querySelector("img").src, `http://127.0.0.1:8911/api/media/assets/${taskId}`);
    assert.equal(h.root.querySelector("img").attrs.alt, "礼物赠送效果示意");
    assert.equal(h.root.querySelector(".media-kind").textContent, "AI 效果示意");
    assert.equal(h.root.querySelector(".gift-media").dataset.imageKind, "ai_illustration");
    assert.deepEqual(h.calls[0], [`/api/media/tasks/${taskId}`, null, { timeoutMs: 10000, track: false }]);
  }
});

test("通用赠送标题仍明确区分AI示意、参考图和商品来源图", () => {
  for (const [kind, label] of [["ai_illustration", "AI 效果示意"], ["reference_image", "参考图片"], ["source_photo", "商品来源图"]]) {
    const data = media("ready"); data.selected.image.kind = kind;
    const h = setup(experience(), data);
    assert.equal(h.root.querySelector(".media-kind").textContent, label);
    assert.equal(h.root.querySelector(".gift-media").dataset.imageKind, kind);
    assert.equal(h.root.querySelector(".gift-media").dataset.imageKindLabel, label);
  }
});

test("错误候选图片响应不能覆盖指南，失败图片提示也不回填包装文案", async () => {
  const h = setup(experience(), media("pending"), async () => ({ ok: true, data: media("ready", "other") }));
  const original = h.view.media, guide = h.root.querySelector(".guide"); await h.next();
  assert.equal(h.view.media, original); assert.equal(h.root.querySelector(".guide"), guide); assert.equal(h.root.querySelector("img"), null);
  assert.match(h.root.textContent, /暂时无法更新图片/);
  const failed = setup(experience(), media("failed"));
  assert.doesNotMatch(failed.root.textContent, /包装和贺卡|包装材料/);
  assert.deepEqual(titles(failed), ["配色", "赠送方式"]);
});
