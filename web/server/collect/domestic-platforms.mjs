/** 国内直接来源。注册表示有可执行的只读实现，不表示登录/访问/字段已实测成功。 */
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const pageNumber = value => Math.max(1, Math.floor(Number(value) || 1));
const definitions = [
  ['taobao', '淘宝', 'taobao.com', 'https://s.taobao.com/search', 'q', 's', 44, ['item.taobao.com'], 'a[href*="item.taobao.com/item.htm"]', '[class*="doubleCard"], [class*="Card"], .item', 'taobao', 40],
  ['tmall', '天猫', 'tmall.com', 'https://list.tmall.com/search_product.htm', 'q', 's', 60, ['detail.tmall.com'], 'a[href*="detail.tmall.com/item.htm"]', '.product, [class*="Card"], [class*="card"]'],
  ['jd', '京东', 'jd.com', 'https://search.jd.com/Search', 'keyword', 'page', 0, ['item.jd.com'], 'a[href*="item.jd.com/"]', '.gl-item, [data-sku]', 'jd', 30],
  ['pinduoduo', '拼多多', 'pinduoduo.com', 'https://mobile.yangkeduo.com/search_result.html', 'search_key', null, 0, ['yangkeduo.com', 'pinduoduo.com'], 'a[href*="goods.html"], a[href*="goods_id="]', '[class*="goods"], [class*="Goods"], [class*="item"]'],
  ['douyin', '抖音电商', 'jinritemai.com', 'https://haohuo.jinritemai.com/ecommerce/search/index.html', 'keyword', null, 0, ['jinritemai.com', 'douyin.com'], 'a[href*="/goods/"], a[href*="product_id="], a[href*="/product/"]', '[class*="product"], [class*="Product"], [class*="goods"]'],
  ['kuaishou', '快手电商', 'kwaixiaodian.com', 'https://www.kwaixiaodian.com/', null, null, 0, ['kwaixiaodian.com', 'kuaishou.com'], 'a[href*="/goods/"], a[href*="itemId="], a[href*="/item/"]', '[class*="goods"], [class*="Goods"], [class*="item"]'],
  ['1688', '1688', '1688.com', 'https://s.1688.com/selloffer/offer_search.htm', 'keywords', 'beginPage', 0, ['detail.1688.com', 'detail.m.1688.com'], 'a[href*="/offer/"], a[href*="offerId="]', '.offer-list-row-offer, [class*="offer"], [class*="card"]', '1688', 100],
  ['vip', '唯品会', 'vip.com', 'https://category.vip.com/suggest.php', 'keyword', 'page', 0, ['detail.vip.com'], 'a[href*="detail.vip.com/detail-"]', '.goods-item, [class*="goods-item"], [class*="goodsItem"]'],
  ['suning', '苏宁易购', 'suning.com', 'https://search.suning.com/', null, null, 0, ['product.suning.com'], 'a[href*="product.suning.com/"]', '.item-wrap, .product-box, .item-bg'],
  ['youpin', '小米有品', 'xiaomiyoupin.com', 'https://www.xiaomiyoupin.com/search', 'keyword', null, 0, ['xiaomiyoupin.com'], 'a[href*="/detail?gid="], a[href*="/detail/"]', '.m-goods-item-container, [class*="goods-item"], [class*="product"]'],
  ['dewu', '得物', 'dewu.com', 'https://www.dewu.com/', null, null, 0, ['dewu.com', 'poizon.com'], 'a[href*="/product/"], a[href*="spuId="], a[href*="/goods/"]', '[class*="goods"], [class*="product"], [class*="item"]'],
  ['xianyu', '闲鱼', 'goofish.com', 'https://www.goofish.com/search', 'q', null, 0, ['goofish.com'], 'a[href*="/item?id="]', '[class*="feeds-item"], [class*="card"], [class*="Card"]', 'xianyu', 60],
  ['dangdang', '当当', 'dangdang.com', 'https://search.dangdang.com/', 'key', 'page_index', 0, ['product.dangdang.com'], 'a[href*="product.dangdang.com/"]', 'li[ddt-pit], .bigimg li, .shoplist li'],
];

