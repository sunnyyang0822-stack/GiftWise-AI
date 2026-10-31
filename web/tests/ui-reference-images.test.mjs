import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateMedia } from "../public/js/media-view.js";

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; this.attrs = {}; this.style = { setProperty() {} }; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key === "class") this.className = String(value); if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  addEventListener(key, fn) { this.events[key] = fn; }
  append(...children) { this.children.push(...children.filter(x => x != null && x !== false)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(x => typeof x === "string" ? x : x.textContent).join(""); }
  querySelectorAll(selector) { const match = node => selector.startsWith(".") ? (node.className || "").split(/\s+/).includes(selector.slice(1)) : node.tagName === selector; return this.children.flatMap(child => child instanceof Element ? [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)] : []); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
globalThis.location = { origin: "http://127.0.0.1:8911" };
const imageId = "a".repeat(32), referenceId = `ref_${"b".repeat(32)}`;
const fixture = () => ({ media: { status: "ready", candidates: [{ candidate_id: "c1", reference_id: referenceId, image: { id: imageId, kind: "reference_image", url: `/api/reference/images/${imageId}`, source_url: "https://reference.example/article", alt: "公开资料参考图：手写卡片", price_observed_at: "2026-10-31T12:00:00Z" } }] }, retrieval: { references: [{ reference_id: referenceId, title: "卡片灵感资料", source_url: "https://reference.example/article", source_platform: "public_content", reference_kind: "public_reference", observed_at: "2026-10-31T12:01:00Z", image_id: imageId, image_url: `/api/reference/images/${imageId}`, image_kind: "reference_image", image_validation: { ok: true, mime: "image/jpeg", width: 640, height: 480, sha256: "a".repeat(64) }, image_provenance: { page_kind: "public_page", source_url: "https://reference.example/article", observed_at: "2026-10-31T12:01:00Z" } }] } });
const render = data => candidateMedia(data, { id: "c1" });
const hidden = data => assert.equal(render(data).querySelector("img"), null);

test("无SKU的参考图通过唯一来源引用显示，准确标为参考图片并保留来源/观察时间", () => {
  const data = fixture(); const before = JSON.stringify(data); const figure = render(data);
  const image = figure.querySelector("img");
  assert.equal(image.src, `http://127.0.0.1:8911/api/reference/images/${imageId}`);
  assert.equal(figure.querySelector(".media-kind").textContent, "参考图片");
  assert.equal(figure.dataset.imageKind, "reference_image");
  assert.equal(figure.dataset.imageKindLabel, "参考图片");
  assert.equal(figure.dataset.imageReferenceId, referenceId);
  assert.equal(figure.dataset.imageReferenceKind, "public_reference");
  assert.equal(figure.dataset.imageSourceUrl, "https://reference.example/article");
  assert.equal(figure.dataset.imageObservedAt, "2026-10-31T12:01:00Z");
  assert.doesNotMatch(figure.textContent, /商品来源图|页面价格|参考价/);
  assert.equal(JSON.stringify(data), before, "不得改写响应或添加伪商品ID");
  image.naturalWidth = 640; image.naturalHeight = 480; image.events.load();
  assert.equal(figure.querySelector(".media-status").hidden, true);
});

test("来源唯一但image_id错绑、kind错配或没有有效图校验结果均不展示", () => {
  for (const alter of [d => { d.retrieval.references[0].image_id = "other"; }, d => { d.retrieval.references[0].image_kind = "source_photo"; }, d => { d.retrieval.references[0].image_validation.ok = false; }, d => { delete d.retrieval.references[0].image_validation; }]) {
    const data = fixture(); alter(data); hidden(data);
  }
});

test("拒绝错误候选、重复候选槽、缺失/重复来源引用，不能用商品记录冒充参考来源", () => {
  for (const alter of [d => { d.media.candidates[0].candidate_id = "c2"; }, d => { d.media.candidates.push(structuredClone(d.media.candidates[0])); }, d => { d.retrieval.references = []; }, d => { d.retrieval.references.push(structuredClone(d.retrieval.references[0])); }, d => { delete d.media.candidates[0].reference_id; d.retrieval.products = [{ product_id: "fake", image_id: imageId }]; d.media.candidates[0].product_id = "fake"; }]) {
    const data = fixture(); alter(data); hidden(data);
  }
});

test("仅本站根相对图片URL可加载，外链/脚本/data/双斜线均拒绝", () => {
  for (const url of ["https://outside.example/picture.jpg", "javascript:alert(1)", "data:image/png,AAA", "//outside.example/picture.jpg", "/\\outside/image.jpg"]) {
    const data = fixture(); data.media.candidates[0].image.url = url; hidden(data);
  }
});

test("没有观察时间不编造；兼容既有image.price_observed_at仅作观察元数据", () => {
  const data = fixture(); delete data.retrieval.references[0].observed_at;
  assert.equal(render(data).dataset.imageObservedAt, "2026-10-31T12:00:00Z");
  delete data.media.candidates[0].image.price_observed_at;
  assert.equal(render(data).dataset.imageObservedAt, undefined);
  assert.doesNotMatch(render(data).textContent, /价格/);
});

test("source_photo继续严格商品绑定，不回退到参考来源路径", () => {
  const data = fixture();
  data.media.candidates[0].image.kind = "source_photo";
  hidden(data);
  data.media.candidates[0].product_id = "sku-1";
  data.retrieval.products = [{ product_id: "sku-1", image_id: imageId, price_source: "browser_observed", observed_at: "2026-10-31T12:00:00Z" }];
  const figure = render(data);
  assert.ok(figure.querySelector("img"));
  assert.equal(figure.dataset.imageKind, "source_photo");
  assert.equal(figure.dataset.imageKindLabel, "商品来源图");
  assert.equal(figure.querySelector(".media-kind"), null);
  data.retrieval.products[0].image_id = "wrong"; hidden(data);
  data.retrieval.products[0].image_id = imageId;
  data.retrieval.products.push(structuredClone(data.retrieval.products[0])); hidden(data);
});

test("同候选商品图和参考图双槽拒绝歧义，来源空项不影响有效唯一引用", () => {
  const data = fixture(); data.retrieval.references.unshift(null);
  assert.ok(render(data).querySelector("img"));
  data.media.candidates.push({ candidate_id: "c1", product_id: "sku-1", image: { ...data.media.candidates[0].image, kind: "source_photo" } });
  hidden(data);
});

test("总体媒体unavailable不阻断独立校验通过的候选参考图", () => {
  const data = fixture(); data.media.status = "unavailable";
  const figure = render(data);
  assert.equal(figure.querySelector("img")?.src, `http://127.0.0.1:8911/api/reference/images/${imageId}`);
  assert.equal(figure.querySelector(".media-kind").textContent, "参考图片");
  assert.equal(data.media.status, "unavailable", "不得改写原始服务状态来伪造通过");
  assert.equal(data.retrieval.products, undefined, "无需添加SKU即可加载");
});
