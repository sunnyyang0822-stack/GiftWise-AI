/**
 * 阶段二 · 匹配层：把「第 2 步的三个候选方案」绑到**库里的真实商品**上。
 *
 * 输入：一个候选方案的条件（标题 / 关键词 / 预算区间）。
 * 输出：库中命中的真实商品 —— `page_url` + `image_urls` + `price_amount` + `price_basis`。
 * ⛔ 本文件**纯读本地库、不联网**（打开方式也是只读，见 catalog/db.mjs）。
 *
 * ── 为什么要有「命中层级」，而不是简单 LIKE ──────────────────────────────
 * 库里只有真实抓取来的少量记录。如果只按「礼物」这种泛词去 LIKE，任何候选都能
 * 命中任意一条记录，那是**假装匹配**。所以这里把命中判据分成三级，并如实写清依据：
 *   偏好与形式交给模型理解；绑定仅使用原文字面依据。
 *   `literal` 与商品标题有 ≥3 个汉字的连续公共子串；
 *   （泛词如「礼物/礼品」单独出现**不算命中** —— 库本来就是按「礼物」抓的，
 *     拿它当匹配依据等于说「所有礼物都是这个候选」，属假装匹配。）
 * 命中不了就如实返回原因码，**绝不**用假商品或占位图顶。
 */

import { existsSync } from 'node:fs';
import { openCatalogDb, getStats, listProducts } from './db.mjs';
import { CATALOG_CONFIG } from '../config.mjs';

export const CATALOG_REASON = Object.freeze({
  CATALOG_DB_MISSING: '本地真实商品库不存在（未做过离线预热采集）',
  CATALOG_DB_UNREADABLE: '本地真实商品库无法只读打开',
  CATALOG_DB_EMPTY: '本地库存在但没有任何可购买条目（只有资讯帖）',
  CATALOG_NO_CNY_PRICE: '库中记录都没有人民币观察价，未做汇率换算',
  CATALOG_NO_SEMANTIC_MATCH: '没有找到与候选主题相关的真实商品（泛词不算命中）',
  CATALOG_OUT_OF_BUDGET: '匹配到的真实商品观察价超出本次预算上限',
  CATALOG_PRODUCT_TAKEN: '该真实商品已绑定给本次另一个候选（不重复占用）',
  CATALOG_NO_IMAGE: '命中的真实商品在库里没有图片 URL（采集时未取图），如实不给图',
  CATALOG_MATCHED: '命中库内真实商品',
});

/**
 * 旧主题别名接口（当前为空）。
 * 旧接口导出保留为空，当前不使用人工类目映射。
 */
// 保留旧导出供调用方兼容；偏好理解交给模型，目录仅核对原文字面依据。
export const THEME_ALIASES = Object.freeze([]);

/** 泛词：单独命中不构成匹配依据（库就是按这些词抓的）。 */
const GENERIC_TERMS = Object.freeze(['礼物', '礼品', '送人', '生日', '节日', '礼盒', '心意']);

/** 中文连续公共子串的最小长度（汉字数）。 */
const MIN_CJK_OVERLAP = 3;

/** 从候选里取出参与匹配的文字（标题 + 描述 + 关键词，全部来自模型输出，这里是数据不是指令）。 */
export function candidateText(candidate) {
  if (!candidate || typeof candidate !== 'object') return '';
  const parts = [];
  if (typeof candidate.name === 'string') parts.push(candidate.name);
  if (typeof candidate.description === 'string') parts.push(candidate.description);
  if (Array.isArray(candidate.keywords)) parts.push(candidate.keywords.filter((item) => typeof item === 'string').join(' '));
  if (typeof candidate.category === 'string') parts.push(candidate.category);
  return parts.join(' ').toLowerCase();
}

function cjkRuns(text) {
  return String(text).match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
}

