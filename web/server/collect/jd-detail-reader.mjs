/** 京东详情的只读 DOM 观察与纯标准化；不导航、不联网、不读认证材料。 */
function readJdDetail() {
  const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const excluded = '.recommend, .recommendations, .recommend-wrap, [class*="recommend"], [class*="Recommend"], .related-products, .avatar, [class*="avatar"]';
  const usable = node => node && !node.closest(excluded);
  const root = document.querySelector('.page-content-main') || document.querySelector('.product-intro');
  const source_url = location.href;
  const observed_at = new Date().toISOString();
  if (!root) return { status: 'detail_root_missing', source_url, observed_at };
  const all = selector => Array.from(root.querySelectorAll(selector)).filter(usable);
  const text = node => clean(node?.innerText || node?.textContent);
  const first = selector => all(selector).map(text).find(Boolean) || null;
  const labels = selector => [...new Set(all(selector).map(text).filter(Boolean))];
  const selected = all('#choose-attrs .item.selected, .specification-item-sku.selected, .specification-item-sku.active, .specification-item-sku[aria-checked="true"], .specification-item-sku[aria-selected="true"]');
  const selected_specifications = selected.map(node => ({
    text: text(node.querySelector?.('.specification-item-sku-text') || node),
    sku: clean(node.getAttribute('data-sku') || node.getAttribute('data-skuid')) || null,
    href: node.getAttribute('href') || null,
  })).filter(item => item.text);
  // 只观察当前主图库，不把缩略候选、推荐区、头像或猜测URL当原图。
  const gallery = all('#spec-n1 img').map(node => ({
    url: clean(node.currentSrc || node.getAttribute('src')) || null,
    natural_width: node.naturalWidth || null,
    natural_height: node.naturalHeight || null,
    container: '#spec-n1',
    sku: clean(node.getAttribute('data-sku') || node.getAttribute('data-skuid')) || null,
  })).filter(item => item.url);
  return {
    status: 'ok', source_url, observed_at,
    title: first('.sku-title-text') || first('.sku-name'),
    price_text: first('.product-price--main') || first('.summary-price .p-price, .summary-price .price'),
    price_conditions: labels('.product-price--activity-item'),
    secondary_price_text: first('.product-price--gray'),
    price_context: first('.product-price-panel') || first('.summary-price'),
    selected_specifications,
    specification_options: labels('.specification-item-sku-text'),
    gallery,
  };
}

export function buildJdDetailReadScript() {
  return `(${readJdDetail.toString()})()`;
}

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
function jdUrl(value) {
  try {
    const url = new URL(value);
    const match = /^\/(\d+)\.html$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'item.jd.com' || url.port || url.username || url.password || !match) return null;
    return { url: `https://item.jd.com/${match[1]}.html`, sku: match[1] };
  } catch { return null; }
}
const dimension = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const strings = value => Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];

/** ctx 的 source_url/product_url 与 external_id/sku 若提供，必须全部与实际详情一致。 */
export function normalizeJdDetail(raw, ctx = {}) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const actual = jdUrl(raw.source_url);
  const expectedUrls = [ctx.source_url, ctx.product_url].filter(value => value != null);
  const expectedSkus = [ctx.external_id, ctx.sku].filter(value => value != null).map(String);
  const sameSku = !!actual && expectedUrls.every(value => jdUrl(value)?.sku === actual.sku) && expectedSkus.every(value => value === actual.sku);
  const status = !sameSku ? 'product_identity_mismatch' : raw.status !== 'ok' ? clean(raw.status) || 'detail_read_failed' : 'ok';
  const valid = status === 'ok';
  const title = valid ? clean(raw.title) || null : null;
  const observation = {
    platform: 'jd', page_kind: 'detail', status,
    observed_at: clean(raw.observed_at) || clean(ctx.observed_at) || null,
    verification_status: valid ? 'page_observed' : 'not_verified',
    price_text: valid ? clean(raw.price_text) || null : null,
    price_context: valid ? clean(raw.price_context) || null : null,
    selected_specifications: valid && Array.isArray(raw.selected_specifications) ? raw.selected_specifications.map(item => ({ text: clean(item?.text), sku: clean(item?.sku) || null, href: clean(item?.href) || null })) : [],
    specification_options: valid ? strings(raw.specification_options) : [],
    image_verification: 'dom_observed_only',
  };
  let specifications = null, specifications_basis = null;
  if (valid) {
    const selected = observation.selected_specifications.filter(item => {
      if (!item.text || (item.sku && item.sku !== actual.sku)) return false;
      if (!item.href) return true;
      try { return jdUrl(new URL(item.href, actual.url).href)?.sku === actual.sku; } catch { return false; }
    });
    if (selected.length) {
      specifications = [...new Set(selected.map(item => item.text))].join('；');
      specifications_basis = 'selected_dom';
    } else if (title) {
      // 只匹配标题尾部完整规格标签；最长标签优先，防止套装降格为单件/子套装。
      const exact = strings(raw.specification_options).filter(option => title === option || title.endsWith(` ${option}`)).sort((a, b) => b.length - a.length);
      if (exact.length) { specifications = exact[0]; specifications_basis = 'title_exact_option'; }
    }
  }
  const priceText = observation.price_text;
  const price = /^(?:[¥￥]\s*|CNY\s*)(\d+(?:\.\d{1,2})?)$/.exec(priceText || '');
  let image = null;
  if (valid && Array.isArray(raw.gallery)) {
    image = raw.gallery.find(item => {
      if (item?.container !== '#spec-n1' || (item.sku && String(item.sku) !== actual.sku)) return false;
      try {
        const url = new URL(item.url, actual.url);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === '360buyimg.com' || url.hostname.endsWith('.360buyimg.com'));
      } catch { return false; }
    }) || null;
  }
  return {
    title, specifications, specifications_basis,
    price_amount: price ? price[1] : null, currency: price ? 'CNY' : null,
    price_conditions: valid ? strings(raw.price_conditions) : [],
    secondary_price_text: valid ? clean(raw.secondary_price_text) || null : null,
    page_kind: 'detail', source_url: sameSku ? actual.url : null,
    image_url: image ? new URL(image.url, actual.url).href : null,
    image_natural_width: image ? dimension(image.natural_width) : null,
    image_natural_height: image ? dimension(image.natural_height) : null,
    observation,
  };
}
