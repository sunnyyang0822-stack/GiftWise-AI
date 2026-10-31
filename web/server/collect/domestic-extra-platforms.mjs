/** 国内补充交易来源。实现状态与真实接通状态分开；没有公开搜索证据时只读实际商品链接。 */
const configs = [
  { id: 'yanxuan', name: '网易严选', source_site: 'you.163.com', hosts: ['you.163.com'], search: 'https://you.163.com/search', query: 'keyword', links: 'a[href*="/item/detail?id="]', cards: '.m-product, .item', productPath: '^/item/detail$', idKey: 'id', root: '.m-detail', title: '.name, .item-name', price: '.price .num, .m-price .num', gallery: '.m-slide img, .m-picList img', sku: '.spec-item.active, .spec-item.selected' },
  { id: 'xiaomi', name: '小米商城', source_site: 'mi.com', hosts: ['www.mi.com', 'mi.com'], search: 'https://www.mi.com/shop/search', query: 'keyword', links: 'a[href*="/shop/buy/detail?product_id="], a[href*="/buy/detail?product_id="]', cards: '.goods-item, .product-item', productPath: '^/(shop/)?buy/detail$', idKey: 'product_id', root: '.product-detail, .buy-box', title: '.product-title, h1', price: '.product-price, .price-info', gallery: '.img-con img, .swiper-slide img', sku: '.options-box .active, .options-box .selected' },
  { id: 'xiaohongshu_shop', name: '小红书交易商品', source_site: 'xiaohongshu.com', hosts: ['www.xiaohongshu.com', 'pages.xiaohongshu.com'], productPath: '^/(goods-detail|goods)/[a-f0-9]{24}/?$', root: '[class*="goods-detail"], [class*="product-detail"], [data-testid="goods-detail"]', title: '[class*="goods-title"], [class*="product-title"]', price: '[class*="goods-price"], [class*="product-price"]', gallery: '[class*="goods-gallery"] img, [class*="product-gallery"] img', sku: '[class*="sku"] [aria-selected="true"], [class*="sku"] .selected' },
  { id: 'kuaishou', name: '快手电商', source_site: 'kwaixiaodian.com', hosts: ['app.kwaixiaodian.com'], productPath: '^/(web/kwaishop-goods-detail-page-app|merchant/shop/detail)$', idKey: 'id', root: '.goods-detail, [class*="goods-detail"], [data-testid="goods-detail"]', title: '.goods-title, [class*="goods-title"]', price: '.goods-price, [class*="goods-price"]', gallery: '.goods-gallery img, [class*="goods-gallery"] img', sku: '.sku .selected, [class*="sku"] [aria-selected="true"]' },
  { id: 'dewu', name: '得物', source_site: 'dewu.com', hosts: ['fast.dewu.com', 'm.dewu.com'], productPath: '^/router/product/ProductDetail$', idKey: 'spuId', root: '.product-detail, .goods-detail, [class*="ProductDetail"]', title: '.product-title, .goods-title', price: '.product-price, .goods-price', gallery: '.product-gallery img, .goods-gallery img', sku: '.sku .selected, .sku [aria-selected="true"]' },
];
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const cfgFor = platform => configs.find(c => c.id === platform);

function productUrl(value, cfg) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !cfg.hosts.includes(url.hostname) || !new RegExp(cfg.productPath, 'i').test(url.pathname)) return null;
    if (cfg.idKey && !/^\d+$/.test(url.searchParams.get(cfg.idKey) || '')) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

export const DOMESTIC_EXTRA_PLATFORMS = Object.freeze(Object.fromEntries(configs.map(cfg => [cfg.id, Object.freeze({
  id: cfg.id, name: cfg.name, source_site: cfg.source_site, purpose: 'purchase',
  capability: cfg.search ? 'keyword_search_and_product_dom' : 'product_url_dom',
  keyword_search_available: Boolean(cfg.search), opencli: null,
  installed_adapter_status: cfg.id === 'xiaohongshu_shop' ? '仅安装笔记适配器，不支持交易商品' : '安装包未发现该平台原生适配器',
  integration_status: 'implemented_not_live_verified',
  limitations: cfg.search ? ['关键词入口与DOM尚未完成真实浏览器验证', '只覆盖当前可见卡片，分页未核实'] : ['尚未核实公开Web关键词商品搜索；需要实际商品直链', '商品详情DOM/公开结构化数据读取未真实验证'],
  searchUrl: cfg.search ? keyword => { const q = clean(keyword); if (!q) throw new TypeError('关键词不能为空'); const url = new URL(cfg.search); url.searchParams.set(cfg.query, q); return url.href; } : null,
  acceptsProductUrl: url => Boolean(productUrl(url, cfg)),
  normalize: (raw, ctx) => normalizeExtraProduct(cfg.id, raw, ctx),
})])));

