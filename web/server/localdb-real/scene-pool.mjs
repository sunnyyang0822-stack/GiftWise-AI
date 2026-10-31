/**
 * GiftWise AI · 场景兜底图池 · 只读查询层
 *
 * 背景：真实商品图是**靠抓取**拿到的（见 db.mjs / product_images）。抓不到时，
 *      以前只能显示无图。本模块提供「AI 生成的场景示意图」兜底池的**读**入口。
 *
 * 🔴 本模块的边界（刻意划死，别越过）：
 *   1. **只读**。除了建表（IF NOT EXISTS），不写任何数据；写库只发生在生成脚本
 *      `tools/scene-pool/generate-scene-pool.mjs` 里。
 *   2. 本池里的图**全部是 AI 生成的**，不是商品实物图。对外返回结构必须带
 *      `kind: "generated_scene"` 与 `disclaimer: "AI 生成的场景示意图（非商品实物）"`，
 *      **绝不能被当成真实商品图展示**。调用方接入时必须把这个标识透传到前端。
 *   3. 查不到就返回 **null**，不返回占位图、不返回固定假数据、不用别的图顶替。
 *   4. 不联网：本模块不做任何网络请求（HTTP 服务由调用方挂，见 serveSceneAsset）。
 *   5. 不接 pipeline：按任务要求，本模块只提供函数与契约，集成由 PM 做。
 *
 * 与真实商品图的关系（重要，别搞混）：
 *   - `products.image_url` / `product_images.url` = 抓到的**真实商品图**（来源站 CDN）。
 *   - `scene_images`（本模块）= **AI 生成的场景示意图**，只在真实商品图缺失时兜底。
 *   两者绝不能互换、绝不互相顶替。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

import { openDb, defaultDbPath, REPO_ROOT } from './db.mjs';
import {
  PALETTES,
  PALETTE_LABELS_ZH,
  SCENE_POOL_CATALOG,
  SCENE_POOL_GENERATED_EXPECTED_COUNT,
  SCENE_POOL_DELIVERED_IDS,
  SCENE_POOL_DELIVERED_EXPECTED_COUNT,
  isDelivered,
  deliveredCatalog,
  extraCatalog,
  assertDeliveryScopeConsistent,
  parseSceneId,
} from './scene-pool-catalog.mjs';

export {
  PALETTES,
  PALETTE_LABELS_ZH,
  SCENE_POOL_CATALOG,
  SCENE_POOL_GENERATED_EXPECTED_COUNT,
  SCENE_POOL_DELIVERED_IDS,
  SCENE_POOL_DELIVERED_EXPECTED_COUNT,
  isDelivered,
  deliveredCatalog,
  extraCatalog,
  assertDeliveryScopeConsistent,
  parseSceneId,
};

// ------------------------------------------------------------------ 对外契约常量

/**
 * 对外身份标识：**一个都不能少**。
 * 任何从本模块流出的图片元数据都必须带这个 kind，前端据此展示「示意图」角标。
 */
export const SCENE_KIND = 'generated_scene';

/** 中文免责说明：必须原样透传给用户，不许删改、不许只留英文。 */
export const SCENE_POOL_DISCLAIMER_ZH = 'AI 生成的场景示意图（非商品实物）';

/** 资产路由前缀。与既有 `/api/media/assets/<sha256>` 保持同一套 64 位十六进制风格。 */
export const SCENE_ASSET_ROUTE_PREFIX = '/api/scene-pool/assets/';

