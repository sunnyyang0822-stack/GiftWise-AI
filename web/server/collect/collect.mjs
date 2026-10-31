/**
 * GiftWise AI · 真实商品采集器
 *
 * 一条命令：拉起专用无头浏览器 → 依次跑 opencli（限速、逐个、带超时）→
 * 归一化 → 写进本地 SQLite。**只采集公开、免登录、只读的页面。**
 *
 * 用法：
 *   node web/server/collect/collect.mjs                # 用默认计划
 *   GW_COLLECT_PLAN='[{"source":"smzdm","keyword":"礼物","limit":10}]' node web/server/collect/collect.mjs
 *
 * 环境变量：
 *   GW_LOCAL_DB             库文件路径（默认 <repo>/.local-db/giftwise.sqlite）
 *   GW_COLLECT_PLAN         采集计划 JSON 数组
 *   GW_COLLECT_DELAY_MS     两次抓取之间的间隔（默认 2500，限速用）
 *   GW_COLLECT_TIMEOUT_MS   单次抓取超时（默认 90000）
 *   GW_CDP_PORT             CDP 端口（默认 19360）
 *   GW_CHROME_PATH          Chrome 可执行文件路径
 *   GW_OPENCLI_MAIN         opencli 的 main.js 路径（默认自动解析）
 *
 * 失败语义：单条失败**不会**中断整轮，也不写任何占位商品；失败原因记进
 * collection_runs（error_code/error_message）并打印。整轮全失败时退出码为 1。
 */
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { openDb, startRun, finishRun, upsertProduct, addProductImages, getStats, REPO_ROOT } from '../localdb/db.mjs';
import { ensureChrome } from './chrome.mjs';
import { SOURCES, planFromEnv, webReadArgs, extractProductImages, PAGE_IMAGE_CAPABILITY } from './sources.mjs';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => process.stdout.write(`${msg}\n`);

/** 解析 opencli 的 main.js —— 直接由 node 执行，绕开 .cmd/.ps1 外壳。 */
export function resolveOpencliMain() {
  const candidates = [
    process.env.GW_OPENCLI_MAIN,
    process.env.OPENCLI_PACKAGE_ROOT && join(process.env.OPENCLI_PACKAGE_ROOT, 'dist/src/main.js'),
    join(homedir(), '.opencli/node_modules/@jackwener/opencli/dist/src/main.js'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return resolve(c);

  // 从 PATH 上的 opencli 外壳反推同级 node_modules 布局
  try {
    const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['opencli'], { encoding: 'utf8' })
      .split(/\r?\n/)[0]
      .trim();
    if (which) {
      const guess = join(dirname(which), 'node_modules/@jackwener/opencli/dist/src/main.js');
      if (existsSync(guess)) return resolve(guess);
      const persist = resolve(dirname(which), '..', 'node_modules/@jackwener/opencli/dist/src/main.js');
      if (existsSync(persist)) return resolve(persist);
    }
  } catch {
    /* 继续抛出下面的明确错误 */
  }
  throw Object.assign(new Error('找不到 opencli 的 main.js；请设置 GW_OPENCLI_MAIN'), { code: 'OPENCLI_NOT_FOUND' });
}

function runOpencli(mainPath, args, { endpoint, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const env = {
      ...process.env,
      // 关键：让 opencli 走 CDPBridge，而不是需要扩展的 Browser Bridge。
      OPENCLI_CDP_ENDPOINT: endpoint,
      // 已知写操作才需要扩展；读取类命令不需要站点槽位。
      OPENCLI_VERBOSE: '',
    };
    execFile(
      process.execPath,
      [mainPath, ...args],
      { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: false },
      (err, stdout, stderr) => {
        const duration_ms = Date.now() - started;
        const text = String(stdout ?? '').trim();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (payload && payload.ok === false) {
          const e = payload.error ?? {};
          return resolvePromise({
            ok: false,
            duration_ms,
            error_code: e.code ?? 'OPENCLI_ERROR',
            error_message: e.message ?? 'opencli 返回失败',
            exit_code: e.exitCode ?? err?.code ?? null,
            stderr: String(stderr ?? '').slice(0, 500),
          });
        }
        if (err) {
          const timedOut = err.killed || err.signal === 'SIGTERM';
          return resolvePromise({
            ok: false,
            duration_ms,
            error_code: timedOut ? 'COLLECT_TIMEOUT' : 'OPENCLI_EXEC_FAILED',
            error_message: timedOut
              ? `单次抓取超过 ${timeoutMs}ms 超时`
              : `opencli 执行失败：${err.message}`,
            exit_code: typeof err.code === 'number' ? err.code : null,
            stderr: String(stderr ?? '').slice(0, 500),
          });
        }
        if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
          return resolvePromise({
            ok: false,
            duration_ms,
            error_code: 'UNEXPECTED_RESPONSE',
            error_message: 'opencli 返回的不是 {ok:true,data:[...]} 结构',
            exit_code: 0,
            stderr: String(stderr ?? '').slice(0, 500),
          });
        }
        return resolvePromise({ ok: true, duration_ms, records: payload.data });
      },
    );
  });
}