export function normalizeExtraProduct(platform, raw, ctx = {}) {
  const cfg = cfgFor(platform);
  if (!cfg) throw new TypeError('不支持的补充交易来源');
  const url = productUrl(raw.product_url || raw.url, cfg);
  if (!url || !clean(raw.title)) return null;
  const price_text = clean(raw.price_text || raw.price) || null;
  const explicitCny = raw.currency === 'CNY' || /[¥￥]|人民币|CNY|元/.test(price_text || '');
  const amount = explicitCny && price_text?.match(/^(?:[¥￥]\s*|人民币\s*|CNY\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:元)?$/);
  let image_url = null;
  try { const image = new URL(raw.image_url, url); if (raw.image_url && image.protocol === 'https:' && !image.username && !image.password && !image.port) image_url = image.href; } catch { /* 缺失图不编造 */ }
  return {
    record_kind: 'product', purpose: 'purchase', source_site: cfg.source_site, source_platform: platform,
    external_id: cfg.idKey ? url.searchParams.get(cfg.idKey) : url.pathname.split('/').filter(Boolean).at(-1),
    title: clean(raw.title), product_url: url.href, price_text, price_amount: amount ? amount[1].replace(/,/g, '') : null,
    currency: price_text && explicitCny ? 'CNY' : null,
    price_conditions: [...new Set([...(Array.isArray(raw.price_conditions) ? raw.price_conditions.filter(c => typeof c === 'string') : []), ...(price_text?.match(/券后|到手价|会员价|起批|起|定金|预售/g) || [])])],
    price_unit: clean(raw.price_unit) || price_text?.match(/元\s*\/\s*([^\s，,;；]+)/)?.[1]?.replace(/起$/, '') || null,
    specifications: clean(raw.specifications) || null, seller: clean(raw.seller) || null, location: clean(raw.location) || null,
    image_url, image_validation: null, image_provenance: image_url ? { page_kind: ctx.page_kind || 'search', product_url: url.href, validation_status: 'not_fetched' } : null,
    scraped_at: ctx.observed_at || null, price_observed_at: ctx.observed_at || null,
    query_params: { keyword: ctx.keyword ?? null, page: 1 },
    raw_excerpt: { price: price_text, observation_method: raw.observation_method || null },
  };
}

/** 仅读公开DOM和Product JSON-LD；不读应用store、Cookie、token、不调用内部API。 */
export function buildExtraPlatformReadScript(platform, pageKind = 'search') {
  const cfg = cfgFor(platform);
  if (!cfg) throw new TypeError('不支持的补充交易来源');
  if (!['search', 'detail'].includes(pageKind)) throw new TypeError('不支持的页面类型');
  return `(${readExtraDom.toString()})(${JSON.stringify(cfg)},${JSON.stringify(pageKind)})`;
}

function readExtraDom(cfg, pageKind) {
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = text(document.body);
  const initial = { page_kind: pageKind, page_url: location.href, records: [] };
  if (/验证码|安全验证|访问受限|异常访问|访问频繁/.test(body) || /captcha|risk_handler|_____tmd_____/i.test(location.pathname)) return { ...initial, status: 'restricted' };
  if (/请先登录|扫码登录|登录后查看/.test(body) || /passport|login|signin/i.test(location.hostname + location.pathname)) return { ...initial, status: 'login_required' };
  if (/服务异常，请联系客服|系统繁忙|系统错误/.test(body)) return { ...initial, status: 'service_unavailable' };
  if (!cfg.hosts.includes(location.hostname)) return { ...initial, status: 'redirected' };
  const validProduct = value => {
    try { const url = new URL(value, location.href); return url.protocol === 'https:' && !url.username && !url.password && !url.port && cfg.hosts.includes(url.hostname) && new RegExp(cfg.productPath, 'i').test(url.pathname) && (!cfg.idKey || /^\d+$/.test(url.searchParams.get(cfg.idKey) || '')) ? url : null; } catch { return null; }
  };
  const notRecommendation = node => node && !node.closest('[class*="recommend"], [class*="Recommend"], .related-products');
  if (pageKind === 'search') {
    if (!cfg.search) return { ...initial, status: 'keyword_search_not_available' };
    for (const card of document.querySelectorAll(cfg.cards)) {
      const link = card.querySelector(cfg.links), url = validProduct(link?.href);
      if (!url) continue;
      const image = card.querySelector('img');
      const title = text(card.querySelector('.name, .goods-name, .product-name')) || link.getAttribute('title') || image?.alt;
      if (!title) continue;
      initial.records.push({ title, product_url: url.href, price_text: text(card.querySelector('.price, .retailPrice, .goods-price')) || null, image_url: image?.currentSrc || image?.getAttribute('data-src') || image?.src || null, observation_method: 'search_dom' });
    }
  } else {
    const current = validProduct(location.href);
    if (!current) return { ...initial, status: 'not_product_page' };
    const sameProduct = value => { const url = validProduct(value); return url && url.pathname === current.pathname && (!cfg.idKey || url.searchParams.get(cfg.idKey) === current.searchParams.get(cfg.idKey)); };
    // 结构化数据必须带与当前商品一致的URL，不采集推荐区Product数组或无归属对象。
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data; try { data = JSON.parse(node.textContent || ''); } catch { continue; }
      const entries = Array.isArray(data) ? data : data?.['@graph'] || [data];
      for (const product of entries) {
        const types = Array.isArray(product?.['@type']) ? product['@type'] : [product?.['@type']];
        if (!types.includes('Product') || !sameProduct(product.url || product['@id']) || !product.name) continue;
        const offer = !Array.isArray(product.offers) ? product.offers : null;
        const image = Array.isArray(product.image) ? product.image[0] : product.image;
        initial.records.push({ title: String(product.name), product_url: current.href, price_text: offer?.price !== undefined ? String(offer.price) : offer?.lowPrice !== undefined ? `${offer.lowPrice}-${offer.highPrice ?? offer.lowPrice}` : null, currency: offer?.priceCurrency || null, image_url: typeof image === 'string' ? image : image?.url || null, seller: offer?.seller?.name || null, specifications: null, observation_method: 'product_json_ld' });
      }
    }
    if (!initial.records.length) {
      const root = document.querySelector(cfg.root);
      if (!root) return { ...initial, status: 'product_dom_unavailable' };
      const first = selector => Array.from(root.querySelectorAll(selector)).find(notRecommendation);
      const title = text(first(cfg.title)), image = first(cfg.gallery);
      if (title) initial.records.push({ title, product_url: current.href, price_text: text(first(cfg.price)) || null, specifications: Array.from(root.querySelectorAll(cfg.sku)).filter(notRecommendation).map(text).filter(Boolean).join('；') || null, image_url: image?.getAttribute('data-origin') || image?.currentSrc || image?.getAttribute('data-src') || image?.src || null, observation_method: 'product_dom' });
    }
  }
  return { ...initial, status: initial.records.length ? 'ok' : 'empty_or_selector_changed' };
}