/** scene_images 的表结构（幂等）。建表语句是唯一事实来源，生成脚本与本模块共用。 */
export const SCENE_POOL_SCHEMA_SQL = `
-- AI 生成的场景示意图池。一行 = 一张已经落盘且已校验的生成图。
--
-- 🔴 与 product_images 的区别：product_images 存**抓取到的真实商品图 URL**；
--    本表存**AI 生成的本地图片文件**（file_path + sha256）。两表不得混用。
--
-- 字段缺失策略：
--   palette 为 NULL：type 类（礼物类型）没有色调版本，如实为 NULL，不补 'mono'。
--   actual_model 为 NULL：生图响应没给出 actual model 时如实为 NULL，不拿请求模型冒充。
--   usage_json 恒为 JSON 对象：HTTP 状态 / 耗时 / usage 原样记账，解析不了就是 {}。
-- 💡 本表所有行 generated 恒为 1：本池**只允许**放 AI 生成图，不许塞真实抓拍图。
--
-- ⚠️ 交付口径（30 张）**故意不落在本表的列上**：本模块是只读的，运行期不写库。
--    交付范围由 scene-pool-catalog.mjs 的 SCENE_POOL_DELIVERED_IDS（冻结 30 条）决定，
--    查询时按它过滤（见 resolveSceneImage 的 includeExtras 参数）。
--    所以：**表里有 50 行 = 实际生成 50 张**；**pickSceneImage 默认只服务其中 30 张 = 交付 30 张**。
--    多出来的 20 行与文件都保留，不删、不降质。
CREATE TABLE IF NOT EXISTS scene_images (
  scene_id        TEXT PRIMARY KEY,        -- 稳定主键，如 type-scented-candle / scene-workshop-mono
  label           TEXT NOT NULL,           -- 中文展示名
  category        TEXT NOT NULL,           -- type=礼物类型 | scene=礼物场景
  palette         TEXT,                    -- mono | warm | cool；type 类为 NULL
  generated       INTEGER NOT NULL DEFAULT 1, -- 恒为 1：AI 生成
  generation_kind TEXT NOT NULL DEFAULT 'generated_scene', -- 对外 kind 的来源
  prompt          TEXT NOT NULL,           -- 原始提示词（原样保存，便于复现）
  model           TEXT NOT NULL,           -- 请求时指定的模型
  actual_model    TEXT,                    -- 响应回传的真实模型；未回传则 NULL
  file_path       TEXT NOT NULL,           -- 相对仓库根的文件路径（可移植）
  mime            TEXT NOT NULL,           -- image/png | image/jpeg
  sha256          TEXT NOT NULL,           -- 文件内容的 sha256（也是资产路由 id）
  bytes           INTEGER NOT NULL,        -- 文件字节数（必须 > 0）
  width           INTEGER NOT NULL,
  height          INTEGER NOT NULL,
  created_at      TEXT NOT NULL,           -- 带时区 ISO8601
  usage_json      TEXT NOT NULL DEFAULT '{}', -- 逐张记账：HTTP/耗时/usage/重试次数
  attempt_count   INTEGER NOT NULL DEFAULT 1,
  http_status     INTEGER,
  elapsed_ms      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_scene_images_lookup ON scene_images(category, palette);
CREATE INDEX IF NOT EXISTS idx_scene_images_sha ON scene_images(sha256);
`;

/** 幂等建表。读之前调用一次即可。 */
export function ensureScenePool(db) {
  db.exec(SCENE_POOL_SCHEMA_SQL);
  return db;
}

// ------------------------------------------------------------------ 打开与收尾

/**
 * 打开库并确保 scene_images 存在。
 * 读库是一次性的：用完请调用方 close（或直接用下面的 xxx(opts) 包装，它自己关）。
 */
export function openScenePool(dbPath = defaultDbPath()) {
  return ensureScenePool(openDb(dbPath));
}

function closeQuietly(db) {
  try {
    db.close();
  } catch {
    /* 已经关了就算了 */
  }
}

/** 库里存的是相对路径；这里还原成绝对路径。 */
export function absoluteFilePath(filePath) {
  return isAbsolute(filePath) ? filePath : join(REPO_ROOT, filePath);
}

// ------------------------------------------------------------------ token 归一

/** 把用户给的场景名归一化：大小写、全角斜杠、空白、中点都不影响匹配。 */
export function normalizeSceneToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[／]/g, '/')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・]/g, '');
}

