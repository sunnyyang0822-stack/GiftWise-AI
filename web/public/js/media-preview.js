// Issue #60 sidecar 草案夹具。仅供界面预览（?preview=1），不是检索证据或图像服务响应。
//
// 2026-10-31 调整（前端真实接入 · 答辩风险处置）：
//   这里原来用 Pexels 素材伪造商品图（kind:"demo"，url 指向 /img/media-demo/*.jpg）
//   并配一组 SVG 占位插画。media-view.js 的 kind 表里 demo 的标注是空字符串，
//   所以这些图**没有任何标注**，在页面上会被读成"已经联通真实商品图"。
//   现在删除全部伪造图，预览模式如实返回"没有图片"：
//   候选卡片只显示方案文字与「暂无图片，文字结果仍可查看。」。
//   正式链路的图片只能来自后端响应，且只有两种被允许的形态：
//     · kind:"source_photo"  真实抓取到的商品图（带真实 source_url 与来源署名）
//     · kind:"ai_illustration" 明确标注「AI 效果示意」的生成图（带"非商品实拍"声明）
//   前端不再自己造任何一张图。

const unknown = () => ({ status: "unknown", value: null, unit: null, sources: [] });

/**
 * 预览夹具：候选侧的检索/媒体绑定。
 * 不生成任何图片：image_id 与 image 恒为 null，与后端
 * retrieval/evidence.mjs（image_id:null）在未启用真实检索时的表现一致。
 * @param {Array<{id:string,name:string,estimated_total:string}>} candidates
 * @param {boolean} zero 是否为零预算路径（保留入参以兼容调用方；不再影响图片）
 */
export function recommendationMedia(candidates, zero = false) {
  const list = Array.isArray(candidates) ? candidates : [];
  const products = list.map((c, i) => ({
    product_id: `preview-product-${i + 1}`,
    name: c.name,
    variant: null,
    quantity: 1,
    price_amount: c.estimated_total,
    currency: "CNY",
    price_conditions: [],
    price_source: "seed",
    source_url: null,
    observed_at: null,
    image_id: null,
    price_range: null,
    shipping_status: "unknown",
    stock_status: "unknown",
    evidence_ref: null,
  }));
  return {
    retrieval: {
      status: "unavailable",
      evidence_id: null,
      products,
      warnings: ["预览模式不提供真实商品图与真实来源；这些标签只用于检查页面接线。"],
    },
    media: {
      contract_version: "retrieval-media-v2",
      status: "unavailable",
      candidates: list.map((c, i) => ({ candidate_id: c.id, product_id: products[i].product_id, image: null })),
      selected: null,
    },
  };
}

/**
 * 预览夹具：选定后的媒体视图。
 * image 恒为 null、annotations 恒为空 —— 预览模式不画任何包装效果图。
 * packaging.description 只是文本演示，且明确写了「不生成效果图」，不冒充图像服务输出。
 */
export function selectedMedia(report, candidate) {
  const binding = (report.media?.candidates || []).find(item => item.candidate_id === candidate.id);
  return {
    contract_version: "retrieval-media-v2",
    status: "unavailable",
    candidates: report.media?.candidates || [],
    selected: {
      candidate_id: candidate.id,
      // 预览模式没有真实生图任务，因此没有可轮询的 64 位十六进制 task_id。
      task_id: null,
      product_id: binding?.product_id || null,
      status: "unavailable",
      image: null,
      physical: { dimensions: unknown(), shape: unknown(), weight: unknown(), fragility: unknown(), materials: unknown() },
      packaging: {
        form: "undetermined",
        description: "预览模式不生成包装效果图；正式链路会基于所选礼物给出包装与配色建议。",
        scale: { status: "illustrative", note: null },
      },
      scene: { description: null, props: [], props_are_included: false, text_baked_in: false },
      unknowns: ["预览模式没有图像服务；本屏图片位留空，文字仅用于检查页面接线"],
      annotations: [],
    },
  };
}