/** 模型明确选择platform；只搜索一次或读取调用方提供的白名单商品URL，不构造虚假商品ID。 */
export async function runExtraPlatformSearch(page, { platform, keyword, productUrls = [], maxPages = 1, signal } = {}) {
  const cfg = cfgFor(platform), source = DOMESTIC_EXTRA_PLATFORMS[platform];
  if (!cfg) throw new TypeError('不支持的补充交易来源');
  const coverage = { source: platform, keyword: keyword ?? null, status: 'not_observed', pages_completed: 0, complete: false, limitations: [...source.limitations], pages: [] };
  const records = [], seen = new Set();
  const supplied = Array.isArray(productUrls) ? productUrls : [];
  const explicit = supplied.slice(0, 30).map(url => productUrl(url, cfg)).filter(Boolean);
  coverage.product_urls_requested = supplied.length;
  coverage.product_urls_rejected = Math.min(30, supplied.length) - explicit.length;
  const jobs = supplied.length ? explicit.map(url => ({ url: url.href, page_kind: 'detail' })) : source.searchUrl ? [{ url: source.searchUrl(keyword), page_kind: 'search' }] : [];
  if (!jobs.length) { coverage.status = supplied.length ? 'product_url_not_allowed' : 'product_link_required'; return { records, coverage }; }
  if (Number(maxPages) > 1 && !explicit.length) coverage.limitations.push('分页未经核实，未重复首屏冒充分页结果');
  if (supplied.length > 30) coverage.limitations.push('本次最多观察30个明确商品链接');
  for (const job of jobs) {
    if (signal?.aborted) { coverage.status = 'aborted'; break; }
    try {
      await page.goto(job.url);
      if (page.wait) await page.wait(2);
      if (signal?.aborted) { coverage.status = 'aborted'; break; }
      const result = await page.evaluate(buildExtraPlatformReadScript(platform, job.page_kind));
      if (signal?.aborted) { coverage.status = 'aborted'; break; }
      const observed_at = new Date().toISOString();
      coverage.status = result.status;
      if (job.page_kind === 'detail') {
        const expected = productUrl(job.url, cfg), actual = productUrl(result.page_url, cfg);
        if (result.status === 'ok' && (!actual || actual.pathname !== expected.pathname || (cfg.idKey && actual.searchParams.get(cfg.idKey) !== expected.searchParams.get(cfg.idKey)))) coverage.status = 'product_changed';
      }
      const normalized = coverage.status === 'ok' ? (result.records || []).map(raw => normalizeExtraProduct(platform, raw, { keyword, observed_at, page_kind: job.page_kind })).filter(Boolean) : [];
      if (coverage.status === 'ok' && !normalized.length) coverage.status = 'no_valid_products';
      coverage.pages.push({ page_kind: job.page_kind, requested_url: job.url, status: coverage.status, observed_at, count: normalized.length });
      if (coverage.status !== 'ok') continue;
      coverage.pages_completed++;
      for (const record of normalized) if (!seen.has(record.product_url)) { seen.add(record.product_url); records.push(record); }
    } catch { coverage.status = signal?.aborted ? 'aborted' : 'failed'; coverage.pages.push({ page_kind: job.page_kind, status: coverage.status }); }
  }
  coverage.complete = coverage.pages_completed === jobs.length && !coverage.product_urls_rejected && supplied.length <= 30 && (explicit.length > 0 || Number(maxPages) <= 1);
  coverage.scope = explicit.length ? 'supplied_product_urls_only' : 'visible_first_page_only';
  return { records, coverage };
}