/**
 * 跑一条「输出不是 JSON」的 opencli 命令（目前只有 `web read --stdout true`，
 * 它把 markdown 直接写到 stdout，没有 {ok,data} 外壳）。
 */
function runOpencliRaw(mainPath, args, { endpoint, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    execFile(
      process.execPath,
      [mainPath, ...args],
      {
        env: { ...process.env, OPENCLI_CDP_ENDPOINT: endpoint, OPENCLI_VERBOSE: '' },
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (err, stdout, stderr) => {
        const text = String(stdout ?? '');
        if (err) {
          const timedOut = err.killed || err.signal === 'SIGTERM';
          return resolvePromise({
            ok: false,
            duration_ms: Date.now() - started,
            text: '',
            error_code: timedOut ? 'COLLECT_TIMEOUT' : 'OPENCLI_EXEC_FAILED',
            error_message: timedOut ? `读页超过 ${timeoutMs}ms 超时` : String(stderr || err.message).slice(0, 300),
          });
        }
        // 命令本身可能以 JSON 形式报错；这种情况下 stdout 是 {"ok":false,...}
        const trimmed = text.trim();
        if (trimmed.startsWith('{"ok":false')) {
          let code = 'OPENCLI_ERROR';
          let message = '读页失败';
          try {
            const j = JSON.parse(trimmed);
            code = j.error?.code ?? code;
            message = j.error?.message ?? message;
          } catch {
            /* 保持默认 */
          }
          return resolvePromise({ ok: false, duration_ms: Date.now() - started, text: '', error_code: code, error_message: message });
        }
        return resolvePromise({ ok: true, duration_ms: Date.now() - started, text });
      },
    );
  });
}

function opencliVersion(mainPath) {  try {
    return execFileSync(process.execPath, [mainPath, '--version'], { encoding: 'utf8', timeout: 30000 }).trim();
  } catch {
    return null;
  }
}

