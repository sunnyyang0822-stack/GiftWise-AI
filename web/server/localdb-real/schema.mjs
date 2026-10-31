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
  product_url       TEXT NOT NULL,    -- 商品链接（来源站原始链接，必须可追溯；**每条都必须非空**）
  image_url         TEXT,             -- 主图原始 URL（真实商品图；来源不给则 null，绝不用生成图顶替）
  same_product_key  TEXT NOT NULL DEFAULT '', -- 「同一种商品」判定键，见 docs（用于多条报价比价）

  -- ---- 配送 / 预售（产品负责人追加）----
  -- 🔴 一律「页面上有原文就存原文，没有就 null」。**绝不允许**用「全国包邮 2-3 天」
  --    这类通用话术填空，也不允许拿别的商品的配送信息来凑。
  seller_location_text TEXT,          -- 卖家所在地 / 发货地原文（如「江苏 苏州」）
  shipping_time_text   TEXT,          -- 配送时效原文（如「预计 3-5 天送达」）
  ships_within_text    TEXT,          -- 发货时效原文（如「48 小时内发货」）
  ships_within_days    INTEGER,       -- ⭐ 发货时效解析出的**天数**（正整数；解析不出=null）
  ships_within_day_type TEXT,         -- business=工作日 / calendar=自然日（两者不混算）
  is_preorder          INTEGER,       -- 是否预售：1=是 / 0=否 / **NULL=无法判定（不默认 false）**
  presale_text         TEXT,          -- 预售相关原文（如「预售 15 天内发货」）
  presale_days         INTEGER,       -- ⭐⭐ 预售时长解析出的**天数**（正整数；解析不出=null）
  presale_day_type     TEXT,          -- business=工作日 / calendar=自然日
  fulfillment_evidence TEXT,          -- JSON：判定依据（命中的原文片段 + 解析过程），供复核追溯

  -- ---- 图片来源等级（产品负责人追加：URL 拿不到时用页面截图兜底）----
  -- 🔴 截图 ≠ 商品原图，只是「来源展示」用的兜底，必须能追溯、必须如实标注。
  image_kind           TEXT,          -- product_image=真实商品图URL / page_screenshot=页面截图兜底 / null=都没有
  image_degraded_reason TEXT,         -- 两级都没拿到时的明确原因码（如 SCREENSHOT_BROWSER_UNAVAILABLE）
  screenshot_id        TEXT,          -- 指向 page_screenshots.id（用截图兜底时才有）

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

-- 页面截图兜底（仅在**真实商品图 URL 拿不到/取图失败**时使用）。
-- 🔴 截图 ≠ 商品原图；这里只存事实与可追溯信息，且**永不**作为生图模型的参考输入。
CREATE TABLE IF NOT EXISTS page_screenshots (
  id               TEXT PRIMARY KEY,   -- sha256(source_page_url + captured_at) 前 24 位
  source_page_url  TEXT NOT NULL,      -- **必填**：截的是哪个页面
  file_path        TEXT NOT NULL,      -- 截图文件落盘路径
  sha256           TEXT NOT NULL,      -- 文件内容哈希（防篡改/去重）
  bytes            INTEGER NOT NULL,   -- 字节数
  width            INTEGER,            -- 像素宽（从 PNG 头解析；解析不出=null）
  height           INTEGER,            -- 像素高
  captured_at      TEXT NOT NULL,      -- 截图时间（带时区）
  capability       TEXT NOT NULL,      -- 哪条 opencli 命令（browser screenshot）
  frames_probe     TEXT,               -- browser frames 的结果摘要（JSON），用于排查跨域 iframe
  run_id           TEXT,
  UNIQUE(source_page_url, sha256)
);

-- 商品图片：一行一个**原始**图片 URL。-- 🔴 硬性要求：只存 opencli 真实抓到的图片 URL（主图/SKU 图/详情图，能分就分）；
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
  { name: 'seller_location_text', desc: '卖家所在地/发货地原文；页面没有则 null（不许用通用话术填）' },
  { name: 'shipping_time_text', desc: '配送时效原文（如「预计 3-5 天送达」）；页面没有则 null' },
  { name: 'ships_within_text', desc: '发货时效原文（如「48 小时内发货」）；页面没有则 null' },
  { name: 'ships_within_days', desc: '发货时效解析出的天数（正整数；范围取上界；48 小时=2 天）；解析不出=null' },
  { name: 'ships_within_day_type', desc: '工作日(business) / 自然日(calendar)，两者不混算' },
  { name: 'is_preorder', desc: '是否预售：true/false/**null=无法判定**；只有明确依据才给 true/false，绝不默认 false' },
  { name: 'presale_text', desc: '预售相关原文；页面没有则 null' },
  { name: 'presale_days', desc: '⭐ 预售时长解析出的天数（正整数；范围取上界）；解析不出=null，绝不猜' },
  { name: 'presale_day_type', desc: '工作日(business) / 自然日(calendar)' },
  { name: 'fulfillment_evidence', desc: '配送/预售判定的依据（命中的原文片段 + 解析过程），供复核追溯' },
  { name: 'raw_excerpt', desc: '原始响应字段摘要（JSON，已裁剪、无密钥无隐私）' },
  { name: 'query_params', desc: '抓取时的查询参数（JSON：关键词、预算区间、limit 等）' },
  { name: 'first_seen_at', desc: '首次见到该商品的时间' },
  { name: 'last_seen_at', desc: '最近一次见到该商品的时间' },
  { name: 'run_id', desc: '外键指向 collection_runs，可追溯本次采集' },
]);
