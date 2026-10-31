/** 阿里系只读DOM补强。仅page.evaluate，不创建浏览器、不导航、不读认证或应用store。未真实验证。 */
const CONFIG = {
  taobao: { site: 'taobao.com', hosts: ['taobao.com', 'tmall.com'], cards: '[class*="doubleCard--"], .item', title: '[class*="title--"], .title', integer: '[class*="priceInt--"]', decimal: '[class*="priceFloat--"]', price: '[class*="price--"], .price', seller: '[class*="shopName--"], .shopname', location: '[class*="procity--"]' },
  tmall: { site: 'tmall.com', hosts: ['taobao.com', 'tmall.com'], cards: '[class*="doubleCard--"], .product', title: '[class*="title--"], .productTitle', integer: '[class*="priceInt--"]', decimal: '[class*="priceFloat--"]', price: '[class*="price--"], .productPrice', seller: '[class*="shopName--"], .productShop', location: '[class*="procity--"]' },
  '1688': { site: '1688.com', hosts: ['1688.com'], cards: '[data-offer-id], [data-offerid], [offer-id], .offer-list-row-offer, .offer-card-wrapper, .search-offer-wrapper, .offer-item', title: '.offer-title-row .title-text, .offer-title-row, .title-text', integer: '.offer-price-row .price-integer, .offer-price-row .price-int', decimal: '.offer-price-row .price-decimal', price: '.offer-price-row .price-item, .offer-price-row .price, .offer-price', seller: '.offer-shop-row .shop-name, .offer-company-row, .company-name', location: '.offer-location, .offer-address', moq: '.offer-moq, .moq, .offer-hover-wrapper .hover-price-item' },
};

/** 只从真实直链或明确DOM offer-id构造规范链接；不采用spm/追踪ID/标题猜SKU。 */
export function canonicalAlibabaProductUrl(platform, value, { observedOfferId } = {}) {
  if (!['taobao', 'tmall', '1688'].includes(platform)) return null;
  let parsed;
  if (typeof value === 'string' && value.trim()) {
    try { parsed = new URL(value.startsWith('//') ? 'https:' + value : value); } catch { return null; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  }
  if (platform === '1688') {
    let id = null;
    if (parsed) {
      if (parsed.hostname === 'detail.1688.com') id = parsed.pathname.match(/^\/offer\/(\d+)\.html$/)?.[1] || null;
      if (parsed.hostname === 'detail.m.1688.com' && parsed.pathname === '/page/index.html') id = parsed.searchParams.get('offerId');
      if (!/^\d+$/.test(id || '')) return null;
      if (observedOfferId && String(observedOfferId) !== id) return null;
    } else if (/^\d+$/.test(String(observedOfferId || ''))) id = String(observedOfferId);
    return id ? `https://detail.1688.com/offer/${id}.html` : null;
  }
  if (!parsed) return null;
  let host;
  if (['item.taobao.com', 'detail.tmall.com'].includes(parsed.hostname) && parsed.pathname === '/item.htm') host = parsed.hostname;
  if (parsed.hostname === 'h5.m.taobao.com' && parsed.pathname === '/awp/core/detail.htm') host = 'item.taobao.com';
  if (!host) return null;
  const id = parsed.searchParams.get('id');
  if (!/^\d+$/.test(id || '')) return null;
  const url = new URL(`https://${host}/item.htm`);
  url.searchParams.set('id', id);
  const sku = parsed.searchParams.get('skuId') || parsed.searchParams.get('sku_id');
  if (/^\d+$/.test(sku || '')) url.searchParams.set('skuId', sku);
  return url.href;
}

/** 专用价格节点的数字与条件分离；销量/地名不进入price_text，不从全页选择最低价。 */
export function parseAlibabaPrice(raw = {}) {
  const c = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const integer = c(raw.price_integer).replace(/,/g, '');
  const fraction = c(raw.price_decimal).replace(/\s+/g, '');
  const source = /^\d+$/.test(integer) && (!fraction || /^\.?\d{1,2}$/.test(fraction)) ? integer + (fraction ? '.' + fraction.replace(/^\./, '') : '') : c(raw.price_text || raw.price);
  const compact = source.replace(/(\d)\s*\.\s*(?=\d)/g, '$1.').replace(/([¥￥])\s+/g, '$1');
  const numericText = compact.replace(/^(?:券后价|券后|补贴后|到手价|会员价|预售价|定金)\s*[:：]?\s*/, '');
  let match = numericText.match(/^(?:[¥￥]|人民币\s*|CNY\s*)?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(?:-|~|～|至)\s*(\d[\d,]*(?:\.\d+)?))?/);
  if (match && /^(?:人付款|人收货|人已购|月销|销量|已售)/.test(numericText.slice(match[0].length).trim())) match = null;
  const evidence = c(raw.currency_evidence);
  const foreign = (raw.currency && raw.currency !== 'CNY') || /USD|HKD|US\$|HK\$|€|£|\$/.test(source + ' ' + evidence);
  const cny = !foreign && (raw.currency === 'CNY' || /^(?:[¥￥]|人民币|CNY)/.test(numericText) || /^(?:[¥￥]|人民币|CNY|元)$/.test(evidence) || (match && /^\s*元/.test(numericText.slice(match[0].length))));
  const conditions = [...new Set([...(Array.isArray(raw.price_conditions) ? raw.price_conditions.filter(v => typeof v === 'string').map(c) : []), ...(compact.match(/券后价|券后|补贴后|到手价|会员价|预售价|定金|起批|起/g) || []), ...(c(raw.moq_text) ? [c(raw.moq_text)] : [])])];
  const start = conditions.some(v => v === '起' || v === '起批');
  const value = match ? match[1].replace(/,/g, '') : null;
  const high = match?.[2]?.replace(/,/g, '') || null;
  const unit = c(raw.price_unit) || compact.match(/元\s*\/\s*([^\s，,;；]+)/)?.[1]?.replace(/起$/, '') || null;
  return {
    price_text: match ? (cny ? '¥' : '') + value + (high ? '-' + high : '') + (unit ? '元/' + unit : '') : null,
    price_amount: cny && value && !high && !start ? value : null,
    price_min: cny && value && (high || start) ? value : null, price_max: cny && high ? high : null,
    currency: cny && match ? 'CNY' : null, price_conditions: conditions, price_unit: unit,
    price_kind: !match || !cny ? 'unknown' : high ? 'range' : start ? 'starting_at' : conditions.length ? 'conditional' : 'listed',
  };
}

