/**
 * 阶段二 · 「库优先 + 缺失才补抓」编排层。
 *
 * 产品负责人 2026-10-31 的要求：大语言模型的候选必须用上 OpenCLI 抓来的**真实商品**，
 * 但**不能把爬取放到关键路径上无限制地跑**。因此这里的规则是硬编码的：
 *
 *   1. **库优先**：先纯读本地库做匹配（毫秒级、不联网、稳定）；
 *   2. **缺失才补抓**：一个都没命中时才触发 **1 次** opencli 抓取，
 *      且**有硬超时**（默认 20000ms，见 config.mjs 的 CATALOG_CONFIG / GIFTWISE_CATALOG_SCRAPE_TIMEOUT_MS）；
 *   3. **单请求内最多 1 次抓取调用**（`MAX_SCRAPES_PER_REQUEST = 1`，代码常量，不许改配置绕过）；
 *   4. 不做并发、不做多站点、不碰需要登录的能力（`1688 assets` / `download` 一律不用）；
 *   5. 抓到即入库（由 collect.mjs 负责 upsert + 图片行 + 价格观察历史），下次不再爬；
 *   6. 抓不到就**如实降级 + 原因码**，绝不用假商品或占位图顶。
 *
 * 每次调用的抓取次数与耗时都记进 `scrapes[]`，并汇总成三本账
 * （`library_hits` / `fallback_hits` / `degraded`），直接进响应与报告。
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { THEME_ALIASES, candidateText, matchCandidates } from './match.mjs';

/** 硬上限：单次请求内允许的 opencli 抓取调用次数。 */
export const MAX_SCRAPES_PER_REQUEST = 1;

const COLLECT_SCRIPT = fileURLToPath(new URL('../collect/collect.mjs', import.meta.url));

/** 从候选文字里挑一个用于补抓的关键词（主题别名优先，绝不用整句去搜）。 */
export function scrapeKeywordFor(candidate) {
  const text = candidateText(candidate);
  for (const theme of THEME_ALIASES) {
    const hit = theme.user_terms.find((term) => text.includes(term));
    if (hit) {
      // 用来源站更容易命中的那个词：优先 db_terms（库里已证明抓得到的词）。
      const dbTerm = theme.db_terms.find((term) => term.length >= 2) ?? hit;
      return { keyword: dbTerm, theme: theme.id, based_on: { field: 'candidate.text', value: hit } };
    }
  }
  return { keyword: '礼物', theme: null, based_on: { field: 'candidate.text', value: '(无主题别名命中，退回泛词)' } };
}

/** 执行一次真实抓取（子进程 + 硬超时）。默认实现用 execFile 起 collect.mjs。 */
export function spawnCollect({ keyword, limit = 3, dbPath, timeoutMs, cdpPort = 19360 }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = {
      ...process.env,
      GW_LOCAL_DB: dbPath,
      GW_COLLECT_PLAN: JSON.stringify([{ source: 'smzdm', keyword, limit }]),
      // 单次 opencli 调用自己的超时留 3 秒给浏览器启动与写库，整体仍由下面的 timeout 硬杀。
      GW_COLLECT_TIMEOUT_MS: String(Math.max(5000, timeoutMs - 3000)),
      GW_COLLECT_DELAY_MS: '0',
      // 请求路径上**不取图**：取图要对每个商品页再各发一次 opencli 调用，
      // 会突破「单请求最多 1 次抓取」的硬约束（见文件头第 3 条）。
      GW_COLLECT_IMAGES: '0',
      GW_CDP_PORT: String(cdpPort),
    };
    execFile(
      process.execPath,
      [COLLECT_SCRIPT],
      { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: false },
      (error, stdout, stderr) => {
        const elapsed = Date.now() - started;
        const out = String(stdout ?? '');
        const err = String(stderr ?? '');
        const summary = /采集汇总[\s\S]*$/m.test(out) ? out.slice(out.search(/采集汇总/)) : out.slice(-600);
        if (error) {
          const timedOut = error.killed === true || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT';
          resolve({
            ok: false,
            elapsed_ms: elapsed,
            call_count: 1,
            status: timedOut ? 'timeout' : 'failed',
            error_code: timedOut ? 'OPENCLI_TIMEOUT' : 'OPENCLI_FAILED',
            error_message: timedOut
              ? `单次抓取超过 ${timeoutMs}ms 硬超时，已放弃本次补抓并如实降级`
              : `抓取子进程失败：${error.message}`,
            stdout_tail: summary.slice(-600),
            stderr_tail: err.slice(-300),
          });
          return;
        }
        const items = Number((out.match(/入库\s*(\d+)\s*条/) ?? [])[1] ?? NaN);
        const failed = /\[([A-Z_]+)\]\s*([^\n]*)/.exec(out);
        resolve({
          ok: true,
          elapsed_ms: elapsed,
          call_count: 1,
          status: failed ? 'partial' : 'ok',
          error_code: failed ? failed[1] : null,
          error_message: failed ? failed[2].trim().slice(0, 200) : null,
          item_count: Number.isFinite(items) ? items : null,
          stdout_tail: summary.slice(-600),
          stderr_tail: err.slice(-300),
        });
      },
    );
  });
}

