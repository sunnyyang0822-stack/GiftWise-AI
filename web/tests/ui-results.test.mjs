import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createResultViews } from "../public/js/results-view.js";
import { friendlyMessage, friendlyMessages } from "../public/js/friendly.js";

// 只提供视图用到的 DOM 操作；布局、真实按钮交互另外以 Chrome 固定响应夹具验证。
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; }
  setAttribute(key, value) {
    this.attrs[key] = String(value);
    if (key === "class") this.className = String(value);
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  addEventListener(type, fn) { this.events[type] = fn; }
  append(...children) { this.children.push(...children.filter(x => x != null && x !== false)); }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(x => typeof x === "string" ? x : x.textContent).join(""); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith(".") ? (node.className || "").split(/\s+/).includes(selector.slice(1)) : node.tagName === selector;
    return this.children.flatMap(child => child instanceof Element ? [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)] : []);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
const el = (tag, props = {}, children = []) => {
  const node = new Element(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...[].concat(children));
  return node;
};
const timeErrors = [{ code: "DELIVERY_TOO_LONG", message: "算上快递时间，可能赶不上你想送出的时间。" }, { code: "PREPARATION_TOO_LONG", message: "准备时间超过了你留出的天数。" }];
const candidate = id => ({ id, name: `测试建议${id}`, description: "固定响应夹具，不是真实推荐", reason: "模型建议的方向", estimated_total: "80.00", currency: "CNY", estimated_preparation_days: 5, fact_refs: [], inferences: [], unknowns: [] });
const report = () => ({ request: { budget_range: { min: "0", max: "300" }, available_days: null, facts: [] }, candidates: ["c1", "c2", "c3"].map(candidate), validation: { errors: [], candidate_results: ["c1", "c2", "c3"].map(id => ({ id, passed: true, errors: [], warnings: [] })) }, selectable_candidate_ids: ["c1", "c2", "c3"] });
function view(data, busy = false) {
  const selected = [];
  let resetCount = 0;
  const state = { report: data, busy };
  const ctx = { el, state, selectCandidate: id => selected.push(id), resetToForm: () => resetCount++, stateView: (title, paragraphs, actions) => ({ body: [el("section", { class: "state" }, [el("h2", { text: title }), ...paragraphs.map(text => el("p", { text }))])], actions }), errorBox: errors => el("aside", {}, friendlyMessages(errors)) };
  const rendered = createResultViews(ctx).renderRecommendation();
  const root = el("main", {}, [...rendered.body, ...rendered.actions]);
  return { root, selected, state, resetCount: () => resetCount };
}

test("全部可选：保留服务顺序、三张可点卡，移除合规自证", () => {
  const data = report(); const before = JSON.stringify(data); const v = view(data);
  const cards = v.root.querySelectorAll(".gift-choice");
  assert.deepEqual(cards.map(c => c.dataset.candidateId), ["c1", "c2", "c3"]);
  cards[1].querySelector("button").events.click();
  assert.deepEqual(v.selected, ["c2"]);
  assert.ok(cards.every(c => !("disabled" in c.querySelector("button").attrs)));
  assert.doesNotMatch(v.root.textContent, /预算、时间、避开项都符合|暂不可选|由你自己判断/);
  assert.equal(JSON.stringify(data), before, "视图不得改写服务端决策");
});

test("混合结果：只显示 selectable 与 passed 的交集，按实际数量命名", () => {
  const data = report(); data.validation.candidate_results[0].passed = false; data.selectable_candidate_ids = ["c1", "c3", "unknown"];
  const v = view(data);
  assert.deepEqual(v.root.querySelectorAll(".gift-choice").map(c => c.dataset.candidateId), ["c3"]);
  assert.doesNotMatch(v.root.textContent, /三个|测试建议c1|测试建议c2|暂不可选/);
  assert.equal(v.root.querySelectorAll(".card--fail").length, 0);
});

test("两个可选时不把部分成功说成三个思路", () => {
  const data = report(); data.selectable_candidate_ids = ["c1", "c3"];
  const v = view(data);
  assert.equal(v.root.querySelectorAll(".gift-choice").length, 2);
  assert.doesNotMatch(v.root.textContent, /三个/);
  assert.match(v.root.textContent, /两个/);
});

