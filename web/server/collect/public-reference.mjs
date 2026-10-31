/** 公开资料降级通路。只读公开搜索结果，不调用电商API、不读取认证、不创建浏览器。 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const DOMESTIC_DOMAINS = ['mi.com', 'huawei.com', 'honor.com', 'midea.com', 'haier.com', 'smzdm.com', 'zdmimg.com', 'sspai.com', 'ithome.com', 'zhihu.com', 'bilibili.com', 'douban.com', 'weibo.com', 'xiaohongshu.com', 'douyin.com', '163.com', 'sohu.com', 'qq.com', 'people.com.cn', 'xinhuanet.com', 'sina.com.cn', 'zol.com.cn', 'pconline.com.cn', 'dianping.com'];
const COMMERCE_DOMAINS = ['jd.com', 'jd.hk', 'taobao.com', 'tmall.com', '1688.com', 'pinduoduo.com', 'yangkeduo.com', 'jinritemai.com', 'kwaixiaodian.com', 'vip.com', 'suning.com', 'suning.cn', 'xiaomiyoupin.com', 'dewu.com', 'poizon.com', 'dangdang.com', 'amazon.cn', 'gome.com.cn', 'kaola.com', 'you.163.com'];
const clean = (value, max = 300) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
export const PUBLIC_REFERENCE_SOURCES = Object.freeze({
  bing: Object.freeze({ id: 'bing', purpose: 'reference', source_site: 'bing.com', opencli: null, implementation: 'public_image_search_dom', native_adapter_status: 'not_installed_in_opencli_1.8.8', verification_status: 'not_live_verified', searchUrl: (keyword, page = 1) => searchUrl('bing', keyword, page) }),
  duckduckgo: Object.freeze({ id: 'duckduckgo', purpose: 'reference', source_site: 'duckduckgo.com', opencli: { command: 'duckduckgo search', access: 'read', inspected_version: '1.8.8', adapter_file: 'clis/duckduckgo/search.js', arguments: ['keyword', '--limit', '--offset', '--region', '--time'], native_executed: false }, implementation: 'public_dom', verification_status: 'not_live_verified', searchUrl: (keyword, page = 1) => searchUrl('duckduckgo', keyword, page) }),
});

function searchUrl(source, keyword, page) {
  const query = clean(keyword, 500);
  if (!query) throw new TypeError('公开资料检索关键词不能为空');
  const n = Math.max(1, Math.floor(Number(page) || 1));
  const url = new URL(source === 'bing' ? 'https://cn.bing.com/images/search' : 'https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  if (source === 'bing') { url.searchParams.set('mkt', 'zh-CN'); url.searchParams.set('setlang', 'zh-hans'); url.searchParams.set('first', String(1 + (n - 1) * 10)); }
  else { url.searchParams.set('kl', 'cn-zh'); if (n > 1) url.searchParams.set('s', String((n - 1) * 10)); }
  return url.href;
}

/** 解开搜索引擎公开跳转目标后再做国内来源检查，跳转链接本身不作为证据。 */
export function publicReferenceUrl(value, source) {
  try {
    let url = new URL(value, source === 'bing' ? 'https://cn.bing.com' : 'https://html.duckduckgo.com');
    if (source === 'bing' && (url.hostname === 'bing.com' || url.hostname.endsWith('.bing.com')) && url.pathname === '/ck/a') {
      const target = url.searchParams.get('u');
      if (!target || target.length > 12000) return null;
      url = new URL(target.startsWith('a1') ? Buffer.from(target.slice(2), 'base64url').toString('utf8') : target);
    }
    if (source === 'duckduckgo' && (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com'))) {
      const target = url.searchParams.get('uddg');
      if (!target) return null;
      url = new URL(target);
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (COMMERCE_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d))) return null;
    if (/^(?:shop|store|mall|buy|item|detail)\./i.test(url.hostname)) return null;
    if (/\/(?:goods-detail|goods|shop|mall|cart|checkout|buy)(?:\/|$)/i.test(url.pathname)) return null;
    // .cn及已盘点国内公开信息站；海外来源不能因中文标题变成国内参考来源。
    if (!(url.hostname.endsWith('.cn') || DOMESTIC_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d)))) return null;
    if (/login|passport|signin|oauth|authorize/i.test(url.hostname + url.pathname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|spm|scm|fbclid|msclkid|access_token|token|session|cookie|authorization)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

export function extractReferencePrices(text) {
  const input = clean(text, 1000), prices = [], seen = new Set();
  const number = String.raw`\d[\d,]*(?:\.\d+)?`;
  const pattern = new RegExp(`(?:[¥￥]|人民币|CNY)\\s*(${number})(?:\\s*[-~～至]\\s*(${number}))?\\s*(?:元)?|(${number})(?:\\s*[-~～至]\\s*(${number}))?\\s*元(?:\\s*[/／]\\s*([^\\s，。；,;]+))?`, 'g');
  for (const match of input.matchAll(pattern)) {
    if (prices.length >= 3) break;
    const low = (match[1] || match[3]).replace(/,/g, ''), high = (match[2] || match[4])?.replace(/,/g, '') || null;
    const unit = match[5] || null, key = `${low}|${high}|${unit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nearby = input.slice(Math.max(0, match.index - 18), match.index + match[0].length + 18);
    prices.push({ text: match[0].trim(), amount: high ? null : low, min: high ? low : null, max: high, currency: 'CNY', unit, conditions: [...new Set(nearby.match(/券后|会员价|起|定金|预售|历史低价|建议零售价/g) || [])], price_kind: 'reference_price', is_live_quote: false, source_time: null });
  }
  return prices;
}

export function normalizePublicReference(raw, { source = 'duckduckgo', keyword, observedAt } = {}) {
  if (!PUBLIC_REFERENCE_SOURCES[source]) throw new TypeError('不支持的公开资料来源');
  const source_url = publicReferenceUrl(raw.source_url || raw.url, source), title = clean(raw.title, 150);
  if (!source_url || !title) return null;
  const summary = clean(raw.summary || raw.snippet, 300) || null;
  const prices = extractReferencePrices(`${title} ${summary || ''}`);
  let image_url = null;
  if (['search_thumbnail', 'search_image', 'public_page_image'].includes(raw.image_provenance)) {
    try { const image = new URL(raw.image_url, source_url); if (raw.image_url && image.protocol === 'https:' && !image.username && !image.password && !image.port && !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(image.hostname)) image_url = image.href; } catch { /* 图片缺失不阻断参考资料 */ }
  }
  return {
    record_kind: 'reference', purpose: 'reference', reference_kind: 'public_reference',
    title, product_name: clean(raw.product_name, 150) || null, summary,
    source_url, source_site: new URL(source_url).hostname, source_platform: source, source_scope: 'domestic_public_information',
    product_url: null, sku_id: null, is_live_quote: false,
    price_kind: 'reference_price', price_text: prices.length === 1 ? prices[0].text : null,
    price_amount: prices.length === 1 ? prices[0].amount : null, currency: prices.length ? 'CNY' : null,
    price_conditions: prices.length === 1 ? prices[0].conditions : [], reference_prices: prices,
    image_kind: 'reference_image', image_url, image_role: image_url ? 'reference_illustration' : null, image_validation: null,
    image_provenance: image_url ? { kind: raw.image_provenance, source_url, validation_status: 'not_fetched', same_sku_verified: false } : null,
    observed_at: observedAt && Number.isFinite(Date.parse(observedAt)) ? observedAt : null,
    reference_price_time: null, query_params: { keyword: keyword ?? null },
    limitations: ['公开资料及参考价，非实时电商SKU报价', ...(image_url ? [raw.image_provenance === 'public_page_image' ? '图片来自公开资料页，未核验同一SKU或实物' : '图片来自公开图片搜索，未核验同一SKU或实物'] : [])],
  };
}

export function buildPublicReferenceReadScript(source = 'duckduckgo') {
  if (!PUBLIC_REFERENCE_SOURCES[source]) throw new TypeError('不支持的公开资料来源');
  return `(${readPublicResults.toString()})(${JSON.stringify(source)})`;
}

function readPublicResults(source) {
  const text = (node, max = 300) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const body = text(document.body, 20000);
  if (/验证码|安全验证|访问受限|异常访问|unusual traffic|verify you are human|challenge-form/i.test(body) || /captcha|challenge/i.test(location.pathname)) return { status: 'restricted', records: [] };
  if (/login|passport|signin/i.test(location.hostname + location.pathname)) return { status: 'login_required', records: [] };
  const sameEngine = source === 'bing' ? /^(?:[a-z0-9-]+\.)?bing\.com$/.test(location.hostname) : /^(?:html\.)?duckduckgo\.com$/.test(location.hostname);
  if (!sameEngine) return { status: 'redirected', records: [] };
  const records = [];
  if (source === 'bing' && location.pathname.startsWith('/images')) {
    for (const card of document.querySelectorAll('a.iusc[m]')) {
      let metadata;
      try { metadata = JSON.parse(card.getAttribute('m') || ''); } catch { continue; }
      const image = card.querySelector('img.mimg, img');
      const visible = image?.currentSrc || image?.getAttribute('data-src') || image?.src;
      const thumbnail = [visible, metadata.turl].find(value => typeof value === 'string' && value.startsWith('https://'));
      const asset = thumbnail || metadata.murl;
      const title = text(card.querySelector('.img_info, .infopt'), 150) || metadata.t || image?.alt || card.getAttribute('aria-label');
      if (!title || !metadata.purl || !asset) continue;
      records.push({ title: String(title).slice(0, 150), source_url: metadata.purl, snippet: typeof metadata.desc === 'string' ? metadata.desc.slice(0, 300) : null, image_url: asset, image_provenance: thumbnail ? 'search_thumbnail' : 'search_image' });
    }
    return { status: records.length ? 'ok' : 'empty_or_selector_changed', records, next_available: false };
  }
  for (const card of document.querySelectorAll(source === 'bing' ? '#b_results > li.b_algo' : '.result')) {
    if (card.matches?.('.result--ad, .result--ads, .b_ad')) continue;
    const link = card.querySelector(source === 'bing' ? 'h2 a[href]' : '.result__a');
    const title = text(link, 150);
    if (!link || !title) continue;
    const snippet = card.querySelector(source === 'bing' ? '.b_caption p, .b_snippet' : '.result__snippet');
    let image = card.querySelector(source === 'bing' ? '.cico img, .b_thumb img, .thumb img, img.mimg' : '.result__image img, .result__body img.result__image');
    if (image?.closest?.('.b_favicon, .favicon, .result__icon, [class*="avatar"]')) image = null;
    records.push({ title, source_url: link.href || link.getAttribute('href'), snippet: text(snippet), product_name: text(card.querySelector('[itemprop="name"]'), 150) || null, image_url: image?.currentSrc || image?.getAttribute('data-src') || image?.src || null, image_provenance: 'search_thumbnail' });
  }
  const next = document.querySelector(source === 'bing' ? 'a.sb_pagN:not([aria-disabled="true"])' : '.nav-link input[value="Next"], .result--more__btn');
  return { status: records.length ? 'ok' : 'empty_or_selector_changed', records, next_available: Boolean(next) };
}

export function buildPublicReferencePageImageScript() { return `(${readPageImage.toString()})()`; }

function readPageImage() {
  const text = (node, max = 300) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const body = text(document.body, 20000);
  const base = { source_url: location.href, image_url: null };
  if (/验证码|安全验证|访问受限|异常访问/.test(body) || /captcha|challenge/i.test(location.pathname)) return { ...base, status: 'restricted' };
  if (/扫码登录|请先登录|登录后查看/.test(body) || /login|passport|signin/i.test(location.hostname + location.pathname)) return { ...base, status: 'login_required' };
  const usable = value => {
    if (!value || /favicon|(?:^|[\/_-])logo(?:[\/_.-]|$)|avatar|headimg|headpic/i.test(value)) return null;
    try { const url = new URL(value, location.href); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : null; } catch { return null; }
  };
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const image_url = usable(document.querySelector(selector)?.getAttribute('content'));
    if (image_url) return { ...base, status: 'ok', image_url, image_provenance: 'public_page_image' };
  }
  for (const image of document.querySelectorAll('article img, main .article-content img, .post-content img, .RichText img')) {
    if (image.closest?.('[class*="avatar"], [class*="logo"], .author, .recommend, .related')) continue;
    if ((image.naturalWidth && image.naturalWidth < 100) || (image.naturalHeight && image.naturalHeight < 100)) continue;
    const image_url = usable(image.currentSrc || image.getAttribute('data-src') || image.src);
    if (image_url) return { ...base, status: 'ok', image_url, image_provenance: 'public_page_image' };
  }
  return { ...base, status: 'no_content_image' };
}

export async function readPublicReferencePageImage(page, { sourceUrl, source = 'duckduckgo', signal } = {}) {
  const expected = publicReferenceUrl(sourceUrl, source);
  if (!expected) return { status: 'source_not_allowed', source_url: null, image_url: null };
  if (signal?.aborted) return { status: 'aborted', source_url: expected, image_url: null };
  try {
    await page.goto(expected);
    if (page.wait) await page.wait(1);
    if (signal?.aborted) return { status: 'aborted', source_url: expected, image_url: null };
    const result = await page.evaluate(buildPublicReferencePageImageScript());
    if (publicReferenceUrl(result.source_url, source) !== expected) return { status: 'source_redirected', source_url: expected, image_url: null };
    return result;
  } catch { return { status: signal?.aborted ? 'aborted' : 'image_page_failed', source_url: expected, image_url: null }; }
}

/** 调用方统一提供专用page；不自动切电商、不轮询登录/风控、不调用模型。 */
export async function runPublicReferenceSearch(page, { source = 'duckduckgo', keyword, maxPages = 1, signal, packageRoot } = {}) {
  const registry = PUBLIC_REFERENCE_SOURCES[source];
  if (!registry) throw new TypeError('不支持的公开资料来源');
  const count = Math.min(3, Math.max(1, Math.floor(Number(maxPages) || 1)));
  const coverage = { source, keyword, purpose: 'reference', pages_requested: count, pages_completed: 0, complete: false, status: 'not_observed', scope: 'requested_search_pages_only', execution_mode: source === 'duckduckgo' && packageRoot ? 'native_opencli' : 'public_dom', native_executed: false, limitations: ['公开检索实现尚未真实验证', '搜索服务是发现入口，仅保留国内非电商公开信息网站'], pages: [] };
  const records = [], seen = new Set();
  let native;
  if (source === 'duckduckgo' && packageRoot) {
    try {
      const root = resolve(packageRoot);
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (manifest.name !== '@jackwener/opencli' || manifest.version !== '1.8.8') throw new Error('Uninspected adapter package');
      native = (await import(pathToFileURL(join(root, 'clis/duckduckgo/search.js')).href)).__test__?.command;
      if (!native || native.access !== 'read' || typeof native.func !== 'function') throw new Error('Read-only adapter unavailable');
    } catch { coverage.status = 'native_adapter_unavailable'; return { records, coverage }; }
  }
  for (let n = 1; n <= count; n++) {
    if (signal?.aborted) { coverage.status = 'aborted'; break; }
    // 已装DDG适配器分页走XHR POST；此实现只读DOM，不伪称URL offset等价分页。
    if (source === 'duckduckgo' && !native && n > 1) { coverage.limitations.push('只读DOM通路未启用DDG的POST分页，仅首屏'); break; }
    try {
      let result;
      if (native) {
        const guarded = {
          goto: async value => { if (signal?.aborted) throw new Error('Aborted'); const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== 'html.duckduckgo.com' || url.pathname !== '/html/') throw new Error('Unexpected native navigation'); return page.goto(url.href); },
          wait: async value => { if (signal?.aborted) throw new Error('Aborted'); return page.wait ? page.wait(value) : undefined; },
          evaluate: async script => { if (signal?.aborted) throw new Error('Aborted'); if (typeof script !== 'string' || /document\s*\.\s*cookie|localStorage|sessionStorage|getCookies/.test(script)) throw new Error('Authentication access denied'); return page.evaluate(script); },
        };
        coverage.native_executed = true;
        const rows = await native.func(guarded, { keyword, limit: 10, offset: (n - 1) * 10, region: 'cn-zh' });
        let supplement = { records: [] };
        if (n === 1 && !signal?.aborted) supplement = await page.evaluate(buildPublicReferenceReadScript(source));
        const byUrl = new Map((supplement.records || []).map(raw => [publicReferenceUrl(raw.source_url || raw.url, source), raw]));
        result = { status: ['restricted', 'login_required'].includes(supplement.status) ? supplement.status : rows.length ? 'ok' : 'empty_or_selector_changed', records: rows.map(row => ({ ...row, ...byUrl.get(publicReferenceUrl(row.url, source)) })), next_available: native && n < count ? true : supplement.next_available };
      } else {
        await page.goto(registry.searchUrl(keyword, n));
        if (signal?.aborted) { coverage.status = 'aborted'; break; }
        if (page.wait) await page.wait(2);
        if (signal?.aborted) { coverage.status = 'aborted'; break; }
        result = await page.evaluate(buildPublicReferenceReadScript(source));
      }
      if (signal?.aborted) { coverage.status = 'aborted'; break; }
      const observedAt = new Date().toISOString();
      const normalized = result.status === 'ok' ? (result.records || []).map(raw => normalizePublicReference(raw, { source, keyword, observedAt })).filter(Boolean) : [];
      coverage.status = result.status === 'ok' && !normalized.length ? 'no_domestic_reference_results' : result.status;
      coverage.pages.push({ page: n, status: coverage.status, count: normalized.length, observed_at: observedAt });
      if (coverage.status !== 'ok') break;
      coverage.pages_completed++;
      for (const record of normalized) if (!seen.has(record.source_url)) { seen.add(record.source_url); records.push(record); }
      if (n < count && !result.next_available) { coverage.limitations.push('未见下一页，不宣称全量'); break; }
    } catch { coverage.status = signal?.aborted ? 'aborted' : 'failed'; coverage.pages.push({ page: n, status: coverage.status }); break; }
  }
  coverage.complete = coverage.pages_completed === count;
  if (!coverage.complete) coverage.scope = 'partial_or_unavailable';
  coverage.image_pages = [];
  if (source === 'duckduckgo' && !signal?.aborted) {
    for (const record of records.filter(r => !r.image_url).slice(0, 3)) {
      const image = await readPublicReferencePageImage(page, { sourceUrl: record.source_url, source, signal });
      coverage.image_pages.push({ source_url: record.source_url, status: image.status });
      if (image.status === 'ok') {
        const enriched = normalizePublicReference({ ...record, image_url: image.image_url, image_provenance: 'public_page_image' }, { source, keyword, observedAt: record.observed_at });
        if (enriched) Object.assign(record, enriched);
      }
      if (signal?.aborted) break;
    }
  }
  return { records, coverage };
}