function allowedUrl(value, domains, base) {
  if (!clean(value)) return null;
  try {
    const url = new URL(value, base);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    return domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}

export const DOMESTIC_PLATFORMS = Object.freeze(Object.fromEntries(definitions.map(([id, name, source_site, base, queryKey, pageKey, offset, domains, links, cards, opencli, maxLimit]) => {
  const platform = {
    id, name, source_site, domains, links, cards,
    // 得物/快手没有经核实可用的公开Web关键词入口，只探测官网并如实返回限制。
    capability: queryKey || id === 'suning' ? 'dom_search' : 'homepage_probe_only',
    pagination: pageKey ? 'url_page' : 'first_page_only',
    integration_status: 'implemented_unverified',
    opencli: opencli ? { command: `${opencli} search`, maxLimit, pagination: id === '1688' ? '自动最多12页' : id === 'xianyu' ? '自动最多2页' : '仅首屏滚动，无分页参数', args: (keyword, limit = 20) => [opencli, 'search', keyword, '--limit', String(Math.min(maxLimit, Math.max(1, Number(limit) || 20)))] } : null,
    searchUrl(keyword, city, page = 1) {
      const q = clean(keyword);
      if (!q) throw new TypeError('检索关键词不能为空');
      if (id === 'suning') return `https://search.suning.com/${encodeURIComponent(q)}/`;
      const url = new URL(base);
      if (queryKey) url.searchParams.set(queryKey, q);
      if (pageKey) url.searchParams.set(pageKey, String(offset ? (pageNumber(page) - 1) * offset : id === 'jd' ? pageNumber(page) * 2 - 1 : pageNumber(page)));
      return url.href;
    },
    normalize(record, ctx = {}) { return normalizeDomesticRecord(id, record, ctx); },
  };
  return [id, Object.freeze(platform)];
})));

export function normalizeDomesticRecord(id, record, ctx = {}) {
  const platform = DOMESTIC_PLATFORMS[id];
  if (!platform) throw new TypeError('不支持的国内来源');
  const product_url = allowedUrl(record.product_url || record.item_url || record.url, platform.domains);
  if (!product_url || !clean(record.title)) return null;
  const price_text = clean(record.price_text || record.price) || null;
  // 保留区间、起批、券后等原文；区间或条件价不能静默变为确定报价。
  const amount = price_text?.match(/^(?:[¥￥]\s*|人民币\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:元)?$/);
  const observed = ctx.scrapedAt || ctx.observedAt;
  const scraped_at = observed && Number.isFinite(Date.parse(observed)) ? observed : null;
  return {
    record_kind: 'product', source_site: platform.source_site,
    external_id: clean(record.item_id || record.offer_id || record.sku) || null,
    title: clean(record.title), price_text, price_amount: amount ? amount[1].replace(/,/g, '') : null,
    currency: price_text ? 'CNY' : null,
    price_unit: clean(record.price_unit) || price_text?.match(/(?:元|[¥￥])\s*\/\s*([^\s，,;；]+)/)?.[1] || null,
    price_conditions: [...new Set([...(Array.isArray(record.price_conditions) ? record.price_conditions.filter(v => typeof v === 'string') : []), ...(price_text?.match(/券后|补贴后|起批|起|预售|定金|会员价/g) || []), ...(clean(record.moq_text) ? [clean(record.moq_text)] : [])])],
    seller: clean(record.seller || record.seller_name || record.shop) || null,
    location: clean(record.location) || null, specifications: clean(record.specifications || record.condition) || null,
    product_url, image_url: allowedUrl(record.image_url, ['alicdn.com', '360buyimg.com', 'jd.com', 'pddpic.com', 'pinduoduo.com', 'byteimg.com', 'douyinpic.com', 'kwaicdn.com', 'kwimgs.com', 'vipstatic.com', 'suning.cn', 'suning.com', 'xiaomiyoupin.com', 'youpin.mi-img.com', 'mi-img.com', 'dewu.com', 'poizon.com', 'geilicdn.com', 'dangdang.com'], product_url),
    scraped_at, price_observed_at: scraped_at,
    query_params: { keyword: ctx.keyword ?? null, city: ctx.city ?? null, page: ctx.page ?? 1 },
    raw_excerpt: { price: price_text, moq_text: clean(record.moq_text) || null },
  };
}

/** OpenCLI page.evaluate 可直接执行；不读 Cookie/storage 或请求内部认证接口。 */
export function buildDomesticReadScript(id) {
  const p = DOMESTIC_PLATFORMS[id];
  if (!p) throw new TypeError('不支持的国内来源');
  return `(${readDomesticDom.toString()})(${JSON.stringify({ domains: [...p.domains, p.source_site, ...(id === 'tmall' ? ['taobao.com'] : [])], links: p.links, cards: p.cards })})`;
}

function readDomesticDom(config) {
  const text = node => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = text(document.body);
  const hostname = location.hostname;
  const sameSite = config.domains.some(d => hostname === d || hostname.endsWith('.' + d));
  const blocked = /验证码|安全验证|异常访问|访问受限|访问过于频繁|Access Denied|Robot Check/i.test(body) || /risk_handler|captcha|_____tmd_____/i.test(location.pathname);
  const loginPage = /login|passport|signin/i.test(location.hostname + location.pathname) || /登录后可|请先登录|扫码登录|登录后查看/.test(body);
  const records = [];
  const seen = new Set();
  if (sameSite && !blocked) for (const link of document.querySelectorAll(config.links)) {
    const url = link.href;
    if (!url || seen.has(url)) continue;
    const card = link.closest(config.cards) || link;
    const titleNode = card.querySelector('[class*="title"], [class*="Title"], .p-name, .name, [class*="name"]');
    const img = card.querySelector('img');
    const title = text(titleNode) || link.getAttribute('title') || img?.alt || text(link);
    if (!title) continue;
    const priceNode = card.querySelector('[class*="price"], [class*="Price"], .p-price');
    const priceText = text(priceNode) || null;
    seen.add(url);
    records.push({ title, url, price_text: priceText, image_url: img?.currentSrc || img?.getAttribute('data-src') || img?.src || null, shop: text(card.querySelector('[class*="shop"], [class*="Shop"]')) || null, location: text(card.querySelector('[class*="location"], [class*="procity"]')) || null });
  }
  return { status: blocked ? 'restricted' : records.length ? 'ok' : loginPage ? 'login_required' : !sameSite ? 'redirected' : 'empty_or_selector_changed', url: location.origin + location.pathname, title: document.title, records, total_text: text(document.querySelector('.search-total, .total, [class*="totalCount"]')) || null, next_available: Boolean(document.querySelector('a[rel="next"], a.next:not(.disabled), .page-next:not(.disabled)')) };
}

/** 有界查询覆盖报告。失败为增强信息，不应被上层当作阻止模型建议的业务条件。 */
export async function runDomesticSearch(page, { platform: id, keyword, city, pages, maxPages = 50, waitMs = 2500, signal, onProgress = () => {} } = {}) {
  const platform = DOMESTIC_PLATFORMS[id];
  if (!platform) throw new TypeError('不支持的国内来源');
  const requested = Math.min(pages == null ? pageNumber(maxPages) : pageNumber(pages), pageNumber(maxPages));
  const report = { platform: id, capability: platform.capability, status: 'empty_or_selector_changed', records: [], pages_requested: pages ?? null, safety_page_limit: requested, pages_completed: 0, pages: [], limitations: [], observed_at: new Date().toISOString(), complete: false, reported_total: null };
  const seen = new Set();
  let exhausted = false;
  for (let n = 1; n <= requested; n++) {
    if (signal?.aborted) { report.status = 'cancelled'; report.limitations.push('本次检索已取消'); break; }
    if (n > 1 && platform.pagination === 'first_page_only') { report.limitations.push('该Web入口尚未核实分页，仅访问首屏'); break; }
    const url = platform.searchUrl(keyword, city, n);
    try {
      await page.goto(url);
      if (page.wait) await page.wait(Math.min(10000, Math.max(0, Number(waitMs) || 0)) / 1000);
      const result = await page.evaluate(buildDomesticReadScript(id));
      const entry = { page: n, requested_url: url, observed_at: new Date().toISOString(), ...result };
      delete entry.records;
      report.pages.push(entry);
      report.status = result.status;
      report.reported_total = result.total_text ?? report.reported_total;
      if (result.status !== 'ok') { report.limitations.push(result.status); break; }
      report.pages_completed++;
      const previousCount = report.records.length;
      for (const raw of result.records || []) {
        const record = platform.normalize(raw, { keyword, city, page: n, scrapedAt: entry.observed_at });
        if (record && !seen.has(record.product_url)) { seen.add(record.product_url); report.records.push(record); }
      }
      onProgress({ ...report, records: undefined });
      if (platform.pagination === 'first_page_only') { report.limitations.push('仅已加载首屏，尚未核实滚动/分页覆盖，不声明查询全量'); break; }
      if (n > 1 && report.records.length === previousCount) { report.limitations.push('分页返回重复条目，已停止且不声明全量'); break; }
      if (result.next_available === false) { exhausted = true; break; }
    } catch (error) {
      report.status = 'failed';
      report.pages.push({ page: n, requested_url: url, status: 'failed', error_code: error.code || 'PAGE_READ_FAILED' });
      report.limitations.push('页面读取失败');
      break;
    }
  }
  if (platform.capability === 'homepage_probe_only') report.limitations.push('仅官网可达性/商品链接探测，未接通关键词检索');
  if (!exhausted && report.pages_completed === requested && platform.pagination !== 'first_page_only') report.limitations.push('达到本次页数上限，仍可能存在后续页');
  report.complete = exhausted && platform.capability === 'dom_search';
  report.coverage = report.complete ? 'accessible_page_chain_exhausted' : 'partial_or_unavailable';
  return report;
}
