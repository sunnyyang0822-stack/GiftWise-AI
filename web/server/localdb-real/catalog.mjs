/**
 * GiftWise AI · 真实商品目录（读本地库）
 *
 * 这是后端读取「真实抓取数据」的唯一入口。它只做两件事：
 *   1. 从本地库读出真实抓取到的行；
 *   2. 如果读不出可用数据，返回**明确、如实的空态/降级状态**，说明原因。
 *
 * 🔴 硬性约束（与任务书一致，且由 tests/real-data-catalog.test.mjs 守住）：
 *   - 本模块**不得**生成、编造、补全任何商品行；
 *   - 不得返回写到代码里的固定商品；
 *   - 空态必须带 reason_code + 中文 reason，不许静默返回空数组了事。
 */
import { openDb, queryProducts, getStats, defaultDbPath, getProductImages, compareQuotes } from './db.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ 进程自证
// 🔴 为什么要有这一段：复核时出现过「/api/catalog 返回 mode=real 但 0 条」的疑云。
// 根因是**8899 上跑的是改代码之前启动的旧进程**——旧进程不会自己重载代码。
// 所以响应里必须带上「这份响应到底是哪份代码、哪个进程、哪个库」产出的，
// 并且能自己判断出「我这份代码和磁盘上的不一致（=我是旧进程）」。
const HERE = dirname(fileURLToPath(import.meta.url));
const PROCESS_STARTED_AT = new Date().toISOString();
const SELF_FILES = ['catalog.mjs', 'db.mjs', 'schema.mjs'];

function hashSelfFiles() {
  const h = createHash('sha256');
  for (const f of SELF_FILES) {
    try {
      h.update(readFileSync(join(HERE, f)));
    } catch {
      h.update(`missing:${f}`);
    }
  }
  return h.digest('hex').slice(0, 16);
}

/** 本进程启动时加载到的代码版本。 */
export const CODE_REVISION = hashSelfFiles();

/**
 * 自证：运行中的代码版本 vs 磁盘上的代码版本。
 * `stale_process: true` 表示**这是一个旧进程，必须重启**，它返回的数据不可信。
 */
export function codeFreshness() {
  const onDisk = hashSelfFiles();
  return {
    running_code_revision: CODE_REVISION,
    on_disk_code_revision: onDisk,
    stale_process: onDisk !== CODE_REVISION,
  };
}

function dbMtime(dbPath) {
  try {
    return statSync(dbPath).mtime.toISOString();
  } catch {
    return null;
  }
}

/** 页面观察价免责声明：价格会变，不是结算价。 */
export const PRICE_DISCLAIMER =
  '价格为「页面观察价」（抓取当时的页面显示值），不是结算价；' +
  '优惠券、会员价、运费、时效都可能改变实际到手价，下单前请以商品页为准。';

/** 空态/降级时给界面与复核者的**中文提示**（不静默返回空数组就完事）。 */
function noticeFor(reasonCode, dbPath) {
  const base = {
    DB_MISSING: '⚠ 读不到本地真实商品库：库文件不存在，本次没有返回任何商品（不是「没有合适的商品」，是「根本没读到库」）。',
    DB_EMPTY: '⚠ 本地真实商品库里一条商品都没有，本次没有返回任何商品；请先跑一次采集，不要把它当成「没有合适的商品」。',
    DB_UNREADABLE: '⚠ 本地真实商品库无法打开（文件存在但读不了），本次没有返回任何商品；这是如实的降级状态。',
    NO_MATCH: '本次筛选条件下没有匹配的真实商品；换关键词或去掉筛选再试。',
    NO_PRICED_PRODUCTS: '库里有抓取记录，但没有一条解析出可用价格，因此不返回商品，也不补假价格。',
    NO_CNY_PRODUCTS: '库里有带价格的商品，但没有人民币报价；推荐链路只接受 CNY，因此如实为空。',
  }[reasonCode];
  return `${base ?? '本次没有可用的真实商品数据。'}（库路径：${dbPath}；路径来自 GW_LOCAL_DB / GIFTWISE_CATALOG_DB，未配置时用真实库默认路径。）`;
}

