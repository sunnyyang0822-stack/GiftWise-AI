import { icon } from "./icons.js";

const node = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined) n.setAttribute(k, String(v));
  }
  n.append(...children.filter(Boolean)); return n;
};
const kinds = { source_photo: "商品来源图", reference_image: "参考图片", ai_illustration: "AI 效果示意", demo: "" };
// 媒体必须经本站托管；拒绝远程直连、data、脚本URL、调试端口。外部SVG绝不内联。
export function localMediaUrl(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return null;
  try { const u = new URL(value, location.origin); return u.origin === location.origin ? u.href : null; } catch { return null; }
}
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
export function validAnnotations(items, imageVersion) {
  return (Array.isArray(items) ? items : []).filter(a => typeof a.text === "string" && [...a.text].length <= 30 && point(a.target) && point(a.label)
    && (!imageVersion || a.image_version === imageVersion)
    && (a.curve == null || Array.isArray(a.curve.control_points) && [1, 2].includes(a.curve.control_points.length) && a.curve.control_points.every(point))).slice(0, 5);
}
export function candidateMedia(report, candidate) {
  const bindings = (report.media?.candidates || []).filter(x => x.candidate_id === candidate.id);
  if (bindings.length !== 1) return mediaFigure(null);
  const binding = bindings[0];
  if (binding.image?.kind === "reference_image") {
    const references = Array.isArray(report.retrieval?.references) ? report.retrieval.references : [];
    const matches = typeof binding.reference_id === "string" && binding.reference_id.trim()
      ? references.filter(reference => reference?.reference_id === binding.reference_id) : [];
    const reference = matches.length === 1 ? matches[0] : null;
    if (!reference || reference.image_kind !== "reference_image" || typeof binding.image.id !== "string" || !binding.image.id.trim() || reference.image_id !== binding.image.id
      || reference.image_validation?.ok !== true || !localMediaUrl(binding.image.url)) return mediaFigure(null);
    // 引用图已独立校验，不受整体选后生图状态影响；不制造商品/SKU或借用报价。
    return mediaFigure({ ...binding.image, reference_id: reference.reference_id, reference_kind: reference.reference_kind,
      source_url: binding.image.source_url || reference.source_url, observed_at: reference.observed_at ?? binding.image.price_observed_at });
  }
  const products = (report.retrieval?.products || []).filter(p => p.product_id === binding.product_id);
  const product = products.length === 1 ? products[0] : null;
  const boundImage = product && product.image_id === binding.image?.id ? binding.image : null;
  const figure = mediaFigure(boundImage, [], report.media?.status);
  // 只有真实来源的价格才标注出处；参考估价本身已在卡片上以“参考”呈现。
  const source = { browser_observed: "页面价格", user_provided: "你提供的价格" };
  if (source[product?.price_source]) {
    const provenance = figure.querySelector(".media-source") || figure;
    provenance.append(node("p", { class: "media-price", text: `${source[product.price_source]}${product.observed_at ? ` · ${product.observed_at}` : ""}` }));
    if (product.price_conditions?.length) provenance.append(node("p", { class: "media-caption", text: product.price_conditions.join("；") }));
  }
  return figure;
}
// 选后包装效果图：文字先读，图在固定比例的相框里原位出现。
// 状态只来自真实任务：pending 才有生成动效；failed / unavailable / 读取受阻都停下动效，只给一句状态与只读的「刷新图片状态」。
const WAIT_LINES = ["效果图慢慢成形中", "给这份心意添一点细节", "文字建议可以先看起来"];
const FRAME_ASPECT = 4 / 3; // 生图任务固定横幅 4:3（2304×1728）；真实尺寸到达后以图片为准
export function packagingMedia(view, options = {}) {
  const selected = view.media?.selected;
  const bound = selected && selected.candidate_id === view.selected_candidate_id;
  const status = bound ? view.media?.status : "unavailable";
  const image = bound ? selected.image : null;
  const safe = image && Object.hasOwn(kinds, image.kind) && localMediaUrl(image.url);
  const phase = options.pending ? "pending" : safe && status === "ready" ? "ready"
    : status === "failed" ? "failed" : options.blocked ? "blocked" : status === "pending" ? "waiting" : "unavailable";
  const section = node("section", { class: `packaging-media packaging-media--${phase}`, "data-media-state": phase, "aria-label": "所选礼物包装效果示意" });
  section.append(node("div", { class: "packaging-media__head" }, [
    node("span", { class: "media-kind", text: "包装效果示意" }),
    node("h2", { text: "把心意，好好包起来" }),
  ]));
  if (phase === "ready") {
    const annotations = view.media?.contract_version === "retrieval-media-v2" && !image.version ? [] : selected.annotations;
    section.append(readyFigure(image, safe, annotations));
    return section;
  }
  const figure = node("figure", { class: "gift-media media-frame", "data-image-id": image?.id || "missing" });
  if (image) bindImageData(figure, image);
  const message = options.message || "暂时没有效果图";
  if (phase === "pending") {
    // 动效与短句都是装饰（aria-hidden）；读屏只读状态一句。短句只是语气轮换，不代表生成阶段。
    figure.append(node("div", { class: "media-wait media-stage--pending" }, [
      node("span", { class: "media-wait__light", "aria-hidden": "true" }),
      node("span", { class: "media-wait__gift", "aria-hidden": "true" }, [icon("gift", { size: 30 })]),
      node("p", { class: "media-status", role: "status", "aria-live": "polite", text: message }),
      node("p", { class: "media-wait__lines", "aria-hidden": "true" }, WAIT_LINES.map(text => node("span", { text }))),
    ]));
    return section.append(figure), section;
  }
  const sub = { failed: "这次没画出来，包装和贺卡建议不受影响。", waiting: "图还在路上，文字建议已经可以照着准备。", blocked: "图片状态暂时没读到，文字建议不受影响。", unavailable: "包装和贺卡建议已经准备好了。" }[phase];
  figure.append(node("div", { class: "media-rest" }, [
    node("span", { class: "media-rest__icon", "aria-hidden": "true" }, [icon(phase === "unavailable" ? "ribbon" : "gift", { size: 26 })]),
    node("p", { class: "media-status", role: "status", "aria-live": "polite", text: message }),
    node("p", { class: "media-rest__sub", text: sub }),
    options.onRefresh ? node("button", { type: "button", class: "btn btn--sm media-retry", text: options.refreshing ? "正在更新图片状态" : "刷新图片状态", ...(options.refreshing ? { disabled: "" } : {}), onclick: options.onRefresh }) : null,
  ]));
  section.append(figure);
  return section;
}
function bindImageData(figure, image) {
  // 产品裁定（2026-10-31）：界面不显示来源说明；真实标识保留在数据属性上，可从 DOM 追到接口原值。
  figure.dataset.imageKind = image.kind || "";
  figure.dataset.imageKindLabel = kinds[image.kind] || "";
  if (image.version) figure.dataset.imageVersion = image.version;
  if (image.source_url) figure.dataset.imageSourceUrl = image.source_url;
  if (image.attribution) figure.dataset.imageAttribution = image.attribution;
}
function readyFigure(image, url, annotations) {
  const figure = node("figure", { class: "gift-media media-frame media-frame--ready", "data-image-id": image.id || "missing" });
  bindImageData(figure, image);
  const notes = validAnnotations(annotations, image.version);
  const stage = node("div", { class: `media-stage${notes.length ? " media-scene" : ""}` });
  // 相框先按图片真实宽高（无则 4:3）占位，图到达后不推挤下方文字；整图 contain，不裁主体。
  const aspect = image.width > 0 && image.height > 0 ? image.width / image.height : FRAME_ASPECT;
  stage.style.aspectRatio = String(aspect); stage.style.setProperty("--media-aspect", String(aspect));
  const notice = node("p", { class: "media-status media-status--quiet", role: "status", "aria-live": "polite", text: "" });
  const retry = node("button", { type: "button", class: "btn btn--sm media-retry", text: "重试加载图片" }); retry.hidden = true;
  const load = () => {
    retry.hidden = true; notice.textContent = ""; stage.replaceChildren(); figure.querySelector(".media-active-note")?.remove();
    const img = node("img", { alt: image.alt || "礼物包装效果示意", decoding: "async" });
    img.addEventListener("load", () => {
      const real = img.naturalWidth / img.naturalHeight;
      if (Number.isFinite(real) && real > 0) { stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; stage.style.setProperty("--media-aspect", String(real)); }
      img.setAttribute("data-loaded", "");
      if (notes.length) overlay(stage, notes);
    });
    // 只重新读取同一张已生成的图片字节，不发起新的生成。
    img.addEventListener("error", () => { stage.replaceChildren(); notice.textContent = "图片没加载出来，文字建议不受影响。"; retry.hidden = false; });
    stage.append(img); img.src = url;
  };
  retry.addEventListener("click", load);
  figure.append(stage, notice, retry);
  if (notes.length) figure.append(node("details", { class: "media-notes" }, [node("summary", { text: "文字版说明" }), node("ol", {}, notes.map(a => node("li", { text: a.text })))]));
  load();
  return figure;
}
function mediaFigure(image, annotations = [], status = "ready", options = {}) {
  const figure = node("figure", { class: "gift-media", "data-image-id": image?.id || "missing" });
  const safe = image && Object.hasOwn(kinds, image.kind) && localMediaUrl(image.url);
  const notes = validAnnotations(annotations, image?.version);
  const stage = node("div", { class: `media-stage${notes.length ? " media-scene" : ""}${options.pending ? " media-stage--pending" : ""}` });
  const notice = node("p", { class: "media-status", role: "status", "aria-live": "polite", text: options.packaging && (!safe || status !== "ready") ? options.message || "暂时没有效果图" : safe ? status === "pending" ? "图片正在准备，文字结果可先查看。" : "图片加载中…" : "暂无图片，文字结果仍可查看。" });
  const retry = node("button", { type: "button", class: "btn media-retry", text: "重试加载图片" }); retry.hidden = true;
  let img;
  const load = () => {
    if (!safe) return;
    retry.hidden = true; stage.replaceChildren(); figure.querySelector(".media-active-note")?.remove();
    notice.textContent = "图片加载中…"; notice.hidden = false;
    img = node("img", { alt: image.alt || "礼物配图", decoding: "async" });
    img.addEventListener("load", () => {
      stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; stage.style.setProperty("--media-aspect", String(img.naturalWidth / img.naturalHeight));
      notice.hidden = true; if (notes.length) overlay(stage, notes);
    });
    img.addEventListener("error", () => { stage.replaceChildren(); notice.hidden = false; notice.textContent = "图片加载失败，文字结果仍可查看。"; retry.hidden = false; });
    stage.append(img); img.src = safe;
  };
  retry.addEventListener("click", load);
  if (options.pending) stage.append(node("span", { class: "gw-dots", "aria-hidden": "true" }, [node("i"), node("i"), node("i")]));
  // 产品裁定（2026-10-31）：主界面不出现任何关于图片来源的文字/徽标/角标。
  //   改前：图下会渲染一个「商品来源图 / AI 效果示意」角标，并渲染一个
  //         「图片来源：<attribution>」的可展开块（旧第 71–73 行）。
  //   改后：这两个可见说明都不再渲染；但**真实标识一个字都不改**，原样搬到
  //         figure 的数据属性上（data-image-kind / data-image-kind-label /
  //         data-image-attribution / data-image-source-url / data-image-version），
  //         同时完整保留在后端响应里（report.media / presentation.media →
  //         media.candidates[].image / media.selected.image）。
  //   ⇒ 展示层隐藏、数据层如实：答辩被追问时可以当场从 DOM 或接口字段追到真值。
  //   img 的 alt 仍用后端给的原文（无障碍需要，且图加载失败时会被移除、不会显示成文字）。
  figure.append(...[stage, notice, retry].filter(Boolean));
  // 新公开参考图显式标注用途，商品图/生成图继续沿用既有展示规则。
  if (image?.kind === "reference_image") figure.append(node("span", { class: "media-kind", text: kinds.reference_image }));
  if (options.onRefresh) figure.append(node("button", { type: "button", class: "btn media-retry", text: options.refreshing ? "正在更新图片状态" : "刷新图片状态", ...(options.refreshing ? { disabled: "" } : {}), onclick: options.onRefresh }));
  if (image) {
    figure.dataset.imageKind = image.kind || "";
    figure.dataset.imageKindLabel = kinds[image.kind] || "";
    if (image.version) figure.dataset.imageVersion = image.version;
    if (image.source_url) figure.dataset.imageSourceUrl = image.source_url;
    if (image.attribution) figure.dataset.imageAttribution = image.attribution;
    if (image.reference_id) figure.dataset.imageReferenceId = image.reference_id;
    if (image.reference_kind) figure.dataset.imageReferenceKind = image.reference_kind;
    if (image.observed_at) figure.dataset.imageObservedAt = image.observed_at;
  }
  if (notes.length) {
    const list = node("ol", {}, notes.map(a => node("li", { text: a.text })));
    figure.append(node("details", { class: "media-notes" }, [node("summary", { text: "文字版说明" }), list]));
  }
  if (safe && status !== "pending" && status !== "failed" && status !== "unavailable") load();
  else if (safe && !options.packaging) { retry.hidden = false; retry.textContent = "重新查看图片"; if (status !== "pending") notice.textContent = "图片暂不可用，文字结果可先查看。"; }
  return figure;
}
function overlay(stage, notes) {
  const ns = "http://www.w3.org/2000/svg";
  const img = stage.querySelector("img");
  const height = 1000 * img.naturalHeight / img.naturalWidth;
  const svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 1000 ${height}`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("class", "media-arrows"); svg.setAttribute("aria-hidden", "true");
  const pixels = document.createElement("canvas"); pixels.width = 100; pixels.height = 100;
  const context = pixels.getContext("2d", { willReadFrequently: true });
  try { context.drawImage(img, 0, 0, 100, 100); } catch { /* 不可读取时采用高对比描边 */ }
  const active = node("p", { class: "media-active-note", role: "status", "aria-live": "polite", text: notes[0].text });
  notes.forEach((a, i) => {
    const line = document.createElementNS(ns, "path");
    const tx = a.target.x * 1000, ty = a.target.y * height, lx = a.label.x * 1000, ly = a.label.y * height;
    // 曲线仅是两个契约端点的显示插值，不新增控制点业务字段。
    const cx = (lx + tx) / 2 + (ty - ly) * .14, cy = (ly + ty) / 2 - (tx - lx) * .14;
    const size = 13;
    const controls = a.curve?.control_points?.map(p => [p.x * 1000, p.y * height]);
    const curve = controls?.length === 2 ? `C ${controls[0]} ${controls[1]} ${tx} ${ty}` : `Q ${controls?.[0] || [cx, cy]} ${tx} ${ty}`;
    const lastControl = controls?.at(-1) || [cx, cy];
    const endAngle = Math.atan2(ty - lastControl[1], tx - lastControl[0]);
    line.setAttribute("d", `M ${lx} ${ly} ${curve} M ${tx - Math.cos(endAngle - .5) * size} ${ty - Math.sin(endAngle - .5) * size} L ${tx} ${ty} L ${tx - Math.cos(endAngle + .5) * size} ${ty - Math.sin(endAngle + .5) * size}`);
    let dark = false;
    try { const rgb = context.getImageData(Math.min(99, Math.floor(a.label.x * 100)), Math.min(99, Math.floor(a.label.y * 100)), 1, 1).data; dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 155; } catch { /* 暖白加细描边 */ }
    line.style.stroke = dark ? "#24221f" : "#fff8e9";
    line.setAttribute("vector-effect", "non-scaling-stroke"); svg.append(line);
    const label = node("button", { class: `media-label${dark ? " media-label-dark" : ""}`, type: "button", "aria-label": `说明${i + 1}：${a.text}`, onclick: () => { active.textContent = a.text; } }, [node("span", { class: "media-mark", "aria-hidden": "true" }), node("span", { class: "media-label-text", text: a.text })]);
    label.style.left = `${a.label.x * 100}%`; label.style.top = `${a.label.y * 100}%`; stage.append(label);
  });
  stage.append(svg); stage.insertAdjacentElement("afterend", active);
}
