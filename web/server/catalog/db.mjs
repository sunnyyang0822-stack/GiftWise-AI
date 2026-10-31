/**
 * 本地真实商品库的**只读**访问层（阶段二）。
 *
 * 库路径由当前项目配置注入。
 * 表：`collection_runs` / `products` / `product_images` / `price_observations` / `products_fts`
 *
 * ⛔ 本模块**不联网**、不写库、不建表、不改 schema：只读查询。
 * 用 Node v24 内置的 `node:sqlite`（`DatabaseSync`，只读打开），不装任何依赖。
 *
 * 口径（与设计说明 `接上真实数据线-设计说明-2026-10-31.md` 一致）：
 *   - 价格是**页面观察价**（`price_kind='page_observed'`），不是结算价，不保证库存与送达；
 *   - `product_url` / `image_url` 是**来源站原始链接**，必须原样返回，不改写成代理路径；
 *   - 没有匹配就是没有匹配，绝不用假商品或占位图顶（原因码见 match.mjs）。
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** 来源与原始页面域名都必须属于国内白名单；聚合结果不冒充直连平台。 */
export const DOMESTIC_SOURCE_HOSTS = Object.freeze({
  taobao: ['taobao.com'], tmall: ['tmall.com'], jd: ['jd.com'],
  pdd: ['pinduoduo.com', 'yangkeduo.com'], pinduoduo: ['pinduoduo.com', 'yangkeduo.com'],
  douyin: ['douyin.com', 'jinritemai.com'], kuaishou: ['kuaishou.com', 'kwaixiaodian.com'],
  '1688': ['1688.com'], vip: ['vip.com'], suning: ['suning.com'],
  xiaomiyoupin: ['xiaomiyoupin.com', 'youpin.mi.com'], youpin: ['xiaomiyoupin.com', 'youpin.mi.com'],
  dewu: ['dewu.com'], dianping: ['dianping.com'], smzdm: ['smzdm.com'],
  xianyu: ['goofish.com', '2.taobao.com'], goofish: ['goofish.com', '2.taobao.com'], dangdang: ['dangdang.com'],
  damai: ['damai.cn'], maoyan: ['maoyan.com'], bilibili: ['bilibili.com'],
});
export function isDomesticProduct(product) {
  const source = String(product?.source_site ?? '').toLowerCase();
  const hosts = DOMESTIC_SOURCE_HOSTS[source] ?? Object.values(DOMESTIC_SOURCE_HOSTS).find(domains => domains.includes(source));
  if (!hosts) return false;
  try {
    const url = new URL(product.page_url ?? product.product_url);
    return url.protocol === 'https:' && hosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
  } catch { return false; }
}

/** 稳定的图片标识：由「来源 + 商品 + 图片原文 URL」推出，可用它反查真实 URL。 */
export function imageIdOf(productId, url) {
  return createHash('sha256').update(`localdb|${productId}|${url}`, 'utf8').digest('hex').slice(0, 32);
}

/**
 * 只读打开本地库。
 * @throws {{code: 'CATALOG_DB_MISSING'|'CATALOG_DB_UNREADABLE', message: string}}
 */
export function openCatalogDb(dbPath) {
  if (!dbPath || !existsSync(dbPath)) {
    throw Object.assign(new Error(`本地商品库不存在：${dbPath ?? '(未配置)'}`), { code: 'CATALOG_DB_MISSING' });
  }
  try {
    return new DatabaseSync(dbPath, { readOnly: true, timeout: 2000 });
  } catch (error) {
    throw Object.assign(new Error(`本地商品库无法打开：${error.message}`), { code: 'CATALOG_DB_UNREADABLE' });
  }
}

export function getStats(db) {
  const total = db.prepare('select count(*) as c from products').get()?.c ?? 0;
  const priced = db.prepare("select count(*) as c from products where price_status = 'parsed' and price_amount is not null").get()?.c ?? 0;
  const withImage = db.prepare('select count(distinct product_id) as c from product_images').get()?.c ?? 0;
  const lastRun = db.prepare('select run_id, started_at, finished_at, source_site, capability, status, item_count from collection_runs order by started_at desc limit 1').get() ?? null;
  return { total, priced, with_image: withImage, last_run: lastRun ?? null };
}

