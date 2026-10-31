/**
 * 参考图主机白名单的**形状校验与匹配**（代码常量，无环境变量开关）。
 *
 * 设计约束（来自产品负责人 2026-10-31 的要求 + 现有结构性防护）：
 *   1. 只接受**主机名**，不接受 URL / 路径 / 协议：`https://x`、`a/b`、`*` 一律抛 INVALID_REFERENCE_HOSTS。
 *   2. 允许**最左标签前缀通配**（如 `img*.360buyimg.com`）：京东把同一批商品图轮询到
 *      `img10/img11/img12/img13/img14/img20/img30…` 上，逐台枚举会漏；但通配**只覆盖最左标签的前缀**，
 *      右后缀必须是 ≥2 段的固定域（`img*.360buyimg.com` 合法，`*.360buyimg.com` 与 `*.com` 非法）。
 *      这既不是「通配整域」，也不可能被 `img10.360buyimg.com.evil.com` 之类绕过（后缀锚定）。
 *   3. 匹配是**后缀锚定 + 最左标签前缀**，绝不使用 `endsWith(域名)` 这种能被 `evil360buyimg.com` 骗过的写法。
 */

/** 精确主机名：至少两段，每段仅 a-z0-9-，不以 - 开头/结尾。 */
const EXACT_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
/** 最左标签前缀通配：前缀至少 1 个字符 + `*`，其后至少 2 段固定标签。 */
const PREFIX_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\*(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?){2,}$/i;

/** 解析一条白名单条目；不合法直接抛错（不静默丢弃，避免「写了却没用」的假白名单）。 */
export function parseHostEntry(entry) {
  if (typeof entry !== 'string' || entry.includes('/') || entry === '*') throw new Error('INVALID_REFERENCE_HOSTS');
  if (PREFIX_HOST.test(entry)) {
    const dot = entry.indexOf('.');
    const prefix = entry.slice(0, dot - 1); // 去掉末尾 `*`
    const suffix = entry.slice(dot); // 含前导点，如 `.360buyimg.com`
    return { kind: 'prefix', raw: entry, prefix, suffix };
  }
  if (EXACT_HOST.test(entry)) return { kind: 'exact', raw: entry, host: entry.toLowerCase() };
  throw new Error('INVALID_REFERENCE_HOSTS');
}

/** 规范化 + 去重；保留声明顺序（可审计）。 */
export function normalizeHostEntries(hosts) {
  if (!Array.isArray(hosts)) throw new Error('INVALID_REFERENCE_HOSTS');
  const out = [];
  const seen = new Set();
  for (const host of hosts) {
    const parsed = parseHostEntry(host);
    if (seen.has(parsed.raw)) continue;
    seen.add(parsed.raw);
    out.push(parsed);
  }
  return Object.freeze(out);
}

/** 按数组身份缓存解析结果：白名单是**代码常量、对象身份稳定**，因此只解析一次。 */
const RULE_CACHE = new WeakMap();

/** 接受「字符串数组」或「已解析的规则数组」，统一成规则数组（不合法 ⇒ INVALID_REFERENCE_HOSTS）。 */
export function hostRules(hosts) {
  if (!Array.isArray(hosts)) throw new Error('INVALID_REFERENCE_HOSTS');
  if (hosts.every((entry) => entry && typeof entry === 'object' && typeof entry.kind === 'string')) return hosts;
  const cached = RULE_CACHE.get(hosts);
  if (cached) return cached;
  const rules = normalizeHostEntries(hosts);
  RULE_CACHE.set(hosts, rules);
  return rules;
}

/** 便利入口：白名单条目既可以是字符串也可以是已解析规则。 */
export function hostAllowedAny(hosts, hostname) {
  return hostAllowed(hostRules(hosts), hostname);
}

/**
 * 主机是否被白名单放行。
 * @param {ReadonlyArray<{kind:string,host?:string,prefix?:string,suffix?:string}>} entries normalizeHostEntries 的结果
 * @param {string} hostname URL.hostname（已小写）
 */
export function hostAllowed(entries, hostname) {
  if (typeof hostname !== 'string' || !hostname) return false;
  const host = hostname.toLowerCase();
  for (const entry of entries) {
    if (entry.kind === 'exact') {
      if (host === entry.host) return true;
      continue;
    }
    // 前缀通配：host = <leftLabel>.<suffix 去掉前导点>
    if (!host.endsWith(entry.suffix)) continue;
    const leftLabel = host.slice(0, host.length - entry.suffix.length);
    if (!leftLabel || leftLabel.includes('.')) continue;
    if (leftLabel.length <= entry.prefix.length) continue; // 必须比前缀更长（`img.360buyimg.com` 不算）
    if (leftLabel.startsWith(entry.prefix)) return true;
  }
  return false;
}