/**
 * 主体：先读库匹配；一个都没命中时按需补抓 1 次并重新匹配。
 *
 * @param {{
 *   candidates: Array<object>,
 *   budgetAmount?: string|null,
 *   dbPath: string,
 *   maxItems?: number,
 *   scrapeEnabled?: boolean,
 *   scrapeTimeoutMs?: number,
 *   scrapeLimit?: number,
 *   spawnImpl?: Function,
 * }} input
 */
export async function provideRealProducts({
  candidates = [],
  budgetAmount = null,
  dbPath,
  maxItems = 3,
  scrapeEnabled = false,
  scrapeTimeoutMs = 20000,
  scrapeLimit = 3,
  spawnImpl = spawnCollect,
} = {}) {
  const first = matchCandidates(candidates, { dbPath, budgetAmount, maxItems });
  const scrapes = [];
  const libraryHits = first.results.filter((entry) => entry.status === 'matched').length;

  const unmatched = first.results.filter((entry) => entry.status !== 'matched');
  let finalResult = first;
  let fallbackHits = 0;
  let fallbackSkippedReason = null;

  if (unmatched.length > 0 && scrapeEnabled && MAX_SCRAPES_PER_REQUEST > 0) {
    const firstUnmatched = candidates.find((candidate) => candidate.id === unmatched[0].candidate_id) ?? unmatched[0];
    const target = scrapeKeywordFor(firstUnmatched);
    const started = Date.now();
    const outcome = await spawnImpl({ keyword: target.keyword, limit: scrapeLimit, dbPath, timeoutMs: scrapeTimeoutMs });
    scrapes.push({
      seq: 1,
      capability: 'smzdm search',
      keyword: target.keyword,
      theme: target.theme,
      based_on: target.based_on,
      timeout_ms: scrapeTimeoutMs,
      elapsed_ms: Date.now() - started,
      ...outcome,
    });
    if (outcome.ok) {
      const exclude = first.results.filter((entry) => entry.status === 'matched').map((entry) => entry.product.product_id);
      const second = matchCandidates(candidates, { dbPath, budgetAmount, maxItems, excludeProductIds: exclude });
      // 保留第一轮已命中的绑定，第二轮只补没命中的那些。
      const merged = first.results.map((entry) => {
        if (entry.status === 'matched') return entry;
        const found = second.results.find((item) => item.candidate_id === entry.candidate_id);
        return found && found.status === 'matched' ? { ...found, after_scrape: true } : entry;
      });
      fallbackHits = merged.filter((entry) => entry.status === 'matched').length - libraryHits;
      finalResult = {
        ...second,
        status: merged.every((entry) => entry.status === 'matched') ? 'ready' : merged.some((entry) => entry.status === 'matched') ? 'partial' : 'unavailable',
        hit_kind: merged.some((entry) => entry.status === 'matched') ? 'library+fallback' : 'degraded',
        reason_code: merged.some((entry) => entry.status === 'matched') ? null : second.reason_code ?? 'CATALOG_NO_SEMANTIC_MATCH',
        results: merged,
      };
    }
  } else if (unmatched.length > 0 && !scrapeEnabled) {
    fallbackSkippedReason = 'SCRAPE_DISABLED';
  }

  const degraded = finalResult.results.filter((entry) => entry.status !== 'matched').length;
  return {
    catalog: {
      ...finalResult,
      scrapes,
      accounting: {
        candidates: finalResult.results.length,
        library_hits: libraryHits,
        fallback_hits: fallbackHits,
        degraded,
        scrape_calls: scrapes.length,
        scrape_total_elapsed_ms: scrapes.reduce((sum, item) => sum + (item.elapsed_ms ?? 0), 0),
        max_scrapes_per_request: MAX_SCRAPES_PER_REQUEST,
        fallback_skipped_reason: fallbackSkippedReason,
        scrape_enabled: scrapeEnabled,
      },
    },
    scrapes,
  };
}