export async function collect({ plan, dbPath, delayMs, timeoutMs, port, keepBrowser = false } = {}) {
  const resolvedPlan = plan ?? planFromEnv();
  const resolvedDelay = Number(delayMs ?? process.env.GW_COLLECT_DELAY_MS ?? 2500);
  const resolvedTimeout = Number(timeoutMs ?? process.env.GW_COLLECT_TIMEOUT_MS ?? 90000);
  const resolvedPort = Number(port ?? process.env.GW_CDP_PORT ?? 19360);

  const mainPath = resolveOpencliMain();
  log(`opencli main: ${mainPath}`);
  const version = opencliVersion(mainPath);
  log(`opencli 版本: ${version ?? '（无法读取）'}`);

  const db = openDb(dbPath);
  const browser = await ensureChrome({ port: resolvedPort, log });

  // 真实商品图：默认开启；每次搜索最多读这么多个商品页（限速用）。
  const imagesEnabled = !['0', 'false', 'no', 'off'].includes(
    String(process.env.GW_COLLECT_IMAGES ?? '1').trim().toLowerCase(),
  );
  const resolvedImageLimit = Number(process.env.GW_COLLECT_IMAGE_LIMIT ?? 6);
  log(`真实商品图：${imagesEnabled ? `开启（每次搜索最多读 ${resolvedImageLimit} 个商品页，能力=${PAGE_IMAGE_CAPABILITY}）` : '关闭'}`);

  const results = [];
  let okCount = 0;

  try {
    for (let i = 0; i < resolvedPlan.length; i += 1) {
      const item = resolvedPlan[i];
      const source = SOURCES[item.source];
      if (!source) {
        results.push({ source: item.source, status: 'failed', error_code: 'UNKNOWN_SOURCE', error_message: `未登记来源 ${item.source}` });
        continue;
      }
      const startedAt = Date.now();
      const limit = Math.max(1, Math.min(50, Number(item.limit) || 10));
      const args = source.args(item.keyword, limit);
      const queryParams = { keyword: item.keyword, limit, budget: item.budget ?? null };

      log(`\n[${i + 1}/${resolvedPlan.length}] ${source.capability} "${item.keyword}" (limit=${limit})`);
      const run_id = startRun(db, {
        source_site: source.source_site,
        capability: source.capability,
        query_params: queryParams,
        browser_endpoint: browser.endpoint,
        opencli_version: version,
      });

      const outcome = await runOpencli(mainPath, args, { endpoint: browser.endpoint, timeoutMs: resolvedTimeout });
      if (!outcome.ok) {
        finishRun(db, run_id, {
          status: 'failed',
          item_count: 0,
          error_code: outcome.error_code,
          error_message: outcome.error_message,
          duration_ms: outcome.duration_ms,
        });
        log(`  ✗ 失败 ${outcome.error_code}: ${outcome.error_message}`);
        results.push({ source: source.id, capability: source.capability, keyword: item.keyword, status: 'failed', error_code: outcome.error_code, error_message: outcome.error_message, run_id });
        if (i < resolvedPlan.length - 1) await sleep(resolvedDelay);
        continue;
      }

      const scrapedAt = new Date().toISOString();
      let written = 0;
      let skipped = 0;
      let imagesStored = 0;
      let imageAttempts = 0;
      let imageFailures = 0;
      const imageBudget = Math.max(0, Math.min(Number(resolvedImageLimit) || 0, outcome.records.length));

      for (const record of outcome.records) {
        const normalized = source.normalize(record, { ...queryParams, scrapedAt });
        if (!normalized.title || !normalized.product_url) {
          skipped += 1; // 标题或链接都没有的条目无法追溯，不入库
          continue;
        }

        // 取真实商品图：读**这个商品自己的页面**，只收 alt 与标题匹配的原始图片 URL。
        let images = [];
        if (imagesEnabled && imageAttempts < imageBudget && normalized.record_kind === 'product') {
          imageAttempts += 1;
          const read = await runOpencliRaw(mainPath, webReadArgs(normalized.product_url, join(REPO_ROOT, '.tmp', 'web-articles')), {
            endpoint: browser.endpoint,
            timeoutMs: resolvedTimeout,
          });
          if (read.ok) {
            images = extractProductImages(read.text, normalized.title);
            if (!images.length) imageFailures += 1;
          } else {
            imageFailures += 1; // 拿不到图就如实留空，绝不用生成图/占位图顶替
          }
          await sleep(resolvedDelay); // 限速：读页也算对来源站的一次请求
        }

        const mainImage = images.length ? images[0].url : null;
        const row = {
          ...normalized,
          image_url: mainImage,
          source_site: source.source_site,
          capability: source.capability,
          scraped_at: normalized.scraped_at ?? scrapedAt,
          price_observed_at: normalized.price_observed_at ?? scrapedAt,
          run_id,
        };

        db.exec('BEGIN');
        try {
          const { product_id } = upsertProduct(db, row);
          if (images.length) {
            imagesStored += addProductImages(db, product_id, images, {
              capability: PAGE_IMAGE_CAPABILITY,
              scraped_at: scrapedAt,
              run_id,
            });
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          skipped += 1;
          log(`  · 跳过一条（写库失败）：${err.message}`);
          continue;
        }
        written += 1;
      }

      const status = written ? 'ok' : 'empty';
      finishRun(db, run_id, { status, item_count: written, duration_ms: Date.now() - startedAt });
      if (written) okCount += 1;
      log(
        `  ${written ? '✓' : '·'} ${status}：入库 ${written} 条${skipped ? `，跳过 ${skipped} 条（缺标题或链接）` : ''}` +
          `，图片 ${imagesStored} 张（读页 ${imageAttempts} 次，其中 ${imageFailures} 次没拿到可用图，已如实留空）`,
      );
      results.push({
        source: source.id,
        capability: source.capability,
        keyword: item.keyword,
        status,
        item_count: written,
        skipped,
        run_id,
        raw_count: outcome.records.length,
        image_count: imagesStored,
        image_attempts: imageAttempts,
        image_failures: imageFailures,
      });

      if (i < resolvedPlan.length - 1) await sleep(resolvedDelay); // 限速，不并发轰炸
    }
  } finally {
    if (!keepBrowser) await browser.stop();
    else log('\n（保留浏览器进程：keepBrowser=true）');
  }

  const stats = getStats(db);
  return { results, stats, version, endpoint: browser.endpoint, mainPath };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const out = await collect();
  log('\n================ 采集汇总 ================');
  for (const r of out.results) {
    log(`${r.status.padEnd(7)} ${r.capability ?? r.source} "${r.keyword ?? ''}"` + (r.item_count != null ? ` 入库 ${r.item_count} 条` : '') + (r.error_code ? ` [${r.error_code}] ${r.error_message}` : ''));
  }
  log(`\n库内商品总数：${out.stats.total}（其中有解析价格 ${out.stats.priced}）`);
  log(`来源分布：${out.stats.bySource.map((s) => `${s.source_site}=${s.n}`).join(', ') || '（空）'}`);
  log(`最近一次成功的采集：${out.stats.lastOkAt ?? '（无）'}`);
  process.exitCode = out.stats.total > 0 ? 0 : 1;
}
