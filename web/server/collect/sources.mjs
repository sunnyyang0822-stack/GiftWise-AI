/**
 * 采集来源定义 + 归一化器。
 *
 * 国内只读来源定义；直接平台检索见 domestic-provider.mjs。
 *   - 用哪条 opencli 命令（capability）
 *   - 原始响应里有哪些字段
 *   - 哪些字段本来源拿不到（拿不到就 null，绝不编）
 *
 * 实测结论（2026-10-31，本机，CDP 直连模式）：
 *   smzdm search  ✅ 公开可读，价格是人民币「元」，带 mall（商城/卖家）
 *   海外来源不再登记，不参与新增采集或绑定。
 *   1688 search   ❌ AUTH_REQUIRED(77) —— 需要登录，按任务要求**不做**登录
 *   jd search     ❌ UNKNOWN "Inspected target navigated or closed"
 */

/** 从价格文本里抽数值：兼容「79.9元」「￥348.44」「HKD 39.23」「348.44 元」。 */
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;

/** 把「需用券」这类附加条件从价格文本里拆出来，不合并进价格数值。 */
function extractConditions(priceText) {
  const out = [];
  const re = /[（(]([^）)]*)[）)]/g;
  let m;
  while ((m = re.exec(priceText)) !== null) {
    for (const part of m[1].split(/[、,，;；]/)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return [...new Set(out)];
}

/** 普通数字清洗：去掉千分位。 */
function toAmount(numText) {
  return numText.replace(/,/g, '');
}

const DATE_LIKE = /^\d{2,4}-\d{1,2}(-\d{1,2})?(\s+\d{1,2}:\d{2})?$/;

export const SOURCES = Object.freeze({
  // ------------------------------------------------------------ 什么值得买
  smzdm: {
    id: 'smzdm',
    source_site: 'smzdm.com',
    capability: 'smzdm search',
    /** 该来源能给出的币种；价格文本里带「元」即人民币。 */
    currency: 'CNY',
    args: (q, limit) => ['smzdm', 'search', q, '--limit', String(limit)],
    /** 每条记录里，哪一段是「查询参数」，要原样存进 query_params。 */
    /**
     * @param {object} r  opencli 原始记录，字段：rank,title,price,mall,updated_at,zhi_count,buzhi_count,favorite_count,comments,url
     * @param {object} ctx {keyword, limit, scrapedAt}
     */
    normalize(r, ctx) {
      const priceText = typeof r.price === 'string' ? r.price.trim() : '';
      const m = priceText.match(new RegExp(`(${NUM})\\s*元`));
      const conditions = extractConditions(priceText);
      // 只有真的解析出「元」才认人民币；否则币种与数值都留 null。
      const price_amount = m ? toAmount(m[1]) : null;

      const rawMall = typeof r.mall === 'string' ? r.mall.trim() : '';
      // 来源站把资讯帖的发布时间塞进了 mall 字段；那不是卖家，必须丢掉。
      const seller = !rawMall || DATE_LIKE.test(rawMall) ? null : rawMall;

      const url = typeof r.url === 'string' ? r.url : '';
      const idMatch = url.match(/\/p\/([A-Za-z0-9]+)/);
      const isArticle = /(^|\.)post\.smzdm\.com$/i.test(safeHost(url)) || price_amount === null;

      return {
        record_kind: isArticle ? 'article' : 'product',
        external_id: idMatch ? idMatch[1] : null,
        title: String(r.title ?? '').trim(),
        price_text: priceText || null,
        price_amount,
        currency: price_amount === null ? null : 'CNY',
        price_conditions: conditions,
        seller,
        product_url: url,
        image_url: null, // smzdm search 不返回图片字段
        raw_excerpt: {
          rank: r.rank ?? null,
          price: priceText || null,
          mall: rawMall || null,
          // 来源站自己的展示时间（无年份、无时区），只作为原文保留，不当成观察时间
          source_updated_text: typeof r.updated_at === 'string' ? r.updated_at : null,
          zhi_count: r.zhi_count ?? null,
          comments: r.comments ?? null,
        },
        query_params: { keyword: ctx.keyword, limit: ctx.limit, budget: ctx.budget ?? null },
      };
    },
  },

});

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * 图片来源能力：`opencli web read`。
 *
 * 为什么用它：1688 的 `assets` / `download`（产品负责人点名的那两条）在免登录前提下
 * 拿不到——实测返回 AUTH_REQUIRED(77)，而任务禁止登录。改用 opencli 的通用读页能力
 * 读取**商品自己的页面**，再从中抽出**原始图片 URL**：
 *   opencli web read --url <商品页> --download-images false --stdout true
 * 关键在 `--download-images false`：默认 true 会把图片下载到本地并把 markdown 里的
 * 图片地址改写成相对路径（原始 URL 就丢了）。
 */
export const PAGE_IMAGE_CAPABILITY = 'web read';

export function webReadArgs(url, outputDir) {
  const args = ['web', 'read', '--url', url, '--download-images', 'false', '--stdout', 'true', '--wait', '3'];
  if (outputDir) args.push('--output', outputDir); // 不让 opencli 往仓库根目录写 web-articles/
  return args;
}

function normForMatch(s) {
  return String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・|｜[\]【】,，。.、!！?？:：;；'"“”‘’()（）\-_/\\+*~`]+/g, '')
    .toLowerCase();
}

/**
 * 从 `web read` 的 markdown 里抽出**属于这个商品**的原始图片 URL。
 *
 * 只认 alt 文本与商品标题匹配的图 —— 页面里的「猜你喜欢 / 相关商品 / 头像」都带别的
 * alt，被排除掉。这样就不会把 B 商品的图配到 A 商品上。
 */
export function extractProductImages(markdown, title, { max = 6 } = {}) {
  const text = String(markdown || '');
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const target = normForMatch(title);
  if (target.length < 6) return [];
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    const alt = m[1];
    const url = m[2].trim();
    if (!/^https:\/\//i.test(url)) continue; // 只要原始 https 图，排除本地相对路径
    if (/avatarimg|头像|logo|icon|qrcode/i.test(`${alt} ${url}`)) continue;
    const a = normForMatch(alt);
    if (!a || a.length < 6) continue;
    // 双向包含：标题常被来源站截断或加后缀
    if (!(a === target || a.includes(target) || target.includes(a))) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, kind: out.length === 0 ? 'main' : 'unknown', position: out.length, alt });
    if (out.length >= max) break;
  }
  return out;
}

/** 默认采集计划：关键词 × 预算区间，全部是可公开检索的礼物方向。 */
export const DEFAULT_PLAN = Object.freeze([]); // 无需求时不静默采集泛词。

export function planFromEnv(env = process.env) {
  if (!env.GW_COLLECT_PLAN) return DEFAULT_PLAN;
  try {
    const parsed = JSON.parse(env.GW_COLLECT_PLAN);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('plan 必须是数组');
    for (const item of parsed) {
      if (!SOURCES[item.source]) throw new Error(`未知来源：${item.source}`);
      if (typeof item.keyword !== 'string' || !item.keyword.trim()) throw new Error('keyword 必填');
    }
    return parsed;
  } catch (err) {
    throw Object.assign(new Error(`GW_COLLECT_PLAN 无效：${err.message}`), { code: 'INVALID_PLAN' });
  }
}