/** 归一化 token -> scene_id。词条自身的 id / 中文 label / aliases 都收。 */
const TOKEN_INDEX = (() => {
  const map = new Map();
  const put = (token, sceneId) => {
    const key = normalizeSceneToken(token);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(sceneId)) map.get(key).push(sceneId);
  };
  for (const e of SCENE_POOL_CATALOG) {
    put(e.scene_id, e.scene_id);
    put(e.label, e.scene_id);
    // 允许只写 slug（scented-candle / workshop），不带 type-/scene- 前缀。
    const parsed = parseSceneId(e.scene_id);
    if (parsed) put(parsed.slug, e.scene_id);
    for (const a of e.aliases) put(a, e.scene_id);
    // 「体验课/手作工作坊」也允许写成「手作工作坊/体验课」这类顺序，收单个词片段。
    for (const a of [e.label, ...e.aliases]) {
      for (const part of String(a).split('/')) put(part, e.scene_id);
    }
  }
  return map;
})();

/** 把 token 解析成候选词条列表（可能命中多个：例如「体验课」会命中该场景的 3 个色调）。 */
export function candidatesForScene(scene) {
  const ids = TOKEN_INDEX.get(normalizeSceneToken(scene));
  if (!ids) return [];
  return ids.map((id) => SCENE_POOL_CATALOG.find((e) => e.scene_id === id)).filter(Boolean);
}

// ------------------------------------------------------------------ 出参组装

function safeJson(text, fallback = {}) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function rowToRecord(r) {
  return {
    ...r,
    palette: r.palette ?? null,
    generated: Boolean(r.generated),
    actual_model: r.actual_model ?? null,
    usage: safeJson(r.usage_json, {}),
  };
}

/**
 * 把库里的行组装成**对外**结构。
 *
 * 🔴 契约（前端/后端集成时按这个来）：
 *   kind            恒为 "generated_scene" —— 用来和真实商品图区分
 *   disclaimer      恒为 "AI 生成的场景示意图（非商品实物）"
 *   is_real_photo   恒为 false —— 明确不是实物图
 *   image_url       可直接放 <img src>；本地服务挂上 serveSceneAsset 后即可取到图像字节
 *   image_bytes     当前文件实际字节数（每次读盘核对，不是库里的旧值）
 *   image_sha256    当前文件实际 sha256（用于确认返回的确实是被记账的那张图）
 */
export function toPublicSceneImage(row, { checkFile = true } = {}) {
  const rec = rowToRecord(row);
  const abs = absoluteFilePath(rec.file_path);
  let filePresent = false;
  let realBytes = null;
  if (checkFile) {
    try {
      const st = statSync(abs);
      filePresent = st.isFile() && st.size > 0;
      realBytes = st.size;
    } catch {
      filePresent = false;
    }
  } else {
    filePresent = existsSync(abs);
  }

  return {
    // ---- 身份与免责：三项缺一不可 ----
    kind: SCENE_KIND,
    disclaimer: SCENE_POOL_DISCLAIMER_ZH,
    is_real_photo: false,
    is_generated: true,
    not_a_product_photo_notice:
      '这是 AI 生成的场景示意图，不是商品实物图，不能作为商品外观、材质、规格的依据。',

    // ---- 词条身份 ----
    scene_id: rec.scene_id,
    label: rec.label,
    category: rec.category,
    palette: rec.palette,
    palette_label: rec.palette ? (PALETTE_LABELS_ZH[rec.palette] ?? null) : null,
    generated: true,
    // 交付范围：true=在交付的 30 张里；false=已生成但不交付的额外产物（保留不删）
    in_delivery_scope: isDelivered(rec.scene_id),

    // ---- 生成可追溯 ----
    prompt: rec.prompt,
    model: rec.model,
    actual_model: rec.actual_model,
    created_at: rec.created_at,
    usage: rec.usage,
    attempt_count: rec.attempt_count,
    http_status: rec.http_status,
    elapsed_ms: rec.elapsed_ms,

    // ---- 图上哪去取 ----
    file_path: rec.file_path,
    file_absolute_path: abs,
    file_present: filePresent,
    asset_route: `${SCENE_ASSET_ROUTE_PREFIX}${rec.sha256}`,
    image_url: `${SCENE_ASSET_ROUTE_PREFIX}${rec.sha256}`,
    asset_id: rec.sha256,

    // ---- 内容指纹 ----
    sha256: rec.sha256,
    bytes: realBytes ?? rec.bytes, // 文件实际字节数（读不到文件时回落到库中记账值）
    db_bytes: rec.bytes,
    file_bytes: realBytes,
    width: rec.width,
    height: rec.height,
    mime: rec.mime,
  };
}

