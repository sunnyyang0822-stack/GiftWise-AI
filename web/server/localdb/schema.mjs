/**
 * GiftWise AI · 本地真实抓取库 · 表结构
 *
 * 任务：把 opencli 抓到的商品数据按字段存进本地库，并让后端优先读真实数据。
 *
 * 设计原则（与任务书一致）：
 *   1. 只存「真实抓取到的」字段；抓不到的字段一律为 null/空数组，**不补默认值、不猜测**。
 *   2. 价格是「页面观察价」，不是结算价：price_amount 只做文本→数值的机械转换，
 *      额外条件（如「需用券」）原样进 price_conditions，绝不合并进价格。
 *   3. 任何一行都能追溯到「哪次采集、哪条 opencli 命令、哪个关键词、什么时间」。
 *   4. 不存密钥、不存个人隐私；raw_excerpt 只保留页面可见的商品字段摘要并截断。
 *
 * 字段缺失策略（详见 docs/architecture/真实抓取数据接入本地库-2026-10-31.md）：
 *   - price_amount 为 null：表示该条没有可解析的价格（例如资讯帖），仍入库但
 *     price_status='missing'，后端不得把它当成 0 元或「免费」。
 *   - seller 为 null：来源站没有给出卖家标识（例如 Amazon 搜索页只给 asin）。
 *   - image_url 为 null：当前来源命令不返回图片字段；不伪造占位图。
 *   - currency 为 null：来源没有给出明确币种；此时 price_amount 必须为 null，
 *     避免把未知币种当成人民币。
 */

