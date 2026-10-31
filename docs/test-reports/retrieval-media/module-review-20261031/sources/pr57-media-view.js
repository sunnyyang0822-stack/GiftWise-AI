const node = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined) n.setAttribute(k, String(v));
  }
  n.append(...children.filter(Boolean)); return n;
};
const kinds = { source_photo: "商品来源图", ai_illustration: "AI效果示意，非商品实拍", demo: "开发样例，非商品实拍" };
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
  const products = (report.retrieval?.products || []).filter(p => p.product_id === binding.product_id);
  const product = products.length === 1 ? products[0] : null;
  const boundImage = product && product.image_id === binding.image?.id ? binding.image : null;
  const figure = mediaFigure(boundImage, [], report.media?.status);
  const source = { browser_observed: "页面观察价，非结算保证", user_provided: "用户提供，未核实", seed: "开发样例估算，非实时价格", unknown: "来源未知" };
  const provenance = figure.querySelector(".media-source") || figure;
  provenance.append(node("p", { class: "media-price", text: `价格来源：${source[product?.price_source] || "来源未知"}。读取日期：${product?.observed_at || "未检索"}。` }));
  if (Array.isArray(product?.price_conditions)) provenance.append(node("p", { class: "media-caption", text: product.price_conditions.join("；") }));
  return figure;
}
export function packagingMedia(view) {
  const selected = view.media?.selected;
  const section = node("section", { class: "packaging-media", "aria-label": "所选礼物包装效果示意" });
  section.append(node("h2", { text: "把心意，好好包起来。" }));
  section.append(node("p", { class: "media-caption", text: "AI包装效果示意 · 当前为授权摄影开发夹具，非AI生成结果。尺寸与适配性未知，不代表已制作实物或保证外观。" }));
  section.append(node("p", { class: "media-caption", text: "场景道具不包含在赠送清单内。包装、道具未报价，不代表免费。" }));
  if (!selected || selected.candidate_id !== view.selected_candidate_id) { section.append(mediaFigure(null)); return section; }
  if (selected.packaging?.scale?.note) section.append(node("p", { class: "media-caption", text: selected.packaging.scale.note }));
  if (selected.scene?.description) section.append(node("p", { class: "media-caption", text: selected.scene.description }));
  const annotations = view.media?.contract_version === "retrieval-media-v2" && !selected.image?.version ? [] : selected.annotations;
  section.append(mediaFigure(selected.image, annotations, view.media?.status)); return section;
}
function mediaFigure(image, annotations = [], status = "ready") {
  const figure = node("figure", { class: "gift-media", "data-image-id": image?.id || "missing" });
  const safe = image && kinds[image.kind] && localMediaUrl(image.url);
  const notes = validAnnotations(annotations, image?.version);
  const stage = node("div", { class: `media-stage${notes.length ? " media-scene" : ""}` });
  const notice = node("p", { class: "media-status", role: "status", "aria-live": "polite", text: safe ? status === "pending" ? "图片正在准备，文字结果可先查看。" : "图片加载中…" : "暂无图片，文字结果仍可查看。" });
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
  figure.append(stage, notice, node("figcaption", { class: "media-caption", text: image ? kinds[image.kind] || "图片类型未知，未展示" : "图片缺失" }), retry);
  if (image?.attribution) figure.append(node("details", { class: "media-source" }, [node("summary", { text: "图片来源与说明" }), node("p", { class: "media-attribution", text: image.attribution })]));
  if (notes.length) {
    const list = node("ol", {}, notes.map(a => node("li", { text: a.text })));
    figure.append(node("details", { class: "media-notes" }, [node("summary", { text: "查看说明" }), list]));
  }
  if (safe && status !== "pending" && status !== "failed" && status !== "unavailable") load();
  else if (safe) { retry.hidden = false; retry.textContent = "重新查看图片"; if (status !== "pending") notice.textContent = "图片暂不可用，文字结果可先查看。"; }
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