// ------------------------------------------------------------------ 主查询

/**
 * 带诊断的查询：永远返回结构体，null 命中时也说明**为什么**没命中。
 * 想严格要 null 语义的用 pickSceneImage()。
 *
 * 🔴 交付口径：默认**只在交付的 30 张里找**（产品裁定 2026-10-31）。
 *    库里另有 20 张已生成但不交付的额外产物；要连它们一起找，传 `includeExtras: true`。
 *
 * @param {object} opts
 * @param {string} opts.scene            场景/类型 token（scene_id、中文名或其别名）
 * @param {string} [opts.palette]        色调 mono|warm|cool（type 类忽略）
 * @param {string[]} [opts.excludePalettes] 要排除的色调（用户已看过暖色就排掉暖色）
 * @param {string} [opts.dbPath]         库路径，默认 .local-db/giftwise.sqlite
 * @param {boolean}[opts.requireFile]    true=文件不存在就当没命中（默认 false，但仍如实报 file_present）
 * @param {boolean}[opts.includeExtras]  true=连交付范围外的额外产物一起找（默认 false，即只交付 30 张）
 */
export function resolveSceneImage(opts = {}) {
  const {
    scene,
    palette,
    excludePalettes = [],
    dbPath = defaultDbPath(),
    requireFile = false,
    includeExtras = false,
  } = opts;

  const miss = (reason_code, reason) => ({
    hit: false,
    image: null,
    kind: SCENE_KIND,
    disclaimer: SCENE_POOL_DISCLAIMER_ZH,
    reason_code,
    reason,
  });

  const candidates = candidatesForScene(scene);
  if (!candidates.length) {
    return miss(
      'SCENE_NOT_IN_POOL',
      `场景兜底图池里没有「${scene}」这个词条。本池交付 ${SCENE_POOL_DELIVERED_EXPECTED_COUNT} 张：` +
        '12 个礼物类型 + 6 个场景 × 3 种色调；' +
        '不在池内就如实返回 null，不用别的图顶替。',
    );
  }

  // 交付口径过滤：默认只认交付清单里的 30 条。
  const inScope = includeExtras ? candidates : candidates.filter((c) => isDelivered(c.scene_id));
  if (!inScope.length) {
    return miss(
      'SCENE_OUT_OF_DELIVERY_SCOPE',
      `「${scene}」这个词条**已经生成**，但不在交付的 ${SCENE_POOL_DELIVERED_EXPECTED_COUNT} 张清单里` +
        '（属于保留不交付的额外产物）。默认如实返回 null；如需取用请显式传 includeExtras: true。',
    );
  }

  const wantPalette = palette === undefined || palette === null || palette === '' ? null : String(palette).trim().toLowerCase();
  if (wantPalette && !PALETTES.includes(wantPalette)) {
    return miss(
      'PALETTE_INVALID',
      `色调「${palette}」不在本池支持的三种里（${PALETTES.join(' / ')}），如实返回 null。`,
    );
  }

  const category = inScope[0].category;
  let pool = inScope;
  let paletteFallback = false;
  let paletteIgnored = false;

  if (category === 'scene') {
    const excluded = new Set((Array.isArray(excludePalettes) ? excludePalettes : []).map((p) => String(p).trim().toLowerCase()));
    const usable = inScope.filter((c) => !excluded.has(c.palette));
    if (!usable.length) {
      return miss(
        'ALL_PALETTES_EXCLUDED',
        `「${scene}」的三种色调都被 excludePalettes 排除了（${[...excluded].join(' / ')}），没有可用的兜底图，如实返回 null。`,
      );
    }
    if (wantPalette) {
      const exact = usable.filter((c) => c.palette === wantPalette);
      if (!exact.length) {
        return miss(
          'PALETTE_EXCLUDED',
          `「${scene}」的 ${wantPalette} 色调版本被 excludePalettes 排除了，如实返回 null（不拿别的色调顶替）。`,
        );
      }
      pool = exact;
    } else {
      // 没指定色调：给一个确定的默认（warm），但**如实标注**这是兜底选择，不是用户指定的。
      const warm = usable.find((c) => c.palette === 'warm');
      pool = warm ? [warm] : [usable[0]];
      paletteFallback = true;
    }
  } else {
    // type 类：本身就只有一张，没有色调维度。
    if (wantPalette) paletteIgnored = true;
  }

  const db = openScenePool(dbPath);
  try {
    let row = null;
    for (const c of pool) {
      row = db.prepare('SELECT * FROM scene_images WHERE scene_id = ?').get(c.scene_id) ?? null;
      if (row) break;
    }
    if (!row) {
      return miss(
        'ENTRY_NOT_GENERATED',
        `图池里定义了「${scene}」这个词条（共 ${pool.length} 个候选），但库里没有对应记录：` +
          '说明这一张还没生成成功或还没入库。如实返回 null，不用别的图顶替。',
      );
    }
    const image = toPublicSceneImage(row);
    if (requireFile && !image.file_present) {
      return miss(
        'ASSET_FILE_MISSING',
        `库里记账的是 ${image.file_path}，但该文件不在磁盘上（byte 数对不上/已删除）。如实返回 null。`,
      );
    }
    return {
      hit: true,
      image,
      kind: SCENE_KIND,
      disclaimer: SCENE_POOL_DISCLAIMER_ZH,
      reason_code: null,
      reason: null,
      palette_fallback: paletteFallback,
      palette_ignored: paletteIgnored,
      note: paletteFallback
        ? `调用方没有指定色调，这里返回「${image.palette_label}」版本作为默认兜底（这是本函数选的，不是用户偏好）。`
        : null,
    };
  } finally {
    closeQuietly(db);
  }
}