test("没有真可选或缺少检查结果：不交付失败卡，只留恢复入口", () => {
  const missing = report(); missing.validation.candidate_results = [];
  const failed = report(); failed.validation.candidate_results.forEach(r => { r.passed = false; });
  for (const data of [missing, failed]) {
    const v = view(data);
    assert.equal(v.root.querySelectorAll(".gift-choice").length, 0);
    assert.doesNotMatch(v.root.textContent, /暂不可选|放宽|改改需求|测试建议|三个/);
    v.root.querySelector("button").events.click();
    assert.equal(v.resetCount(), 1);
  }
  const data = report(); data.selectable_candidate_ids = [];
  assert.equal(view(data).root.querySelectorAll(".gift-choice").length, 0);
  data.candidates = [];
  assert.equal(view(data).root.querySelectorAll(".gift-choice").length, 0);
});

test("旧时间错误不再警告，也不能让服务端失败候选变成可选", () => {
  const data = report(); data.selectable_candidate_ids = ["c2"];
  data.validation.errors = timeErrors;
  data.validation.candidate_results[0] = { id: "c1", passed: false, errors: timeErrors };
  data.validation.candidate_results[1].errors = timeErrors;
  data.raw_validation = { candidate_results: [{ id: "c2", passed: false, errors: timeErrors }] };
  const before = JSON.stringify(data); const v = view(data);
  assert.deepEqual(v.root.querySelectorAll(".gift-choice").map(c => c.dataset.candidateId), ["c2"]);
  assert.doesNotMatch(v.root.textContent, /赶不上|超过了|不太符合|哪里不符合|DELIVERY|由你/);
  assert.equal(JSON.stringify(data), before);
});

test("时间旧码文案不出现在友好提示，预算和排除项提示保留", () => {
  assert.equal(friendlyMessage(timeErrors[0]), "");
  assert.deepEqual(friendlyMessages(timeErrors), []);
  assert.deepEqual(friendlyMessages([...timeErrors, { code: "OVER_BUDGET" }]), ["价格超出了你的预算。"]);
  assert.deepEqual(friendlyMessages([{ code: "EXCLUSION_CONFLICT" }]), ["和你要避开的东西有冲突。"]);
});

test("无报价、来源、图片或绑定不另加选择门槛；未知时间不输出假值", () => {
  const data = report(); data.selectable_candidate_ids = ["c1"];
  delete data.candidates[0].estimated_total; data.candidates[0].estimated_preparation_days = null;
  const v = view(data); const card = v.root.querySelector(".gift-choice");
  assert.ok(!("disabled" in card.querySelector("button").attrs));
  assert.match(card.textContent, /价格待了解/);
  assert.doesNotMatch(v.root.textContent, /undefined|null|¥0|准备约 0/);
  assert.equal(v.root.querySelector(".gift-media"), null);
});

test("预算0与零元估算如实展示，不把未知报价改成免费", () => {
  const data = report(); data.request.budget_range = { min: "0", max: "0" }; data.candidates[0].estimated_total = "0.00";
  const v = view(data);
  assert.match(v.root.textContent, /预算 0 元/);
  assert.match(v.root.querySelector(".gift-choice").textContent, /参考 ¥0.00/);
});

test("忙碌时仍避免重复选择请求；用户文本保持文本节点", () => {
  const data = report(); data.candidates[0].name = '<img src=x onerror="alert(1)">';
  const v = view(data, true);
  assert.ok(v.root.querySelectorAll(".gift-choice").every(c => "disabled" in c.querySelector("button").attrs));
  assert.equal(v.root.querySelector(".card__title").textContent, data.candidates[0].name);
  assert.equal(v.root.querySelectorAll("img").length, 0);
});

test("app真实选择入口仍拒绝非selectable或未passed，只提交选中ID给服务端", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("async function selectCandidate("), source.indexOf("/* ------------------------------------------------------------------ 组装 */"));
  for (const [ids, passed, expectedCalls] of [[[], true, 0], [["c1"], false, 0], [["c1"], true, 1]]) {
    const calls = []; const state = { busy: false, requestVersion: 1, report: { recommendation_run_id: "fixture-run", selectable_candidate_ids: ids, validation: { candidate_results: [{ id: "c1", passed }] } } };
    const context = vm.createContext({ state, render() {}, apiFetch: async (...args) => { calls.push(args); return { ok: true, data: { status: "ready" } }; } });
    await vm.runInContext(`${fn}\nselectCandidate("c1")`, context);
    assert.equal(calls.length, expectedCalls);
    if (calls.length) {
      assert.equal(calls[0][0], "/api/presentations");
      assert.equal(calls[0][1].selected_candidate_id, "c1");
      assert.equal(calls[0][1].recommendation_run_id, "fixture-run");
      assert.ok(!Object.hasOwn(calls[0][1], "passed"));
    }
  }
});