function imagesOf(db, productId) {
  return db
    .prepare('select url, kind, position, alt from product_images where product_id = ? order by position asc, id asc')
    .all(productId)
    .filter((row) => typeof row.url === 'string' && row.url.startsWith('https://'))
    .map((row) => ({ ...row, image_id: imageIdOf(productId, row.url) }));
}

const OBSERVED_COLUMNS = ['raw_excerpt', 'price_unit', 'city', 'address', 'location', 'observed_at'];
function observedColumns(db) {
  const names = db.prepare('PRAGMA table_info(products)').all().map(row => row.name);
  return OBSERVED_COLUMNS.filter(c => names.includes(c)).map(c => ', ' + c).join('');
}
const SELECT_COLUMNS = `product_id, external_id, source_site, capability, scraped_at, record_kind, title,
  price_text, price_amount, currency, price_status, price_kind, price_observed_at, price_conditions,
  seller, product_url, image_url, same_product_key, query_params`;

/**
 * 运输/预售字段是**采集侧**（另一个 agent）在补的字段，本读取层对此**前向兼容**：
 * 表里已经有的列就原样带出，没有的列一律给 `null`，绝不编造发货地或时效。
 *
 * 目标字段（设计说明与产品负责人 2026-10-31 更正常见口径）：
 *   shipping_origin / seller_location_text（发货地）、shipping_time_text（配送时效原文）、
 *   ships_within_text（发货时效原文）、is_preorder（是否预售，boolean 或 null）。
 */
export const SHIPPING_COLUMNS = Object.freeze([
  'shipping_origin',
  'seller_location_text',
  'shipping_time_text',
  'ships_within_text',
  'presale_text',
  'is_preorder',
  'shipping_days',
  'ships_within_days',
  'presale_days',
]);

/** 这些运输字段是数值型（天数），其余按字符串原样带出。 */
const NUMERIC_SHIPPING_COLUMNS = Object.freeze(['shipping_days', 'ships_within_days', 'presale_days']);

/** 探测 products / price_observations 里实际存在哪些运输字段。 */
export function detectShippingColumns(db) {
  const present = {};
  for (const [table, columns] of [['products', SHIPPING_COLUMNS], ['price_observations', SHIPPING_COLUMNS]]) {
    let names = [];
    try {
      names = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    } catch {
      names = [];
    }
    present[table] = columns.filter((column) => names.includes(column));
  }
  return present;
}

function shippingOf(row, optional) {
  const out = {
    shipping_origin: null,
    seller_location_text: null,
    shipping_time_text: null,
    ships_within_text: null,
    presale_text: null,
    is_preorder: null,
    shipping_days: null,
    ships_within_days: null,
    presale_days: null,
  };
  for (const column of optional) {
    const value = row[column];
    if (value === undefined || value === null) continue;
    if (column === 'is_preorder') {
      out[column] = value === 1 || value === true || value === '1' || value === 'true';
    } else if (NUMERIC_SHIPPING_COLUMNS.includes(column)) {
      const num = Number(value);
      out[column] = Number.isFinite(num) && num >= 0 ? num : null;
    } else {
      out[column] = String(value);
    }
  }
  // 是否**声明过**运输信息：只要有一个文本字段非空就算有来源依据（否则按未知处理）。
  out.declared = ['shipping_origin', 'seller_location_text', 'shipping_time_text', 'ships_within_text', 'presale_text'].some(
    (key) => typeof out[key] === 'string' && out[key].trim() !== '',
  ) || NUMERIC_SHIPPING_COLUMNS.some((key) => typeof out[key] === 'number');
  return out;
}

/** 全部「可购买条目」（排除无价格的资讯帖）。 */
export function listProducts(db, { limit = 200 } = {}) {
  const rows = db
    .prepare(`select ${SELECT_COLUMNS}${observedColumns(db)} from products where record_kind in ('product', 'experience', 'ticket') order by price_observed_at desc limit ?`)
    .all(limit === null ? -1 : Math.max(1, Number(limit) || 200));
  const optional = detectShippingColumns(db).products;
  return rows.map((row) => hydrate(db, row, optional)).filter(isDomesticProduct);
}