/**
 * 任务书要求的签名：命中返回元数据，**无命中返回 null**。
 *
 * @returns {object|null} 命中时含 kind:"generated_scene" 与中文免责说明的元数据；否则 null
 */
export function pickSceneImage(opts = {}) {
  const r = resolveSceneImage(opts);
  return r.hit ? r.image : null;
}

// ------------------------------------------------------------------ 其他只读查询

/**
 * 列出池子里的行（只读，给管理页/自检用）。
 * @param {object} opts
 * @param {'delivered'|'extra'|'all'} [opts.deliveryScope] 默认 'all'（连额外产物一起列，便于自检「没丢东西」）
 */
export function listSceneImages({ dbPath = defaultDbPath(), category, palette, deliveryScope = 'all', limit = 200 } = {}) {
  const db = openScenePool(dbPath);
  try {
    const where = [];
    const args = [];
    if (category) {
      where.push('category = ?');
      args.push(category);
    }
    if (palette) {
      where.push('palette = ?');
      args.push(palette);
    }
    if (deliveryScope === 'delivered') {
      where.push(`scene_id IN (${SCENE_POOL_DELIVERED_IDS.map(() => '?').join(',')})`);
      args.push(...SCENE_POOL_DELIVERED_IDS);
    } else if (deliveryScope === 'extra') {
      where.push(`scene_id NOT IN (${SCENE_POOL_DELIVERED_IDS.map(() => '?').join(',')})`);
      args.push(...SCENE_POOL_DELIVERED_IDS);
    }
    args.push(Math.max(1, Math.min(500, Number(limit) || 200)));
    return db
      .prepare(`SELECT * FROM scene_images ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scene_id LIMIT ?`)
      .all(...args)
      .map(rowToRecord);
  } finally {
    closeQuietly(db);
  }
}

/**
 * 池子状态：**两个口径分开报**，不许混成一个数。
 *   generated_*  = 实际生成口径（本次 50）
 *   delivered_*  = 交付口径（产品裁定 30）
 *   extra_*      = 已生成但不交付、保留不删的部分（本次 20）
 */