export function normalizeAlibabaRecord(platform, raw, ctx = {}) {
  const cfg = CONFIG[platform];
  if (!cfg) throw new TypeError('不支持的阿里系交易平台');
  const url = canonicalAlibabaProductUrl(platform, raw.product_url || raw.item_url || raw.url, { observedOfferId: raw.offer_id_evidence === 'dom_attribute' ? raw.offer_id : undefined });
  const clean = v => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (!url || !clean(raw.title)) return null;
  const parsed = new URL(url), observed = ctx.observed_at || ctx.scrapedAt;
  const timestamp = observed && Number.isFinite(Date.parse(observed)) ? observed : null;
  const images = [...new Set([raw.image_url, ...(Array.isArray(raw.image_urls) ? raw.image_urls : [])].filter(v => typeof v === 'string' && v).map(value => {
    try { const image = new URL(value, url); return image.protocol === 'https:' && !image.username && !image.password && !image.port && (image.hostname === 'alicdn.com' || image.hostname.endsWith('.alicdn.com')) ? image.href : null; } catch { return null; }
  }).filter(Boolean))];
  return {
    record_kind: 'product', source_platform: platform, source_site: platform === '1688' ? cfg.site : parsed.hostname === 'detail.tmall.com' ? 'tmall.com' : 'taobao.com',
    external_id: platform === '1688' ? parsed.pathname.match(/\/offer\/(\d+)/)?.[1] : parsed.searchParams.get('id')+(parsed.searchParams.get('skuId')?':'+parsed.searchParams.get('skuId'):''), sku_id: parsed.searchParams.get('skuId'),
    title: clean(raw.title), product_url: url, ...parseAlibabaPrice(raw),
    seller: clean(raw.seller || raw.seller_name || raw.shop) || null, location: clean(raw.location) || null,
    specifications: clean(raw.specifications) || null,
    image_url: images[0] || null, image_urls: images, image_validation: null,
    image_provenance: images.length ? { page_kind: ctx.page_kind || 'search', product_url: url, validation_status: 'not_fetched' } : null,
    scraped_at: timestamp, price_observed_at: timestamp,
    query_params: { keyword: ctx.keyword ?? null, page: ctx.page ?? 1 },
    raw_excerpt: { price_node_text: clean(raw.price_node_text) || null, sales_text: clean(raw.sales_text || raw.sales) || null, moq_text: clean(raw.moq_text) || null },
  };
}