/** 最长公共连续子串（只在 CJK 连续段内比较，避免把标点/字母算法混进来）。 */
export function longestCjkOverlap(a, b) {
  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  let best = '';
  for (const runA of cjkRuns(left)) {
    for (const runB of cjkRuns(right)) {
      const max = Math.min(runA.length, runB.length);
      for (let len = max; len >= MIN_CJK_OVERLAP; len -= 1) {
        if (len <= best.length) break;
        let found = false;
        for (let i = 0; i + len <= runA.length; i += 1) {
          if (runB.includes(runA.slice(i, i + len))) {
            best = runA.slice(i, i + len);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  }
  return best;
}

/**
 * 单个候选对单个商品的命中判据。
 * @returns {{hit: boolean, basis: string|null, confidence: string, detail: string}}
 */
export function scorePair(text, product) {
  const title = String(product.title ?? '').toLowerCase();
  const words = text.match(/[a-z0-9][a-z0-9-]{2,}/gi) ?? [];
  const commonWord = words.find(word => title.includes(word));
  if (commonWord) return { hit: true, basis: 'literal', confidence: 'medium', detail: `与商品标题有原文关键词「${commonWord}」` };
  const specificText = GENERIC_TERMS.reduce((value,term) => value.replaceAll(term,''), text);
  const specificTitle = GENERIC_TERMS.reduce((value,term) => value.replaceAll(term,''), title);
  const overlap = longestCjkOverlap(specificText, specificTitle);
  if (overlap.length >= MIN_CJK_OVERLAP) {
    return { hit: true, basis: 'literal', confidence: 'medium', detail: `与商品标题有连续公共子串「${overlap}」（${overlap.length} 个汉字）` };
  }
  const genericOnly = GENERIC_TERMS.filter((term) => text.includes(term));
  if (genericOnly.length) {
    return { hit: false, basis: null, confidence: 'none', detail: `只命中泛词（${genericOnly.join('、')}），泛词不构成主题匹配依据` };
  }
  return { hit: false, basis: null, confidence: 'none', detail: '候选文字与商品标题没有任何主题或字面重合' };
}

function cents(amount) {
  if (typeof amount !== 'string' && typeof amount !== 'number') return null;
  const text = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/**
 * 为每个候选方案匹配真实商品。
 *
 * @param {Array<object>} candidates 第 2 步输出的候选（服务端已校验通过的那些）
 * @param {{dbPath: string, budgetAmount?: string|null, maxItems?: number, excludeProductIds?: string[]}} options
 * @returns {{status: 'ready'|'partial'|'unavailable', source: 'localdb', db_path: string,
 *            hit_kind: 'library'|'degraded', reason_code: string|null, stats: object|null,
 *            results: Array<{candidate_id: string, status: 'matched'|'no_match', reason_code: string,
 *                           match_basis: string|null, match_confidence: string, match_detail: string,
 *                           product: object|null}>}}
 */
export function matchCandidates(candidates, { dbPath, budgetAmount = null, maxItems = 3, excludeProductIds = [] } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter((item) => item && typeof item === 'object' && typeof item.id === 'string') : [];
  const base = { source: 'localdb', db_path: dbPath ?? null, hit_kind: 'degraded', reason_code: null, stats: null, enrichment_only: true, recommendations_available: true };
  const empty = list.map((candidate) => ({
    candidate_id: candidate.id,
    status: 'no_match',
    reason_code: 'CATALOG_DB_MISSING',
    match_basis: null,
    match_confidence: 'none',
    match_detail: CATALOG_REASON.CATALOG_DB_MISSING,
    product: null,
  }));

  if (!dbPath || !existsSync(dbPath)) {
    return { ...base, status: 'unavailable', reason_code: 'CATALOG_DB_MISSING', results: empty };
  }
  let db;
  try {
    db = openCatalogDb(dbPath);
  } catch (error) {
    return {
      ...base,
      status: 'unavailable',
      reason_code: error.code ?? 'CATALOG_DB_UNREADABLE',
      results: list.map((candidate) => ({ ...empty[0], candidate_id: candidate.id, reason_code: error.code ?? 'CATALOG_DB_UNREADABLE', match_detail: CATALOG_REASON[error.code] ?? CATALOG_REASON.CATALOG_DB_UNREADABLE })),
    };
  }
  try {
    const stats = getStats(db);
    if (stats.total === 0) {
      return { ...base, status: 'unavailable', reason_code: 'CATALOG_DB_EMPTY', stats, results: list.map((c) => ({ ...empty[0], candidate_id: c.id, reason_code: 'CATALOG_DB_EMPTY', match_detail: CATALOG_REASON.CATALOG_DB_EMPTY })) };
    }
    const products = listProducts(db, { limit: null }).filter((product) => product.currency === 'CNY' || product.currency == null);
    if (products.length === 0) {
      return { ...base, status: 'unavailable', reason_code: 'CATALOG_NO_CNY_PRICE', stats, results: list.map((c) => ({ ...empty[0], candidate_id: c.id, reason_code: 'CATALOG_NO_CNY_PRICE', match_detail: CATALOG_REASON.CATALOG_NO_CNY_PRICE })) };
    }
    const budgetCents = cents(budgetAmount);
    const taken = new Set(excludeProductIds);
    const results = [];
    for (const candidate of list) {
      const text = candidateText(candidate);
      const scored = products
        .filter((product) => !taken.has(product.product_id))
        .map((product) => ({ product, ...scorePair(text, product) }))
        .filter((entry) => entry.hit)
        .sort((a, b) => {
          const basisRank = (entry) => (entry.basis === 'theme' ? 0 : 1);
          if (basisRank(a) !== basisRank(b)) return basisRank(a) - basisRank(b);
          const priceA = cents(a.product.price_amount) ?? 0;
          const priceB = cents(b.product.price_amount) ?? 0;
          return priceA - priceB;
        });
      if (scored.length === 0) {
        const genericOnly = GENERIC_TERMS.filter((term) => text.includes(term));
        results.push({
          candidate_id: candidate.id,
          status: 'no_match',
          reason_code: 'CATALOG_NO_SEMANTIC_MATCH',
          match_basis: null,
          match_confidence: 'none',
          match_detail: genericOnly.length
            ? `${CATALOG_REASON.CATALOG_NO_SEMANTIC_MATCH}（候选只提到泛词 ${genericOnly.join('、')}）`
            : CATALOG_REASON.CATALOG_NO_SEMANTIC_MATCH,
          product: null,
        });
        continue;
      }
      const budgetOk = scored.filter((entry) => budgetCents === null || (cents(entry.product.price_amount) === null || cents(entry.product.price_amount) <= budgetCents));
      const chosen = budgetOk[0] ?? null;
      if (!chosen) {
        results.push({
          candidate_id: candidate.id,
          status: 'no_match',
          reason_code: 'CATALOG_OUT_OF_BUDGET',
          match_basis: scored[0].basis,
          match_confidence: 'none',
          match_detail: `${CATALOG_REASON.CATALOG_OUT_OF_BUDGET}：最低命中价 ${scored[0].product.price_amount} ${scored[0].product.currency}，预算上限 ${budgetAmount}`,
          product: null,
        });
        continue;
      }
      taken.add(chosen.product.product_id);
      const hasImage = typeof chosen.product.image_id === 'string' && chosen.product.image_id.length > 0;
      results.push({
        candidate_id: candidate.id,
        status: 'matched',
        reason_code: hasImage ? 'CATALOG_MATCHED' : 'CATALOG_NO_IMAGE',
        match_basis: chosen.basis,
        match_confidence: chosen.confidence,
        match_detail: hasImage ? chosen.detail : `${chosen.detail}；该记录在库里没有图片 URL，如实不给图`,
        product: {
          product_id: chosen.product.product_id,
          title: chosen.product.title,
          price_unit: chosen.product.price_unit,
          city: chosen.product.city,
          address: chosen.product.address,
          location: chosen.product.location,
          observed_at: chosen.product.observed_at,
          record_kind: chosen.product.record_kind,
          variant: '',
          quantity: 1,
          currency: chosen.product.currency,
          price_amount: chosen.product.price_amount,
          price_text: chosen.product.price_text,
          price_basis: chosen.product.price_basis,
          price_status: chosen.product.price_status,
          source_type: chosen.product.source_type,
          price_observed_at: chosen.product.price_observed_at,
          price_conditions: chosen.product.price_conditions,
          page_url: chosen.product.page_url,
          image_urls: chosen.product.image_urls,
          image_id: hasImage ? chosen.product.image_id : null,
          source_site: chosen.product.source_site,
          seller: chosen.product.seller,
          scraped_at: chosen.product.scraped_at,
          /**
           * 运输/预售信息：**采集侧**（另一个 agent 用 opencli 协作抓取）在补的字段，
           * 这里只做前向兼容的读取与带出，绝不自己编造发货地或时效。
           * `declared=false` 表示页面确实没给 ⇒ 时间判定按保守默认 + 如实标注估算。
           */
          shipping: {
            shipping_origin: chosen.product.shipping?.shipping_origin ?? null,
            seller_location_text: chosen.product.shipping?.seller_location_text ?? null,
            shipping_time_text: chosen.product.shipping?.shipping_time_text ?? null,
            ships_within_text: chosen.product.shipping?.ships_within_text ?? null,
            is_preorder: chosen.product.shipping?.is_preorder ?? null,
            shipping_days: chosen.product.shipping?.shipping_days ?? null,
            presale_days: chosen.product.shipping?.presale_days ?? null,
            ships_within_days: chosen.product.shipping?.ships_within_days ?? null,
            declared: chosen.product.shipping?.declared === true,
            source: 'localdb.product_page',
          },
          evidence_ref: `localdb:${chosen.product.product_id}`,
          attribution: `真实商品来源：${chosen.product.source_site}${chosen.product.seller ? ` / ${chosen.product.seller}` : ''}（页面观察价，非结算价）`,
        },
      });

    }
    const matched = results.filter((entry) => entry.status === 'matched');
    return {
      ...base,
      status: matched.length === 0 ? 'unavailable' : matched.length === list.length ? 'ready' : 'partial',
      hit_kind: matched.length > 0 ? 'library' : 'degraded',
      reason_code: matched.length > 0 ? null : 'CATALOG_NO_SEMANTIC_MATCH',
      stats,
      products_total: products.length,
      results,
    };
  } finally {
    try {
      db.close();
    } catch {
      /* 只读连接关闭失败不影响结果 */
    }
  }
}

/**
 * 库优先：在调用大模型**之前**，从本地商品库筛出真实、可追溯、在预算内的商品，
 * 作为 `library_json` 一起发给模型（产品负责人：「大语言模型必须调用 OpenCLI 进行协作」）。
 *
 * 诚实边界：这里只做「读数 + 预算过滤 + 禁忌字面过滤」，**不做语义匹配**
 * （语义匹配在候选生成之后由 `matchCandidates` 独立做，不因为模型"引用了库"就跳过校验）。
 * 只读、不联网；库不存在/为空 ⇒ 返回 null（信封里就不会出现 library_json，不编造）。
 *
 * @returns {{products: Array<object>, db_path: string, total: number, note: string}|null}
 */
export function libraryPreview({ dbPath, budgetAmount = null, limit = 8, forbiddenTerms = [], forbiddenTags = [], keywords = [], searchPlan = null } = {}) {
  let db = null;
  try {
    db = openCatalogDb(dbPath ?? CATALOG_CONFIG.dbPath);
    const stats = getStats(db);
    if (!stats || stats.total === 0) return null;
    const budgetCents = cents(budgetAmount);
    const terms = [...(forbiddenTerms ?? []), ...(forbiddenTags ?? [])].filter((t) => typeof t === 'string' && t.trim());
    const wanted = [...(searchPlan?.keywords ?? []), ...(keywords ?? [])].filter((k) => typeof k === 'string' && k.trim());
    const products = listProducts(db, { limit: null })
      .filter((product) => product.currency === 'CNY' || product.currency == null)
      .filter((product) => wanted.length === 0 || wanted.some(k => String(product.title ?? '').toLowerCase().includes(k.toLowerCase())))
      .filter((product) => budgetCents === null || (cents(product.price_amount) ?? 0) <= budgetCents)
      .filter((product) => !terms.some((term) => String(product.title ?? '').includes(term)))
      .sort((a, b) => {
        // 有关键词时优先给「和用户兴趣字面相关」的，其次便宜的先给（更容易落在预算内）。
        const score = (p) => wanted.reduce((sum, key) => sum + (String(p.title ?? '').includes(key) ? 1 : 0), 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return (cents(a.price_amount) ?? 0) - (cents(b.price_amount) ?? 0);
      })
      .slice(0, Math.max(1, limit))
      .map((product) => ({
        product_id: product.product_id,
        title: product.title,
        price_amount: product.price_amount,
        currency: product.currency,
        price_basis: product.price_basis,
        price_status: product.price_status,
        source_type: product.source_type,
        price_observed_at: product.price_observed_at ?? null,
        page_url: product.page_url,
        source_site: product.source_site ?? null,
        has_image: Array.isArray(product.image_urls) && product.image_urls.length > 0,
      }));
    if (products.length === 0) return null;
    return {
      products,
      db_path: dbPath ?? CATALOG_CONFIG.dbPath,
      total: stats.total,
      note: '本地商品库（opencli 采集的真实商品页）实读结果；价格为页面观察价，未核实库存、配送与结算价。',
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* 只读连接关闭失败不影响结果 */
    }
  }
}