export function scenePoolStats({ dbPath = defaultDbPath() } = {}) {
  let db;
  try {
    db = openScenePool(dbPath);
  } catch (err) {
    return {
      db_path: dbPath,
      readable: false,
      total: 0,
      reason_code: 'DB_UNREADABLE',
      reason: `本地库无法打开（${dbPath}）：${err.message}`,
      generated_expected: SCENE_POOL_GENERATED_EXPECTED_COUNT,
      delivered_expected: SCENE_POOL_DELIVERED_EXPECTED_COUNT,
    };
  }
  try {
    const rows = db.prepare('SELECT * FROM scene_images ORDER BY scene_id').all().map(rowToRecord);
    const files = rows.map((r) => {
      const abs = absoluteFilePath(r.file_path);
      try {
        const st = statSync(abs);
        return { scene_id: r.scene_id, file_path: r.file_path, present: st.isFile() && st.size > 0, disk_bytes: st.size, db_bytes: r.bytes };
      } catch {
        return { scene_id: r.scene_id, file_path: r.file_path, present: false, disk_bytes: null, db_bytes: r.bytes };
      }
    });
    const byCategory = {};
    const byPalette = {};
    for (const r of rows) {
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
      const p = r.palette ?? '(none)';
      byPalette[p] = (byPalette[p] ?? 0) + 1;
    }
    const deliveredRows = rows.filter((r) => isDelivered(r.scene_id));
    const missingDelivered = SCENE_POOL_DELIVERED_IDS.filter((id) => !deliveredRows.some((r) => r.scene_id === id));
    return {
      db_path: dbPath,
      readable: true,
      kind: SCENE_KIND,
      disclaimer: SCENE_POOL_DISCLAIMER_ZH,

      // ---- 实际生成口径 ----
      generated_expected: SCENE_POOL_GENERATED_EXPECTED_COUNT,
      total: rows.length,
      generated_complete: rows.length === SCENE_POOL_GENERATED_EXPECTED_COUNT,
      by_category: byCategory,
      by_palette: byPalette,
      files_present: files.filter((f) => f.present).length,
      files_missing: files.filter((f) => !f.present).map((f) => f.scene_id),
      disk_bytes_total: files.reduce((s, f) => s + (f.disk_bytes ?? 0), 0),

      // ---- 交付口径（产品裁定 30） ----
      delivered_expected: SCENE_POOL_DELIVERED_EXPECTED_COUNT,
      delivered: deliveredRows.length,
      delivered_complete: deliveredRows.length === SCENE_POOL_DELIVERED_EXPECTED_COUNT,
      delivered_missing: missingDelivered,

      // ---- 额外产物（保留不删） ----
      extra: rows.length - deliveredRows.length,
      extra_ids: rows.filter((r) => !isDelivered(r.scene_id)).map((r) => r.scene_id),
    };
  } finally {
    closeQuietly(db);
  }
}

// ------------------------------------------------------------------ 启动自检

/** 库被清空后的恢复命令（与 tools/scene-pool/generate-scene-pool.mjs 里的常量保持一致）。 */
export const SCENE_POOL_RECOVERY_COMMAND = 'node tools/scene-pool/generate-scene-pool.mjs --reimport-from-ledger';

/**
 * 启动自检：识别「本地库被别的进程重建/清空」。
 *
 * 🔴 背景：`.local-db/giftwise.sqlite` 是**多个 agent 共享**的文件，被重建过一次
 *    （2026-10-31 19:59），`scene_images` 的 50 行全没了，但图片与账本都还在。
 *    这里只做**检测与提示**，**绝不自动重建** —— 自动写库可能覆盖别的 agent 正在写的数据，
 *    由人或上层显式执行恢复命令。
 *
 * 典型症状：`scene_images` 行数为 0，但磁盘上的图片文件仍在。
 *
 * @returns {{
 *   status: 'ok'|'wiped'|'empty'|'unreadable',
 *   db_rows: number, files_present: number, expected: number,
 *   needs_recovery: boolean, recovery_command: string|null,
 *   message: string|null
 * }}
 *
 * 用法（集成时在 server 启动处调用一次即可；本模块**不自动挂**）：
 *   const h = detectWipedPool();
 *   if (h.needs_recovery) console.warn(h.message);
 */