export function buildAlibabaSearchReadScript(platform) {
  const cfg = CONFIG[platform];
  if (!cfg) throw new TypeError('不支持的阿里系交易平台');
  return `(${readSearch.toString()})(${JSON.stringify({ ...cfg, platform })},(${canonicalAlibabaProductUrl.toString()}))`;
}

function readSearch(cfg, canonical) {
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = text(document.body);
  const diagnostics = { cards_seen: 0, links_confirmed: 0, missing_product_identity: 0 };
  const state = status => ({ status, records: [], diagnostics });
  if (/验证码|安全验证|访问受限|异常访问|请求太频繁/.test(body) || /captcha|_____tmd_____/.test(location.pathname)) return state('restricted');
  if (/请先登录|扫码登录|登录后查看/.test(body) || /login|passport|signin/i.test(location.hostname + location.pathname)) return state('login_required');
  if (!cfg.hosts.some(h => location.hostname === h || location.hostname.endsWith('.' + h))) return state('redirected');
  const roots = new Set(document.querySelectorAll(cfg.cards));
  if (cfg.platform === '1688') for (const anchor of document.querySelectorAll('a[href*="detail.1688.com/offer/"], a[href*="detail.m.1688.com/page/index.html"]')) {
    roots.add(anchor.closest(cfg.cards) || anchor.parentElement || anchor);
  }
  const records = [], seen = new Set();
  for (const card of roots) {
    diagnostics.cards_seen++;
    const candidates = [card, ...card.querySelectorAll('a[href]')];
    let url = null, offerId = null;
    for (const node of candidates) {
      const candidate = canonical(cfg.platform, node.href || node.getAttribute('href') || '');
      if (candidate) { url = candidate; break; }
    }
    if (!url && cfg.platform === '1688') {
      for (const node of [card, ...card.querySelectorAll('[data-offer-id], [data-offerid], [offer-id]')]) {
        const id = node.getAttribute('data-offer-id') || node.getAttribute('data-offerid') || node.getAttribute('offer-id');
        if (/^\d+$/.test(id || '')) { offerId = id; url = canonical('1688', '', { observedOfferId: id }); break; }
      }
    }
    if (!url) { diagnostics.missing_product_identity++; continue; }
    if (seen.has(url)) continue;
    const titleNode = card.querySelector(cfg.title), image = card.querySelector('img:not([class*="avatar"])');
    const title = text(titleNode) || titleNode?.getAttribute('title') || image?.alt || '';
    if (!title) continue;
    const priceNode = card.querySelector(cfg.price);
    const priceNodeText = text(priceNode);
    const labels = Array.from(card.querySelectorAll('[class*="priceTag--"], [class*="priceDesc--"], [class*="priceType--"], .price-condition')).map(text).join(' ');
    const currencyNode = card.querySelector('[class*="priceSymbol--"], [class*="currency--"], .price-symbol');
    seen.add(url); diagnostics.links_confirmed++;
    records.push({ title, product_url: url, offer_id: offerId, offer_id_evidence: offerId ? 'dom_attribute' : null,
      price_integer: text(card.querySelector(cfg.integer)), price_decimal: text(card.querySelector(cfg.decimal)),
      price_text: priceNodeText, price_node_text: priceNodeText || null, currency_evidence: text(currencyNode) || priceNodeText.match(/[¥￥]|人民币|CNY|元/)?.[0] || null,
      price_conditions: (labels + ' ' + priceNodeText).match(/券后价|券后|补贴后|到手价|会员价|预售价|定金|起批|起/g) || [],
      seller: text(card.querySelector(cfg.seller)) || null, location: text(card.querySelector(cfg.location)) || null,
      moq_text: cfg.moq ? text(card.querySelector(cfg.moq)) || null : null,
      sales_text: text(card.querySelector('[class*="realSales--"], .offer-price-row .col-desc_after')) || null,
      image_url: image?.getAttribute('data-origin') || image?.currentSrc || image?.getAttribute('data-src') || image?.src || null,
    });
  }
  return { status: records.length ? 'ok' : diagnostics.cards_seen ? 'no_valid_product_links' : 'empty_or_selector_changed', records, diagnostics };
}

export function buildAlibabaDetailReadScript(platform) {
  if (!['taobao', 'tmall'].includes(platform)) throw new TypeError('详情补强仅适用淘宝/天猫');
  return `(${readDetail.toString()})(${JSON.stringify(platform)},(${canonicalAlibabaProductUrl.toString()}))`;
}