const REASONS = {
  DB_MISSING: (p) =>
    `本地库里还没有任何真实抓取数据（库文件 ${p} 不存在）。` +
    '请先运行一次采集：node web/server/collect/collect.mjs（或 tools/opencli-collect/refresh-and-serve.sh）。',
  DB_EMPTY: (p) =>
    `本地库（${p}）存在但一条商品都没有：还没有成功跑过采集，或最近的采集全部失败。` +
    '可以用 GET /api/catalog/runs 看每次采集的失败原因。',
  NO_PRICED_PRODUCTS: (p, stats) =>
    `本地库（${p}）里有 ${stats.total} 条抓取记录，但没有一条解析出可用价格（price_status=parsed）。` +
    '这通常说明来源返回的是资讯帖而非商品条目；本服务不会把它们当成可购买商品，也不会补一个假价格。',
  NO_MATCH: () => '当前筛选条件下没有匹配的真实抓取商品。',
  NO_CNY_PRODUCTS: (p, stats) =>
    `本地库（${p}）里有 ${stats.total} 条带价格的商品，但没有人民币（CNY）报价；` +
    '推荐链路只接受 CNY 报价，因此这里如实为空，不做汇率换算、不用其他币种顶替。',
};

/**
 * 组装目录响应。
 * @param {object} opts
 * @param {string} [opts.dbPath]      库路径（默认 .local-db/giftwise.sqlite）
 * @param {string} [opts.keyword]     关键词
 * @param {string} [opts.source]      来源站
 * @param {string} [opts.since]       scraped_at >= since
 * @param {boolean}[opts.onlyCny]     只要人民币报价（推荐链路用）
 * @param {number} [opts.limit]
 */
export function buildCatalog(opts = {}) {
  const { dbPath = defaultDbPath(), keyword, source, since, onlyCny = false, limit = 50 } = opts;
  const filePresent = dbPath === ':memory:' || existsSync(dbPath);

  /* 库文件不存在 ⇒ **直接如实报缺库**，不要走到 openDb：
     采集侧「打开即建表」是写库时的正常行为，但**读**路径顺手建一个空库，会把
     「根本没读到库」伪装成「库是空的」，还会在那个路径上留下一个空文件，把排查带偏。
     本仓库既有测试同样要求「不得偷偷建一个空库当作真实数据源」（web/tests/catalog-match.test.mjs）。 */
  if (!filePresent) {
    let emptyStats = null;
    try {
      const mem = openDb(':memory:');
      emptyStats = getStats(mem);
      closeQuietly(mem);
    } catch {
      emptyStats = null;
    }
    return {
      mode: 'empty',
      product_source: 'localdb',
      db_path: dbPath,
      db_mtime: null,
      generated_at: new Date().toISOString(),
      price_disclaimer: PRICE_DISCLAIMER,
      price_kind: 'page_observed',
      product_count: 0,
      stats: emptyStats,
      filters: { keyword: keyword ?? null, source: source ?? null, since: since ?? null, only_cny: onlyCny, limit },
      reason_code: 'DB_MISSING',
      reason: REASONS.DB_MISSING(dbPath, emptyStats),
      notice: noticeFor('DB_MISSING', dbPath),
      products: [],
    };
  }

  let db;
  try {
    db = openDb(dbPath);
  } catch (err) {
    return {
      mode: 'empty',
      product_source: 'localdb',
      db_path: dbPath,
      generated_at: new Date().toISOString(),
      reason_code: 'DB_UNREADABLE',
      reason: `本地库无法打开（${dbPath}）：${err.message}。这是如实的降级状态，没有返回任何商品。`,
      notice: noticeFor('DB_UNREADABLE', dbPath),
      products: [],
      stats: null,
      price_disclaimer: PRICE_DISCLAIMER,
    };
  }

  const stats = getStats(db);
  const products = queryProducts(db, { keyword, source, since, onlyPriced: true, limit });

  try {
  // 人民币过滤：推荐链路只认 CNY。
  const usable = onlyCny ? products.filter((p) => p.currency === 'CNY') : products;

  const base = {
    product_source: 'localdb',
    db_path: dbPath,
    db_mtime: dbMtime(dbPath),
    generated_at: new Date().toISOString(),
    price_disclaimer: PRICE_DISCLAIMER,
    price_kind: 'page_observed',
    stats,
    filters: { keyword: keyword ?? null, source: source ?? null, since: since ?? null, only_cny: onlyCny, limit },
    // 进程自证：看到这一段就能判断响应是哪个进程 / 哪份代码 / 哪个库产出的。
    // 复核时如果 stale_process=true，说明这是**改代码之前启动的旧进程**，它的结果不可信。
    process: { pid: process.pid, started_at: PROCESS_STARTED_AT, ...codeFreshness() },
  };

  if (usable.length > 0) {
    return {
      ...base,
      mode: 'real',
      product_count: usable.length,
      reason_code: null,
      reason: null,
      products: usable.map((p) => toPublicProduct(p, db)),
    };
  }

  // 空态：分清楚到底卡在哪一步，绝不糊成一个空数组。
  let reason_code;
  let reason;
  if (!filePresent || stats.total === 0) {
    reason_code = filePresent ? 'DB_EMPTY' : 'DB_MISSING';
    reason = REASONS[reason_code](dbPath, stats);
  } else if (products.length === 0) {
    reason_code = 'NO_MATCH';
    reason = REASONS.NO_MATCH();
  } else if (onlyCny && stats.priced > 0) {
    reason_code = 'NO_CNY_PRODUCTS';
    reason = REASONS.NO_CNY_PRODUCTS(dbPath, stats);
  } else {
    reason_code = 'NO_PRICED_PRODUCTS';
    reason = REASONS.NO_PRICED_PRODUCTS(dbPath, stats);
  }

  return { ...base, mode: 'empty', product_count: 0, reason_code, reason, notice: noticeFor(reason_code, dbPath), products: [] };
  } finally {
    closeQuietly(db);
  }
}