export function detectWipedPool({ dbPath = defaultDbPath(), imageDir = null } = {}) {
  const dir = imageDir ?? join(REPO_ROOT, '.local-db', 'scene-pool', 'images');
  let filesPresent = 0;
  try {
    filesPresent = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).length;
  } catch {
    filesPresent = 0;
  }

  let dbRows = 0;
  let unreadable = false;
  try {
    const db = openScenePool(dbPath);
    try {
      dbRows = db.prepare('SELECT COUNT(*) AS n FROM scene_images').get().n;
    } finally {
      closeQuietly(db);
    }
  } catch {
    unreadable = true;
  }

  const base = {
    db_path: dbPath,
    image_dir: dir,
    db_rows: dbRows,
    files_present: filesPresent,
    expected: SCENE_POOL_GENERATED_EXPECTED_COUNT,
    ledger_present: existsSync(join(REPO_ROOT, '.local-db', 'scene-pool', 'ledger.jsonl')),
  };

  if (unreadable) {
    return {
      ...base,
      status: 'unreadable',
      needs_recovery: false,
      recovery_command: null,
      message: `本地库无法打开（${dbPath}），无法判断场景兜底图池状态。`,
    };
  }
  if (dbRows === 0 && filesPresent > 0) {
    return {
      ...base,
      status: 'wiped',
      needs_recovery: true,
      recovery_command: SCENE_POOL_RECOVERY_COMMAND,
      message:
        `⚠️  scene_images 一行都没有，但磁盘上还有 ${filesPresent} 张图片 —— ` +
        `本地库很可能被别的进程重建/清空过（本库是多 agent 共享文件）。\n` +
        `    图片和账本都还在，**不需要重新出图、不会再花钱**。\n` +
        `    恢复方式（不调用生图 API）：\n` +
        `        ${SCENE_POOL_RECOVERY_COMMAND}\n` +
        `    （本模块不会自动重建，避免覆盖别的 agent 正在写的库。）`,
    };
  }
  if (dbRows === 0) {
    return {
      ...base,
      status: 'empty',
      needs_recovery: false,
      recovery_command: filesPresent > 0 ? SCENE_POOL_RECOVERY_COMMAND : null,
      message:
        `场景兜底图池还没有数据（scene_images 为空，磁盘上也没有图片）。` +
        `首次生成请执行：node tools/scene-pool/generate-scene-pool.mjs`,
    };
  }
  return {
    ...base,
    status: 'ok',
    needs_recovery: false,
    recovery_command: null,
    message: null,
  };
}

// ------------------------------------------------------------------ 资产读取

/**
 * 按 sha256（资产 id）或 scene_id 读图片字节。
 *
 * 返回 null 的情况：库里没这条记录 / 文件不在盘上 / 文件为空 / sha256 与库中记账不符。
 * 校验 sha256 是**故意**的：保证「路由上的 id」和「实际吐出的字节」是同一张图，防止串图。
 */
export function readSceneAsset({ assetId, sceneId, dbPath = defaultDbPath(), verifySha = true } = {}) {
  const db = openScenePool(dbPath);
  try {
    const row = assetId
      ? db.prepare('SELECT * FROM scene_images WHERE sha256 = ?').get(String(assetId))
      : db.prepare('SELECT * FROM scene_images WHERE scene_id = ?').get(String(sceneId));
    if (!row) return null;
    const rec = rowToRecord(row);
    const abs = absoluteFilePath(rec.file_path);
    let bytes;
    try {
      bytes = readFileSync(abs);
    } catch {
      return null;
    }
    if (!bytes.length) return null;
    if (verifySha) {
      if (createHash('sha256').update(bytes).digest('hex') !== rec.sha256) return null;
    }
    return { bytes, mime: rec.mime, file_path: rec.file_path, absolute_path: abs, sha256: rec.sha256, record: rec };
  } finally {
    closeQuietly(db);
  }
}