/** 建表语句。幂等：全部 IF NOT EXISTS。 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 一次采集运行一行，用于回答「这次抓了几次、每次抓了什么、有没有失败」。
CREATE TABLE IF NOT EXISTS collection_runs (
  run_id            TEXT PRIMARY KEY,
  started_at        TEXT NOT NULL,   -- 带时区 ISO8601
  finished_at       TEXT,            -- 带时区 ISO8601；未结束为 null
  source_site       TEXT NOT NULL,   -- 来源站，如 smzdm.com
  capability        TEXT NOT NULL,   -- 能力名（opencli 命令），如 "smzdm search"
  query_params      TEXT NOT NULL,   -- JSON：本次的关键词/预算区间/limit 等
  status            TEXT NOT NULL,   -- ok | empty | failed
  item_count        INTEGER NOT NULL DEFAULT 0,
  error_code        TEXT,            -- 失败时的机器码，如 BROWSER_CONNECT / AUTH_REQUIRED
  error_message     TEXT,            -- 失败时的中文说明
  duration_ms       INTEGER,
  browser_endpoint  TEXT,            -- CDP endpoint（不含任何凭据）
  opencli_version   TEXT
);

-- 商品主表。同一 (source_site, capability, external_id) 只保留最新一次观察结果。
CREATE TABLE IF NOT EXISTS products (
  product_id        TEXT PRIMARY KEY, -- 稳定哈希：sha256(source|capability|external_id)
  external_id       TEXT,             -- 来源站自身的 id（smzdm 文章号 / Amazon asin）
  source_site       TEXT NOT NULL,    -- 来源站
  capability        TEXT NOT NULL,    -- 哪条 opencli 命令抓到的
  scraped_at        TEXT NOT NULL,    -- 抓取时间（带时区）
  record_kind       TEXT NOT NULL DEFAULT 'product', -- product=可购买条目 / article=资讯帖（无价格）
  title             TEXT NOT NULL,    -- 商品标题
  title_norm        TEXT NOT NULL,    -- 归一化标题，用于去重/检索
  price_text        TEXT,             -- 页面原文价格文本，原样保留
  price_amount      TEXT,             -- 价格数值（十进制字符串，单位见 currency）；null=未解析出
  currency          TEXT,             -- 币种；null=来源未给出
  price_status      TEXT NOT NULL,    -- parsed | missing
  price_kind        TEXT NOT NULL DEFAULT 'page_observed', -- 页面观察价，非结算价
  price_observed_at TEXT,             -- 价格观察时间（带时区）
  price_conditions  TEXT NOT NULL DEFAULT '[]', -- JSON 数组，如 ["需用券"]
  seller            TEXT,             -- 卖家/店铺标识
  product_url       TEXT NOT NULL,    -- 商品链接（来源站原始链接，必须可追溯）
  image_url         TEXT,             -- 主图原始 URL（真实商品图；来源不给则 null，绝不用生成图顶替）
  same_product_key  TEXT NOT NULL DEFAULT '', -- 「同一种商品」判定键，见 docs（用于多条报价比价）
  raw_excerpt       TEXT NOT NULL,    -- JSON：原始响应字段摘要（已裁剪、已脱敏）
  query_params      TEXT NOT NULL,    -- JSON：抓这条时的查询参数
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  run_id            TEXT NOT NULL REFERENCES collection_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_products_source   ON products(source_site);
CREATE INDEX IF NOT EXISTS idx_products_scraped  ON products(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_capab    ON products(capability);
CREATE INDEX IF NOT EXISTS idx_products_price    ON products(currency, price_amount);

-- 商品图片：一行一个**原始**图片 URL。
-- 🔴 硬性要求：只存 opencli 真实抓到的图片 URL（主图/SKU 图/详情图，能分就分）；
--    绝不写入生成图（Seedream 等）的地址，也不写本地代理路径冒充来源。
CREATE TABLE IF NOT EXISTS product_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    TEXT NOT NULL REFERENCES products(product_id),
  url           TEXT NOT NULL,       -- 原始图片 URL（来源站 CDN）
  kind          TEXT NOT NULL,       -- main=主图 / sku=SKU图 / detail=详情图 / unknown=来源未区分
  position      INTEGER NOT NULL DEFAULT 0,
  alt           TEXT,                -- 页面里的 alt 文本，用于判断这张图属于哪个商品
  capability    TEXT NOT NULL,       -- 哪条 opencli 命令拿到的
  scraped_at    TEXT NOT NULL,       -- 抓取时间（带时区）
  run_id        TEXT NOT NULL,
  UNIQUE(product_id, url)
);
CREATE INDEX IF NOT EXISTS idx_images_product ON product_images(product_id, position);

-- 价格观察历史：append-only。同一商品每次抓到都追加一行，便于看价格变化。
CREATE TABLE IF NOT EXISTS price_observations (
  observation_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        TEXT NOT NULL REFERENCES products(product_id),
  observed_at       TEXT NOT NULL,
  price_text        TEXT,
  price_amount      TEXT,
  currency          TEXT,
  price_status      TEXT NOT NULL,
  price_conditions  TEXT NOT NULL DEFAULT '[]',
  run_id            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_product ON price_observations(product_id, observed_at DESC);

-- 关键词检索：FTS5 虚表，与应用表手动同步（见 db.mjs upsertProduct）。
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  product_id UNINDEXED,
  title,
  seller,
  tokenize = 'unicode61'
);
`;

/** 给文档和校验用的字段清单（单一事实来源）。 */
export const PRODUCT_FIELDS = Object.freeze([
  { name: 'product_id', desc: '稳定主键：sha256(source_site|capability|external_id) 前 32 位十六进制' },
  { name: 'external_id', desc: '来源站自身 id（smzdm 文章号、Amazon asin）；缺失策略：来源未给出则 null' },
  { name: 'source_site', desc: '来源站域名标识，如 smzdm.com / amazon.com' },
  { name: 'capability', desc: '能力名，即实际执行的 opencli 命令，如 "smzdm search"' },
  { name: 'scraped_at', desc: '抓取时间，带时区 ISO8601' },
  { name: 'record_kind', desc: "product=可购买条目 / article=资讯帖（来源站把资讯与商品混排，如实区分，不把资讯当商品）" },
  { name: 'title', desc: '商品标题（页面原文）' },
  { name: 'price_text', desc: '页面原文价格文本；缺失策略：保留 null，不造价格' },
  { name: 'price_amount', desc: '价格数值（十进制字符串）；null 表示未解析出，禁止当作 0' },
  { name: 'currency', desc: '币种；null 表示来源未给出，此时 price_amount 必须为 null' },
  { name: 'price_status', desc: 'parsed | missing' },
  { name: 'price_kind', desc: '固定 page_observed：页面观察价，不是结算价' },
  { name: 'price_observed_at', desc: '价格观察时间，带时区 ISO8601' },
  { name: 'price_conditions', desc: 'JSON 数组，价格附加条件（如 ["需用券"]）；无则为 []' },
  { name: 'seller', desc: '卖家/店铺标识；来源未给出则 null' },
  { name: 'product_url', desc: '商品链接（来源站原始链接，必须可追溯；不存本地代理路径冒充来源）' },
  { name: 'image_url', desc: '主图原始 URL（真实抓取的图片）；来源不给则为 null，绝不用生成图或占位图顶替' },
  { name: 'same_product_key', desc: '「同一种商品」判定键：归一化标题 + 主图指纹；用于把多条报价归到同一个商品下比价' },
  { name: 'raw_excerpt', desc: '原始响应字段摘要（JSON，已裁剪、无密钥无隐私）' },
  { name: 'query_params', desc: '抓取时的查询参数（JSON：关键词、预算区间、limit 等）' },
  { name: 'first_seen_at', desc: '首次见到该商品的时间' },
  { name: 'last_seen_at', desc: '最近一次见到该商品的时间' },
  { name: 'run_id', desc: '外键指向 collection_runs，可追溯本次采集' },
]);