function hydrate(db, row, optional = []) {
  const images = imagesOf(db, row.product_id);
  const rawImageUrl = typeof row.image_url === 'string' && row.image_url.startsWith('https://') ? row.image_url : null;
  const imageUrls = [...new Set([...(rawImageUrl ? [rawImageUrl] : []), ...images.map((item) => item.url)])];
  const primary = images.find((item) => item.kind === 'main') ?? images[0] ?? (rawImageUrl ? { url: rawImageUrl, kind: 'main', alt: null, image_id: imageIdOf(row.product_id, rawImageUrl) } : null);
  let priceConditions = [];
  try {
    const parsed = JSON.parse(row.price_conditions ?? '[]');
    if (Array.isArray(parsed)) priceConditions = parsed.filter((item) => typeof item === 'string');
  } catch {
    priceConditions = [];
  }
  let metadata = {};
  try { const raw = JSON.parse(row.raw_excerpt ?? '{}'); if (raw && typeof raw === 'object' && !Array.isArray(raw)) metadata = raw; } catch {}
  return {
    record_kind: row.record_kind,
    specifications:metadata.specifications??metadata.detail_specifications??null,
    image_validation:metadata.image_validation??null,
    image_provenance:metadata.image_provenance??null,
    price_unit: row.price_unit ?? metadata.price_unit ?? null,
    city: row.city ?? metadata.city ?? null,
    address: row.address ?? metadata.address ?? null,
    location: row.location ?? metadata.location ?? null,
    observed_at: row.observed_at ?? metadata.observed_at ?? row.scraped_at ?? null,
    product_id: row.product_id,
    external_id: row.external_id,
    source_site: row.source_site,
    capability: row.capability,
    scraped_at: row.scraped_at,
    title: row.title,
    price_text: row.price_text,
    price_amount: row.price_amount,
    currency: row.currency,
    price_status: row.price_status,
    price_basis: row.price_kind ?? null,
    source_type: ['smzdm', 'smzdm.com'].includes(row.source_site) ? 'aggregator' : 'direct',
    price_observed_at: row.price_observed_at,
    price_conditions: priceConditions,
    seller: row.seller,
    page_url: row.product_url,
    image_url: rawImageUrl,
    image_urls: imageUrls,
    image_id: primary ? primary.image_id : null,
    primary_image: primary,
    images,
    same_product_key: row.same_product_key,
    shipping: shippingOf(row, optional),
  };
}

/**
 * 按关键词查候选商品（纯 LIKE / 余弦无关的朴素包含匹配；库很小，够用且可解释）。
 * @param {{keywords?: string[], limit?: number}} options
 */
export function searchProducts(db, { keywords = [], limit = 50 } = {}) {
  const terms = [...new Set((Array.isArray(keywords) ? keywords : []).map((item) => String(item).trim()).filter((item) => item.length >= 2))].slice(0, 12);
  const hydrated = listProducts(db, {limit:null});
  if (terms.length === 0) return hydrated.slice(0, limit);
  return hydrated
    .map((product) => {
      const haystack = `${product.title} ${product.seller ?? ''}`.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term.toLowerCase()));
      return { product, hits: hits.length, matched_terms: hits };
    })
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((entry) => ({ ...entry.product, matched_terms: entry.matched_terms })).slice(0, limit);
}

/**
 * 按图片标识反查真实图片行（给同源代理路由用）。
 * @returns {{product_id: string, url: string, alt: string|null, source_site: string, page_url: string}|null}
 */
export function findImageById(db, imageId) {
  if (typeof imageId !== 'string' || !/^[a-f0-9]{8,64}$/.test(imageId)) return null;
  const rows = db.prepare('select product_id, url, alt from product_images').all();
  for (const row of rows) {
    if (imageIdOf(row.product_id, row.url) === imageId) {
      const product = db.prepare('select source_site, product_url from products where product_id = ?').get(row.product_id) ?? null;
      return { product_id: row.product_id, url: row.url, alt: row.alt ?? null, source_site: product?.source_site ?? null, page_url: product?.product_url ?? null };
    }
  }
  const products = db.prepare("select product_id, image_url, source_site, product_url from products where image_url is not null").all();
  for (const row of products) {
    if (imageIdOf(row.product_id, row.image_url) === imageId) {
      return { product_id: row.product_id, url: row.image_url, alt: null, source_site: row.source_site ?? null, page_url: row.product_url ?? null };
    }
  }
  return null;
}
