// Issue #60 sidecar 草案夹具。仅供界面预览，不是检索证据或图像服务响应。
const variant = new URLSearchParams(globalThis.location?.search || "").get("media");
const names = ["notebook", "workshop", "art", "letter", "walk", "memories"];
const photos = {
  notebook: ["notebook-photo", "PNW Production", "open-notebook-on-white-background-8250925"],
  workshop: ["workshop-photo", "Chris Flaten", "ceramic-bowls-on-white-studio-background-5514832"],
  art: ["art-photo", "Kaboompics", "a-white-empty-frame-8947628"],
};
const scenes = {
  notebook: ["scene-light", "Ivan Vi", "white-gift-box-with-black-ribbon-lying-on-a-table-19791016", [
    ["暖白纸面，干净就很好", .23, .76, .23, .23],
    ["深色缎带，轻轻点睛", .37, .58, .72, .35],
    ["折角收得利落些", .12, .89, .73, .9],
  ]],
  workshop: ["scene-hexagon", "Kaboompics", "wrapped-with-ribbon-gift-box-placed-on-table-4397882", [
    ["跟着轮廓，不必套方盒", .43, .68, .26, .32],
    ["缎带留一点自然弧度", .61, .66, .76, .46],
    ["柔和的粉，衬一抹深蓝", .63, .8, .26, .91],
  ]],
  art: ["scene-paper", "Taryn Elliott", "christmas-gift-on-a-wooden-table-6119116", [
    ["牛皮纸，朴素也温柔", .24, .35, .25, .1],
    ["细绳打个轻巧的结", .35, .32, .76, .19],
    ["把祝福放在一旁", .59, .53, .78, .68],
  ]],
};
const photoImage = (id, file, author, slug, alt) => ({ id, version: `preview-${file}-20261031`, url: `/img/media-demo/${file}.jpg`, kind: "demo", alt,
  source_url: `https://www.pexels.com/photo/${slug}/`,
  attribution: `摄影：${author} / Pexels`,
});
const image = (name, alt, wrapped = false) => ({
  id: `demo-${wrapped ? "wrap-" : ""}${name}`,
  url: `/img/media-demo/${wrapped ? "wrap-" : ""}${name}.svg`, kind: "demo", alt,
  source_url: null, attribution: "插画：GiftWise AI",
});
export function recommendationMedia(candidates, zero = false) {
  const products = candidates.map((c, i) => ({ product_id: `demo-product-${names[i + (zero ? 3 : 0)]}`, name: c.name,
    variant: null, quantity: 1, price_amount: c.estimated_total, currency: "CNY",
    price_conditions: [], price_source: "seed",
    source_url: null, observed_at: null, image_id: variant === "missing" ? null : `demo-${names[i + (zero ? 3 : 0)]}`,
    price_range: null, shipping_status: "unknown", stock_status: "unknown", evidence_ref: null,
  }));
  return {
    retrieval: { status: "unavailable", evidence_id: null, products, warnings: [] },
    media: { status: variant === "pending" ? "pending" : "ready", candidates: candidates.map((c, i) => ({
      candidate_id: c.id, product_id: products[i].product_id,
      image: variant === "missing" ? null : !zero ? photoImage(`demo-${names[i]}`, ...photos[names[i]], `${c.name}`) : image(names[i + 3], `${c.name}`),
    })), selected: null },
  };
}
export function selectedMedia(report, candidate) {
  const binding = report.media.candidates.find(item => item.candidate_id === candidate.id);
  const name = binding?.product_id.replace("demo-product-", "");
  const scene = scenes[name] || scenes[{ letter: "notebook", walk: "workshop", memories: "art" }[name]];
  const selectedImage = scene && variant !== "missing" ? photoImage(`demo-wrap-${name}`, ...scene.slice(0, 3), `${candidate.name}的包装与赠礼场景`) : null;
  const unknown = () => ({ status: "unknown", value: null, unit: null, sources: [] });
  return { contract_version: "retrieval-media-v2", status: selectedImage ? "ready" : "unavailable", candidates: report.media.candidates, selected: { candidate_id: candidate.id,
    task_id: `preview-media-${report.recommendation_run_id}-${candidate.id}`, product_id: binding?.product_id || null, status: selectedImage ? "ready" : "unavailable",
    image: selectedImage,
    physical: { dimensions: unknown(), shape: unknown(), weight: unknown(), fragility: unknown(), materials: unknown() },
    packaging: { form: name === "workshop" || name === "walk" ? "irregular" : name === "art" || name === "memories" ? "paper_wrap" : "combination", description: "顺着礼物的形状包，不硬套方盒；留一点缎带的自然弧度。", scale: { status: "illustrative", note: null } },
    scene: { description: "礼物为主体，保留完整造景、自然光影与背景。", props: ["背景植物、桌面和摄影道具"], props_are_included: false, text_baked_in: false },
    unknowns: [],
    annotations: selectedImage ? (scene?.[3] || []).map(([text, x, y, lx, ly], i) => ({ id: `detail-${i + 1}`, image_version: selectedImage.version, text_style: "handwritten", curve: null, text, target: { x, y }, label: { x: lx, y: ly } })) : [],
  } };
}