function readDetail(platform, canonical) {
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = text(document.body);
  const base = { page_kind: 'detail', product_url: canonical(platform, location.href), title: null, specifications: null, image_url: null, image_urls: [], price_text: null };
  if (/验证码|安全验证|访问受限|异常访问/.test(body) || /captcha|_____tmd_____/.test(location.pathname)) return { ...base, status: 'restricted' };
  if (/请先登录|扫码登录|登录后查看/.test(body) || /login|passport|signin/i.test(location.hostname + location.pathname)) return { ...base, status: 'login_required' };
  if (!base.product_url) return { ...base, status: 'not_product_page' };
  let root = document.querySelector('#detail, [class*="ItemDetail--"], [class*="BasicContent--"], [class*="ProductDetail--"], [class*="ItemDetailPage--"]');
  if(!root&&document.querySelector('[class*="mainTitle--"]')&&document.querySelector('[class*="picGallery--"]'))root=document.body;
  if (!root) return { ...base, status: 'detail_root_missing' };
  const usable = node => node && !node.closest('[class*="recommend"], [class*="Recommend"], .related-products');
  const first = selector => Array.from(root.querySelectorAll(selector)).find(usable);
  base.title = text(first('[class*="mainTitle--"], .tb-main-title, .tb-detail-hd h1')) || null;
  const priceNode = first('[class*="Price--priceText"], [class*="priceText--"], .tm-price-panel .tm-price, .tb-property .tb-rmb-num');
  const priceContext = first('[class*="Price--"], [class*="price--"], .tm-price-panel, .tb-property');
  base.price_text = text(priceNode) || null;
  base.currency_evidence = text(priceContext).match(/[¥￥]|人民币|CNY|元/)?.[0] || null;
  base.price_conditions = text(priceContext).match(/券后价|券后|补贴后|到手价|会员价|预售价|定金|起批|起/g) || [];
  const selected = Array.from(root.querySelectorAll('[class*="skuItem--"][class*="selected"], [class*="SkuItem--"][class*="selected"], [class*="skuValue--"][class*="selected"], .tb-sku .tb-selected, [data-sku-id][aria-selected="true"]')).filter(usable);
  base.specifications = [...new Set(selected.map(text).filter(Boolean))].join('；') || null;
  const selectedSku = [...new Set(selected.map(node => node.getAttribute('data-sku-id') || node.getAttribute('data-skuid')).filter(id => /^\d+$/.test(id || '')))];
  if (selectedSku.length === 1) { const url = new URL(base.product_url); url.searchParams.set('skuId', selectedSku[0]); base.product_url = url.href; }
  const images = Array.from(root.querySelectorAll('#J_ImgBooth, #J_UlThumb img, [class*="PicGallery--"] img, [class*="picGallery--"] img, [class*="mainPic--"] img, [class*="mainImage--"] img')).filter(usable);
  base.image_urls = [...new Set(images.map(image => image.getAttribute('data-origin') || image.getAttribute('jqimg') || image.currentSrc || image.getAttribute('data-src') || image.src).filter(Boolean))];
  base.image_url = base.image_urls[0] || null;
  return { ...base, status: base.title ? 'ok' : 'detail_title_missing' };
}

/** 主调度器负责导航，此接口只读当前页并返回明确有效记录数。 */
export async function readAlibabaSearch(page, { platform, keyword, observed_at = new Date().toISOString() } = {}) {
  const result = await page.evaluate(buildAlibabaSearchReadScript(platform));
  const records = (result.records || []).map(raw => normalizeAlibabaRecord(platform, raw, { keyword, observed_at, page_kind: 'search' })).filter(Boolean);
  return { status: result.status === 'ok' && !records.length ? 'no_valid_product_links' : result.status, records, diagnostics: result.diagnostics, observed_at };
}

export async function readAlibabaDetail(page, { platform, productUrl, observed_at = new Date().toISOString() } = {}) {
  const expected = canonicalAlibabaProductUrl(platform, productUrl);
  if (!expected) return { status: 'product_url_not_allowed', record: null, observed_at };
  const raw = await page.evaluate(buildAlibabaDetailReadScript(platform));
  const actual = canonicalAlibabaProductUrl(platform, raw.product_url);
  const sameProduct = expected && actual && new URL(expected).searchParams.get('id') === new URL(actual).searchParams.get('id');
  const record = raw.status === 'ok' && sameProduct ? normalizeAlibabaRecord(platform, raw, { observed_at, page_kind: 'detail' }) : null;
  return { status: raw.status === 'ok' && !sameProduct ? 'product_changed' : raw.status, record, observed_at };
}
