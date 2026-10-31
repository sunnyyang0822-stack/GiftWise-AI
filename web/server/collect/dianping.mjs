/** Reuse installed OpenCLI's Dianping parsers, extending page coverage/images/packages. */
import { importOpencli } from './domestic-browser.mjs';

const SHOP_URL = /^https:\/\/www\.dianping\.com\/shop\/[A-Za-z0-9_-]+(?:[/?#]|$)/;
export function dianpingFailure(snapshot = {}) {
  const text = String(snapshot.text ?? snapshot.sample ?? '');
  const url = String(snapshot.url ?? '');
  if (/verify|captcha|verify\.meituan|验证中心/.test(url) || /验证码|访问验证|安全验证|异常访问|操作频繁/.test(text)) return 'ACCESS_RESTRICTED';
  if (/account\.dianping\.com|login/.test(url) || /登录后.{0,12}(查看|继续|访问)|请先登录|扫码登录|短信登录/.test(text)) return 'AUTH_REQUIRED';
  if (/没有找到|暂无结果|暂无商户|未找到相关/.test(text)) return 'EMPTY';
  return 'PAGE_UNRECOGNIZED';
}
export function normalizeDianping(row, { keyword, city, scrapedAt = new Date().toISOString(), detail = false } = {}) {
  if (!row?.name || !SHOP_URL.test(row.url ?? '')) return null;
  const priceText = typeof row.price_text === 'string' ? row.price_text.trim() : '';
  const match = priceText.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)|(?:人均|均价)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/);
  const amount = match?.[1] ?? match?.[2] ?? null;
  return {
    record_kind: 'experience', external_id: row.shop_id ?? new URL(row.url).pathname.split('/').pop(),
    title: row.name.trim(), name: row.name.trim(), variant: row.package_name ?? '', quantity: 1,
    price_text: priceText || null, price_amount: amount, currency: amount == null ? null : 'CNY',
    price_unit: row.price_unit ?? (/人均|均价/.test(priceText) ? '元/人（人均参考）' : null),
    price_conditions: amount == null ? [] : ['商户展示参考价；未核实所选项目/套餐和人数'],
    seller: row.name.trim(), product_url: row.url, source_url: row.url,
    image_url: /^https:\/\//.test(row.image_url ?? '') ? row.image_url : null,
    city: city ?? row.city ?? null, address: row.address || row.district || null,
    packages: Array.isArray(row.packages) ? row.packages : [],
    source_site: 'dianping.com', capability: 'dianping search/shop + read-only DOM pagination',
    page_kind: detail ? 'detail' : 'search', observed_at: scrapedAt, scraped_at: scrapedAt,
    price_observed_at: amount == null ? null : scrapedAt,
    raw_excerpt: { kind: 'experience', price_unit: row.price_unit ?? null, city: city ?? null,
      address: row.address || row.district || null, packages: row.packages ?? [], page_kind: detail ? 'detail' : 'search',
      price_text: priceText || null, rating: row.rating ?? row.starClass ?? null, source_url: row.url },
    query_params: { keyword, city: city ?? null },
  };
}

