/**
 * GiftWise AI · 本地真实抓取库 · 访问层（node:sqlite）
 *
 * 选型理由：Node v24 自带 node:sqlite（无需联网安装任何依赖），本机实测
 * Node v24.21.0 + SQLite 3.53.4 + FTS5 可用。见 docs/architecture/... 文档。
 *
 * 本模块只做「存取」，不做任何联网、不调用模型、不生成商品。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 仓库根：web/server/localdb -> web/server -> web -> repo */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** 默认库位置：仓库内已被 .gitignore 的 .local-db/。 */
export function defaultDbPath() {
  return process.env.GW_LOCAL_DB || join(REPO_ROOT, '.local-db', 'giftwise.sqlite');
}

/** 打开（必要时创建）库并建表。 */
export function openDb(dbPath = defaultDbPath()) {
  const file = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA_SQL);
  migrate(db);
  return db;
}

/**
 * 轻量迁移：给早期版本建好的库补上后来新增的列。
 * 只做 ADD COLUMN（SQLite 支持），不改动既有数据。
 */
function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
  const add = [
    ['record_kind', "ALTER TABLE products ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'product'"],
    ['image_url', 'ALTER TABLE products ADD COLUMN image_url TEXT'],
    ['same_product_key', "ALTER TABLE products ADD COLUMN same_product_key TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, sql] of add) if (!cols.has(name)) db.exec(sql);
}

/** 稳定的商品主键：同一来源+能力+来源 id 始终得到同一 product_id。 */
export function productId({ source_site, capability, external_id, product_url }) {
  const basis = `${source_site}|${capability}|${external_id || product_url || ''}`;
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

/** 标题归一化：仅用于去重与检索，不改动 title 原文。 */
export function normalizeTitle(title) {
  return String(title || '')
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[·・|｜]/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * 比价用的「同一种商品」判定键。
 *
 * 🔴 判定规则（必须与文档一致，否则会出现「A 商品的最低价配 B 商品的图」）：
 *   1. 标题归一化：去掉促销前缀（第一个「：」之前的「PLUS会员、今日必买：」这类标签）、
 *      去掉【】包裹的后缀、去掉所有空白与标点、转小写。
 *   2. 图片指纹：主图 URL 去掉尺寸后缀（`...jpg_d250.jpg` → `...jpg`）后的基名。
 *   3. 键 = sha256(归一化标题)           —— 拿不到主图时
 *           sha256(归一化标题 + '|' + 图片指纹) —— 有主图时
 *
 * 保守取向（**故意**这样设计）：标题相同但主图不同的两条报价，会被判为**不同商品**，
 * 宁可不合并，也不冒「张冠李戴」的风险。同标题同主图才认为是同一商品的不同报价。
 */
export function sameProductKey({ title, image_url }) {
  const t = comparableTitle(title);
  const fp = imageFingerprint(image_url);
  return createHash('sha256').update(fp ? `${t}|${fp}` : t).digest('hex').slice(0, 24);
}

/** 促销前缀剥离 + 标点去除，只用于比价分组，不改变展示用 title。 */
export function comparableTitle(title) {
  let s = String(title || '');
  // 去掉促销前缀：形如「PLUS会员、今日必买：」「国家补贴、PLUS会员：」
  const colon = s.indexOf('：');
  if (colon > 0 && colon <= 24) s = s.slice(colon + 1);
  s = s.replace(/[【\[][^】\]]*[】\]]/g, ' '); // 【百变扭扭棒礼盒款】
  return s
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・|｜,，。.、!！?？:：;；'"“”‘’()（）\-_/\\+*~`]+/g, '')
    .toLowerCase();
}

/** 主图指纹：去掉 smzdm CDN 的 `_d250` / `_a200` 之类尺寸后缀。 */
export function imageFingerprint(url) {
  if (!url) return '';
  try {
    const base = new URL(url).pathname.split('/').pop() || '';
    // 6ae405632c2916603.jpg_d250.jpg -> 6ae405632c2916603.jpg
    const m = base.match(/^([0-9a-f]{8,}\.(?:jpg|jpeg|png|webp|gif))/i);
    return (m ? m[1] : base).toLowerCase();
  } catch {
    return '';
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

// ---------------------------------------------------------------- 采集运行记录

export function startRun(db, { source_site, capability, query_params, browser_endpoint, opencli_version }) {
  const run_id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO collection_runs
       (run_id, started_at, source_site, capability, query_params, status, item_count, browser_endpoint, opencli_version)
     VALUES (?, ?, ?, ?, ?, 'failed', 0, ?, ?)`,
  ).run(
    run_id,
    new Date().toISOString(),
    source_site,
    capability,
    json(query_params),
    browser_endpoint ?? null,
    opencli_version ?? null,
  );
  return run_id;
}

export function finishRun(db, run_id, { status, item_count = 0, error_code = null, error_message = null, duration_ms = null }) {
  db.prepare(
    `UPDATE collection_runs
        SET finished_at = ?, status = ?, item_count = ?, error_code = ?, error_message = ?, duration_ms = ?
      WHERE run_id = ?`,
  ).run(new Date().toISOString(), status, item_count, error_code, error_message, duration_ms, run_id);
}

// -------------------------------------------------------------------- 商品写入

/**
 * 写入/更新一条商品。
 * 注意：不做任何字段兜底——传入什么写什么；解析不出来的价格就是 null。
 */
export function upsertProduct(db, p) {
  const now = p.scraped_at ?? new Date().toISOString();
  const price_amount = p.currency ? (p.price_amount ?? null) : null;
  const price_status = price_amount === null ? 'missing' : 'parsed';
  const product_id = productId(p);
  const title_norm = normalizeTitle(p.title);
  const same_product_key = p.same_product_key || sameProductKey({ title: p.title, image_url: p.image_url });

  db.prepare(
    `INSERT INTO products
       (product_id, external_id, source_site, capability, scraped_at, record_kind, title, title_norm,
        price_text, price_amount, currency, price_status, price_kind, price_observed_at,
        price_conditions, seller, product_url, image_url, same_product_key, raw_excerpt, query_params,
        first_seen_at, last_seen_at, run_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'page_observed',?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(product_id) DO UPDATE SET
       scraped_at        = excluded.scraped_at,
       record_kind       = excluded.record_kind,
       title             = excluded.title,
       title_norm        = excluded.title_norm,
       price_text        = excluded.price_text,
       price_amount      = excluded.price_amount,
       currency          = excluded.currency,
       price_status      = excluded.price_status,
       price_observed_at = excluded.price_observed_at,
       price_conditions  = excluded.price_conditions,
       seller            = excluded.seller,
       product_url       = excluded.product_url,
       image_url         = COALESCE(excluded.image_url, products.image_url),
       same_product_key  = excluded.same_product_key,
       raw_excerpt       = excluded.raw_excerpt,
       query_params      = excluded.query_params,
       last_seen_at      = excluded.last_seen_at,
       run_id            = excluded.run_id`,
  ).run(
    product_id,
    p.external_id ?? null,
    p.source_site,
    p.capability,
    now,
    p.record_kind ?? 'product',
    p.title,
    title_norm,
    p.price_text ?? null,
    price_amount,
    p.currency ?? null,
    price_status,
    p.price_observed_at ?? now,
    json(p.price_conditions ?? []),
    p.seller ?? null,
    p.product_url,
    p.image_url ?? null,
    same_product_key,
    json(p.raw_excerpt ?? null),
    json(p.query_params ?? {}),
    now,
    now,
    p.run_id,
  );

  // FTS5 手动同步（非 external-content 表，先删后插）。
  db.prepare('DELETE FROM products_fts WHERE product_id = ?').run(product_id);
  db.prepare('INSERT INTO products_fts (product_id, title, seller) VALUES (?,?,?)').run(
    product_id,
    p.title,
    p.seller ?? '',
  );

  // 价格观察历史：append-only，便于回看页面观察价变化。
  db.prepare(
    `INSERT INTO price_observations
       (product_id, observed_at, price_text, price_amount, currency, price_status, price_conditions, run_id)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    product_id,
    p.price_observed_at ?? now,
    p.price_text ?? null,
    price_amount,
    p.currency ?? null,
    price_status,
    json(p.price_conditions ?? []),
    p.run_id,
  );

  return { product_id, price_status };
}

// ---------------------------------------------------------------------- 查询

function rowToProduct(r) {
  return {
    ...r,
    price_conditions: safeJson(r.price_conditions, []),
    query_params: safeJson(r.query_params, {}),
    raw_excerpt: safeJson(r.raw_excerpt, null),
  };
}

function safeJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 按字段查询。
 * @param {object} opts
 * @param {string} [opts.keyword]  关键词（FTS5 匹配 title/seller）
 * @param {string} [opts.source]   来源站精确匹配
 * @param {string} [opts.since]    仅要 scraped_at >= since（ISO8601）
 * @param {boolean}[opts.onlyPriced] 只要解析出价格的
 * @param {number} [opts.limit]
 */
export function queryProducts(db, opts = {}) {
  const { keyword, source, since, onlyPriced = false, limit = 50 } = opts;
  const where = [];
  const args = [];
  let from = 'products p';

  if (keyword) {
    // FTS5 查询串按「词」拆分并加引号，避免用户输入被当成 FTS 语法。
    const terms = String(keyword)
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, '""')}"`);
    if (terms.length) {
      from = 'products p JOIN products_fts f ON f.product_id = p.product_id';
      where.push('products_fts MATCH ?');
      args.push(terms.join(' AND '));
    }
  }
  if (source) {
    where.push('p.source_site = ?');
    args.push(source);
  }
  if (since) {
    where.push('p.scraped_at >= ?');
    args.push(since);
  }
  if (onlyPriced) where.push("p.price_status = 'parsed'");

  const sql = `SELECT p.* FROM ${from}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.last_seen_at DESC
    LIMIT ?`;
  args.push(Math.max(1, Math.min(500, Number(limit) || 50)));
  return db.prepare(sql).all(...args).map(rowToProduct);
}

/** 库的整体状态：后端据此如实返回「有真实数据 / 空态」。 */
export function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const priced = db.prepare("SELECT COUNT(*) AS n FROM products WHERE price_status='parsed'").get().n;
  const bySource = db.prepare('SELECT source_site, COUNT(*) AS n FROM products GROUP BY source_site ORDER BY n DESC').all();
  const runs = db.prepare('SELECT COUNT(*) AS n FROM collection_runs').get().n;
  const lastOk = db.prepare("SELECT MAX(finished_at) AS t FROM collection_runs WHERE status='ok'").get().t ?? null;
  const lastRun = db
    .prepare('SELECT run_id, finished_at, status, error_code, error_message, source_site, capability FROM collection_runs ORDER BY started_at DESC LIMIT 1')
    .get() ?? null;
  return { total, priced, bySource, runs, lastOkAt: lastOk, lastRun: lastRun ?? null };
}

/** 采集运行清单：报告里「这次抓了几次、每次抓了什么、有没有失败」的来源。 */
export function listRuns(db, limit = 50) {
  return db
    .prepare('SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(200, Number(limit) || 50)))
    .map((r) => ({ ...r, query_params: safeJson(r.query_params, {}) }));
}

// ------------------------------------------------------------------ 商品图片

/**
 * 写入图片（**只接受真实抓取到的原始 URL**）。
 * @param {Array<{url:string,kind?:string,position?:number,alt?:string}>} images
 */
export function addProductImages(db, product_id, images, { capability, scraped_at, run_id }) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO product_images (product_id, url, kind, position, alt, capability, scraped_at, run_id)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  let n = 0;
  images.forEach((img, i) => {
    if (!img || typeof img.url !== 'string' || !/^https:\/\//.test(img.url)) return; // 只收 https 原始图
    stmt.run(product_id, img.url, img.kind ?? 'unknown', img.position ?? i, img.alt ?? null, capability, scraped_at, run_id);
    n += 1;
  });
  return n;
}

export function getProductImages(db, product_id) {
  return db
    .prepare('SELECT url, kind, position, alt, capability, scraped_at FROM product_images WHERE product_id = ? ORDER BY position')
    .all(product_id);
}

/** 把主图回填到 products.image_url（取 kind=main 或位置最靠前的一张）。 */
export function backfillMainImage(db, product_id) {
  const row = db
    .prepare("SELECT url FROM product_images WHERE product_id = ? ORDER BY (kind='main') DESC, position LIMIT 1")
    .get(product_id);
  if (row?.url) db.prepare('UPDATE products SET image_url = ? WHERE product_id = ? AND (image_url IS NULL OR image_url = ?)').run(row.url, product_id, row.url);
  return row?.url ?? null;
}

// ------------------------------------------------------------------ 比价

/**
 * 同一种商品的多条报价比价。
 *
 * 规则：按 same_product_key 分组（见 sameProductKey 的判定说明）；
 * 组内只比较**同币种**的报价（当前只接受 CNY），取页面观察价的**数值最小**者。
 *
 * ⚠️ 口径：返回的是「页面观察价」里最低的那条，**不是**「到手价 / 结算价」。
 * 有券/会员等附加条件的，条件原样保留在 price_conditions 里，不折算进价格。
 *
 * 每条报价都带着**它自己的**图片与链接，因此不会出现「A 的最低价配 B 的图」。
 */
export function compareQuotes(db, { keyword, source, limit = 50 } = {}) {
  const rows = queryProducts(db, { keyword, source, onlyPriced: true, limit: 500 }).filter(
    (p) => p.currency === 'CNY' && p.record_kind === 'product',
  );

  const groups = new Map();
  for (const p of rows) {
    const key = p.same_product_key || sameProductKey(p);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const out = [];
  for (const [same_product_key, quotes] of groups) {
    const sorted = [...quotes].sort((a, b) => Number(a.price_amount) - Number(b.price_amount));
    const winner = sorted[0];
    out.push({
      same_product_key,
      title: winner.title,
      quote_count: sorted.length,
      // 如实标注：只有一条报价时，明说「单一来源，无横向比价」
      price_scope: sorted.length > 1 ? 'multi_quote' : 'single_quote',
      price_scope_note:
        sorted.length > 1
          ? `同一种商品共 ${sorted.length} 条来源报价，这里取页面观察价最低的一条。`
          : '只有一条来源报价，未做横向比价（这是如实标注，不是已比过价）。',
      lowest: toQuote(winner, db),
      quotes: sorted.map((q) => toQuote(q, db)),
      currency: winner.currency,
      price_kind: 'page_observed',
    });
  }
  out.sort((a, b) => Number(a.lowest.price_amount) - Number(b.lowest.price_amount));
  return out.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

function toQuote(p, db) {
  return {
    product_id: p.product_id,
    seller: p.seller,
    price_amount: p.price_amount === null || p.price_amount === undefined ? null : Number(p.price_amount),
    price_text: p.price_text,
    currency: p.currency,
    price_conditions: p.price_conditions,
    price_observed_at: p.price_observed_at,
    product_url: p.product_url, // 来源站原始链接，可追溯
    image_urls: getProductImages(db, p.product_id).map((i) => i.url), // 这条报价自己的图
    source_site: p.source_site,
    capability: p.capability,
    scraped_at: p.scraped_at,
  };
}