/** 读库是一次性的：用完就关，避免 Windows 上句柄不释放导致文件删不掉。 */
function closeQuietly(db) {
  try {
    db.close();
  } catch {
    /* 已经关了就算了 */
  }
}

/** 对外暴露的商品字段：只给真实存在的数据，缺失字段如实为 null。 */
export function toPublicProduct(p, db = null) {
  const images = db ? getProductImages(db, p.product_id) : [];
  return {
    product_id: p.product_id,
    title: p.title,
    price_text: p.price_text,
    // 库里按十进制字符串存（避免浮点误差），对外给数字，方便前端直接用。
    price_amount: p.price_amount === null || p.price_amount === undefined ? null : Number(p.price_amount),
    currency: p.currency,
    price_kind: p.price_kind, // 固定 page_observed
    price_basis: p.price_kind, // 同义别名：价格口径，恒为 page_observed（页面观察价）
    price_status: p.price_status,
    price_observed_at: p.price_observed_at,
    price_conditions: p.price_conditions,
    seller: p.seller,
    // 🔴 来源可追溯：商品页原始链接 + 图片原始 URL，都不是本地代理路径
    product_url: p.product_url,
    page_url: p.product_url, // 同义别名，复核脚本/前端可直接取用
    image_url: p.image_url,
    image_urls: images.map((i) => i.url),
    image_details: images.map((i) => ({ url: i.url, kind: i.kind, alt: i.alt, capability: i.capability, scraped_at: i.scraped_at })),
    // 图片等级：product_image=抓到的真实商品图 URL（首选）/ page_screenshot=页面截图兜底 /
    // null=两级都没拿到（如实降级，**不放任何假图**）。
    image_kind: imageKind(p, images),
    // 用截图兜底时必填，且必须与 page_url 一致（可追溯）；用真实图时为 null。
    source_page_url: imageKind(p, images) === 'page_screenshot' ? p.product_url : null,
    image_note:
      imageKind(p, images) === 'page_screenshot'
        ? `页面截图 · 来源：${p.product_url}（这不是商品实物图，是来源页面的截图）`
        : null,
    image_degraded_reason: p.image_degraded_reason ?? null,
    source_site: p.source_site,
    capability: p.capability,
    scraped_at: p.scraped_at,
    record_kind: p.record_kind,
    same_product_key: p.same_product_key,
    query_params: p.query_params,
    raw_excerpt: p.raw_excerpt,

    // ---- 配送 / 预售（产品负责人追加）----
    // 🔴 键**永远存在**；拿不到就是 null（不是 ""、不是 undefined）。
    //    绝不用「全国包邮 2-3 天」这类通用话术填。
    seller_location_text: p.seller_location_text ?? null,
    shipping_origin: p.seller_location_text ?? null, // 同义别名：发货地/卖家所在地
    shipping_time_text: p.shipping_time_text ?? null,
    ships_within_text: p.ships_within_text ?? null,
    // ⭐ 解析出的天数：只能是**正整数或 null**（0/字符串/undefined 都不许出现）
    ships_within_days: Number.isInteger(p.ships_within_days) && p.ships_within_days > 0 ? p.ships_within_days : null,
    ships_within_day_type: p.ships_within_day_type ?? null, // business=工作日 / calendar=自然日
    // is_preorder 只能是 boolean 或 null（库里存 1/0/NULL）
    is_preorder: p.is_preorder === 1 ? true : p.is_preorder === 0 ? false : null,
    presale_text: p.presale_text ?? null,
    // ⭐⭐ 预售时长（天）：产品负责人说这是关键字段
    presale_days: Number.isInteger(p.presale_days) && p.presale_days > 0 ? p.presale_days : null,
    presale_day_type: p.presale_day_type ?? null,
    fulfillment_evidence: p.fulfillment_evidence ?? [],
  };
}