function extraSearchFields() {
  const cards = Array.from(document.querySelectorAll('#shop-all-list li'));
  const rows = cards.map(el => {
    const a = el.querySelector('.tit a[href*="/shop/"], a[data-shopid], a[href*="/shop/"]');
    const url = a?.href || '';
    const image = el.querySelector('.pic img, img');
    const imageSrc = image?.getAttribute('data-src') || image?.getAttribute('data-lazyload') || image?.getAttribute('src');
    return { url: url.replace(/^http:/, 'https:'), image_url: imageSrc ? new URL(imageSrc, location.href).href.replace(/^http:/, 'https:') : null,
      price_text: el.querySelector('.mean-price')?.textContent?.trim() || null,
      price_unit: /人均|均价/.test(el.querySelector('.mean-price')?.textContent || '') ? '元/人（人均参考）' : null,
      address: el.querySelector('.addr')?.textContent?.trim() || null };
  });
  const next = Array.from(document.querySelectorAll('.page a, .pageLink a, a.next')).find(a => /下一页|下页|next/i.test(a.textContent || a.className));
  const totalText = document.querySelector('.shop-wrap .search-info, .shop-count, .search-result-count')?.textContent?.trim() || null;
  return { rows, next_url: next?.href || null, total_text: totalText, url: location.href,
    text: rows.length ? '' : (document.body?.innerText || '').slice(0, 800) };
}
function extraShopFields() {
  const main = document.querySelector('.shop-head, #basic-info, .shop-info');
  const image = document.querySelector('.shop-photo img, .shop-photos img, .photos img, .shop-head img');
  const imageSrc = image?.getAttribute('data-src') || image?.getAttribute('src');
  const packages = Array.from(document.querySelectorAll('.tuan-list li, .group-list li, .deal-list li')).map(el => {
    const a = el.querySelector('a[href]');
    return { name: el.querySelector('.title, h3, h4')?.textContent?.trim() || a?.textContent?.trim() || null,
      price_text: el.querySelector('.price, .price-current')?.textContent?.trim() || null,
      unit_text: el.querySelector('.unit, .desc')?.textContent?.trim() || null, url: a?.href || null };
  }).filter(p => p.name);
  return { image_url: imageSrc ? new URL(imageSrc, location.href).href.replace(/^http:/, 'https:') : null,
    price_text: main?.querySelector('.avg-price, .mean-price, #avgPriceTitle')?.textContent?.trim() || null,
    packages, url: location.href, text: main ? '' : (document.body?.innerText || '').slice(0, 800) };
}
export async function searchDianping(page, { keyword, city = null, packageRoot, maxPages = 50, signal, onProgress = () => {} } = {}) {
  const [{ extractSearchRows }, { extractShopFields }, { resolveCityIdAsync }] = await Promise.all([
    importOpencli(packageRoot, 'clis/dianping/search.js'), importOpencli(packageRoot, 'clis/dianping/shop.js'),
    importOpencli(packageRoot, 'clis/dianping/cityResolver.js'),
  ]);
  const coverage = { source: 'dianping', keyword, city, pages_completed: 0, detail_pages_completed: 0,
    observed_count: 0, reported_total: null, complete: false, status: 'pending', limitations: [] };
  const records = new Map();
  const seen = new Set();
  try {
    const cityId = await resolveCityIdAsync(page, city);
    if (city == null) coverage.limitations.push('未指定城市；仅观察来源当前展示地区，建议未受阻断');
    let url = `https://www.dianping.com/search/keyword/${cityId ?? 0}/0_${encodeURIComponent(keyword)}`;
    while (url && coverage.pages_completed < maxPages) {
      if (signal?.aborted) throw new Error('RETRIEVAL_CANCELLED');
      if (seen.has(url)) { coverage.limitations.push('来源分页循环，已停止'); break; }
      seen.add(url);
      await page.goto(url); await page.wait(2);
      const raw = await page.evaluate(`(${extractSearchRows.toString()})()`);
      const extra = await page.evaluate(`(${extraSearchFields.toString()})()`);
      if (!raw?.ok) { coverage.status = dianpingFailure(extra); coverage.limitations.push(coverage.status); break; }
      coverage.pages_completed++;
      coverage.reported_total = extra.total_text;
      for (const row of raw.rows ?? []) {
        const supplemental = extra.rows?.find(r => r.url === row.url) ?? {};
        const normalized = normalizeDianping({ ...row, ...supplemental }, { keyword, city });
        if (normalized) records.set(normalized.product_url, normalized);
      }
      coverage.observed_count = records.size;
      onProgress({ ...coverage });
      const next = extra.next_url;
      if (!next) { coverage.complete = true; coverage.status = records.size ? 'ok' : 'EMPTY'; break; }
      const parsed = new URL(next);
      if (parsed.hostname !== 'www.dianping.com' || !parsed.pathname.startsWith(`/search/keyword/${cityId ?? 0}/`)) {
        coverage.limitations.push('下一页不属于当前来源/查询路径，未跟随'); break;
      }
      url = parsed.href;
    }
    if (!coverage.complete && coverage.pages_completed >= maxPages) coverage.limitations.push(`达到本次安全页数上限 ${maxPages}，未声明全量`);
    for (const [url, record] of records) {
      if (signal?.aborted) throw new Error('RETRIEVAL_CANCELLED');
      try {
        await page.goto(url); await page.wait(2);
        const raw = await page.evaluate(`(${extractShopFields.toString()})()`);
        const extra = await page.evaluate(`(${extraShopFields.toString()})()`);
        if (!raw?.ok || !SHOP_URL.test(extra.url)) { coverage.limitations.push(`详情未取得：${dianpingFailure(extra)}`); continue; }
        const normalized = normalizeDianping({ ...raw, ...extra, shop_id: record.external_id,
          price_text: extra.price_text || (raw.priceRaw ? `人均${raw.priceRaw}` : null),
          image_url: extra.image_url || record.image_url }, { keyword, city, detail: true });
        if (normalized) records.set(url, normalized);
        coverage.detail_pages_completed++;
      } catch (error) { coverage.limitations.push(`详情读取失败：${error.code ?? error.message}`); }
    }
  } catch (error) { coverage.status = signal?.aborted ? 'cancelled' : (error.code ?? error.message); coverage.limitations.push(coverage.status); }
  coverage.status = coverage.status === 'pending' ? (records.size ? 'partial' : 'unavailable') : coverage.status;
  coverage.observed_count = records.size;
  if (coverage.detail_pages_completed < records.size) coverage.limitations.push('部分记录只有搜索页观察，不冒充已核实套餐详情');
  return { records: [...records.values()], coverage, status: coverage.status };
}