/** 极简 GET 处理器：/api/scene-pool/assets/<sha256> -> 图片字节。集成时挂到 server 上即可。 */
export async function serveSceneAsset(req, res, { dbPath = defaultDbPath() } = {}) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET' || !url.pathname.startsWith(SCENE_ASSET_ROUTE_PREFIX)) return false;
  const id = url.pathname.slice(SCENE_ASSET_ROUTE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(id)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'error', errors: [{ code: 'SCENE_ASSET_NOT_FOUND', message: '场景兜底图不存在。' }] }));
    return true;
  }
  const asset = readSceneAsset({ assetId: id, dbPath });
  if (!asset) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'error', errors: [{ code: 'SCENE_ASSET_NOT_FOUND', message: '场景兜底图不存在。' }] }));
    return true;
  }
  res.writeHead(200, {
    'content-type': asset.mime,
    'content-length': asset.bytes.length,
    'cache-control': 'public, max-age=86400',
    'x-content-type-options': 'nosniff',
    // 明确标注这是 AI 生成图，任何抓取方都能看出来源性质。
    'x-giftwise-image-kind': SCENE_KIND,
  });
  res.end(asset.bytes);
  return true;
}

// ------------------------------------------------------------------ 契约说明

/**
 * 给集成方的契约说明。**只描述，不执行**——集成由 PM 做，本模块不进 pipeline.mjs。
 */
export const SCENE_POOL_CONTRACT = Object.freeze({
  purpose:
    '当平台商品图抓不到（真实商品图缺失）时，用本地生成的场景示意图兜底；' +
    '有真实商品图时**必须优先用真实图**，本池只兜底。',
  delivery_scope: {
    delivered_count: SCENE_POOL_DELIVERED_EXPECTED_COUNT,
    composition: '12 个礼物类型（type，无色调） + 6 个场景 × 3 种色调（scene） = 30',
    decision: '产品裁定 2026-10-31：「场景兜底的图可以缩减到 30 张了。」',
    actually_generated_count: SCENE_POOL_GENERATED_EXPECTED_COUNT,
    extras_note:
      '实际生成了 50 张，多出来的 20 张**文件与库记录都保留**（不删、不降质），' +
      '只是不在交付清单里；默认查询不会命中它们，需要时传 includeExtras: true。',
    source_of_truth: 'scene-pool-catalog.mjs 的 SCENE_POOL_DELIVERED_IDS（冻结 30 条）',
    not_a_db_column:
      '交付范围**故意没有落成数据库列**：本模块运行期只读，不写库。如需 SQL 侧过滤，用 SCENE_POOL_DELIVERED_IDS 拼 IN 条件。',
  },
  read_entry: 'pickSceneImage({ scene, palette, excludePalettes, dbPath, requireFile, includeExtras })',
  never_fake: '查不到就返回 null。本模块不返回占位图、不返回固定假数据、不用其他场景的图顶替。',
  honesty_flags: {
    kind: SCENE_KIND,
    disclaimer: SCENE_POOL_DISCLAIMER_ZH,
    is_real_photo: false,
    in_delivery_scope: 'true=在交付的 30 张里；false=已生成但不交付的额外产物',
  },
  required_frontend_treatment:
    '前端展示本池图片时，必须同时显示「示意图」角标或中文免责说明，禁止把 generated_scene 显示成商品实拍图。',
  asset_route: `${SCENE_ASSET_ROUTE_PREFIX}<sha256>`,
  asset_route_note:
    'sha256 是图片内容的哈希，路由上带着它就能验证「取到的字节」和「库里记账的那张」是同一张。' +
    'serveSceneAsset() 实现了这个路由；集成时把它挂到 server.mjs 的路由表里（本模块不自动挂）。',
  http_note:
    '判定「拿到的是不是真图」一律看**字节**（magic bytes + 长度），不要看 content-type——' +
    'CDN/代理层可能回 text/plain 甚至 HEAD 返回 567，但 GET 的字节是真图。',
  table: 'scene_images（见 SCENE_POOL_SCHEMA_SQL）',
  write_path: '写库只发生在 tools/scene-pool/generate-scene-pool.mjs，运行期只读。',
  not_done: [
    '没有并发（串行 + 限速，防止触发风控）',
    '没有缓存层（每次查询直接读 SQLite）',
    '没有多用户配额/限流（属于集成层的事）',
    '没有接进 pipeline.mjs（按任务要求，由 PM 集成）',
    '没有把交付范围做成数据库列（运行期只读，交付清单是冻结常量）',
  ],
});