/** 图片等级判定：有真实商品图 URL 就绝不降级成截图。 */
function imageKind(p, images) {
  if (images.length > 0) return 'product_image';
  if (p.image_kind === 'page_screenshot') return 'page_screenshot';
  return null;
}

/**
 * 比价视图：同一种商品的多条报价，取页面观察价最低的一条。
 * 「同一种商品」的判定规则写在 docs/architecture/真实抓取数据接入本地库-2026-10-31.md，
 * 实现见 db.mjs 的 sameProductKey()。
 */
export function buildComparison(opts = {}) {
  const { dbPath = defaultDbPath(), keyword, source, limit = 50 } = opts;
  let db;
  try {
    db = openDb(dbPath);
  } catch (err) {
    return {
      mode: 'empty',
      reason_code: 'DB_UNREADABLE',
      reason: `本地库无法打开（${dbPath}）：${err.message}`,
      groups: [],
      price_disclaimer: PRICE_DISCLAIMER,
    };
  }
  const stats = getStats(db);
  const groups = compareQuotes(db, { keyword, source, limit });
  closeQuietly(db);
  if (!groups.length) {
    const cat = buildCatalog({ dbPath, keyword, source, onlyCny: true, limit: 1 });
    return {
      mode: 'empty',
      reason_code: cat.reason_code,
      reason: cat.reason,
      groups: [],
      stats,
      price_kind: 'page_observed',
      price_disclaimer: PRICE_DISCLAIMER,
      same_product_rule: SAME_PRODUCT_RULE,
    };
  }
  return {
    mode: 'real',
    reason_code: null,
    reason: null,
    stats,
    groups,
    multi_quote_groups: groups.filter((g) => g.quote_count > 1).length,
    single_quote_groups: groups.filter((g) => g.quote_count === 1).length,
    price_kind: 'page_observed',
    price_disclaimer: PRICE_DISCLAIMER,
    same_product_rule: SAME_PRODUCT_RULE,
  };
}

/** 「同一种商品」判定规则的对外说明（与 db.mjs 实现一一对应）。 */
export const SAME_PRODUCT_RULE = Object.freeze({
  summary:
    '同一种商品 = 归一化标题相同 **且** 主图指纹相同。两者都一致才归为同一条商品的不同报价；' +
    '只要有一项不同就当不同商品。',
  title_normalization: '去掉促销前缀（第一个「：」之前不超过 24 字的标签）、去掉【】后缀、去掉空白与标点、转小写',
  image_fingerprint: '主图 URL 去掉尺寸后缀（如 ...jpg_d250.jpg → ...jpg）后的文件名',
  conservative_note:
    '这是**故意保守**的取向：宁可不合并，也不冒「A 商品的最低价配 B 商品的图」的风险。' +
    '因此标题相同但主图不同的两条报价不会合并，可能漏掉一些本可合并的报价。',
  no_mixing_guarantee:
    '每条报价都只带自己的图片与自己的链接，比价结果里的最低价与图片永远来自同一条报价，不跨报价拼装。',
  currency_note: '只在同币种内比价（当前只接受 CNY）；不做汇率换算。',
  price_scope_note: '比较的是「页面观察价」的数值，不是结算价/到手价；券与会员条件原样保留，不折算。',
});

/** 给 /api/config 用的一句话状态，让调用方能判断当前是不是真实数据。 */
export function productSourceStatus(opts = {}) {
  const cat = buildCatalog({ ...opts, limit: 1 });
  return {
    product_source: 'localdb',
    mode: cat.mode,
    reason_code: cat.reason_code,
    real_products: cat.stats?.total ?? 0,
    priced_products: cat.stats?.priced ?? 0,
    last_ok_at: cat.stats?.lastOkAt ?? null,
  };
}
