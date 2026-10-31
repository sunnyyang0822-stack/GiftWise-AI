/** Domestic retrieval enriches model recommendations; availability is never a generation gate. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createDomesticPage, opencliPackageRoot, opencliVersion } from '../collect/domestic-browser.mjs';
import { searchDianping } from '../collect/dianping.mjs';
import { openDb, startRun, finishRun, upsertProduct, addProductImages, REPO_ROOT } from '../localdb/db.mjs';
import { taskDatabasePath } from '../collect/task-paths.mjs';
import { isDomesticProduct } from '../catalog/db.mjs';

function asEvidence(record, source) {
  const id = createHash('sha256').update(`${source}|${record.product_url}`).digest('hex').slice(0, 32);
  return { ...record, product_id: id, name: record.name || record.title,
    variant: record.variant || '', quantity: record.quantity ?? 1,
    price_source: 'browser_observed', source_url: record.product_url,
    observed_at: record.observed_at || record.scraped_at || new Date().toISOString(),
    evidence_ref: `${source}:${id}`, stock_status: 'unknown', shipping_status: 'unknown',
    image_id: null, source_platform: source };
}
function saveRecords(db, records, coverage, version) {
  const runId = startRun(db, { source_site: records[0]?.source_site || coverage.source,
    capability: records[0]?.capability || `${coverage.source} domestic read-only search`,
    query_params: { keyword: coverage.keyword, city: coverage.city, coverage }, opencli_version: version });
  let count = 0;
  try {
    db.exec('BEGIN');
    for (const record of records) {
      if (!record.title || !record.product_url) continue;
      const row = { ...record, run_id: runId, scraped_at: record.scraped_at || new Date().toISOString(),
        raw_excerpt: { ...record.raw_excerpt, record_kind: record.record_kind, price_unit: record.price_unit ?? null,
          variant: record.variant ?? null, city: record.city ?? null, address: record.address ?? null,
          packages: record.packages ?? [], page_kind: record.page_kind ?? 'search', coverage } };
      const { product_id } = upsertProduct(db, row);
      if (record.image_url) addProductImages(db, product_id, [{ url: record.image_url, kind: 'main', position: 0, alt: record.title }],
        { capability: record.capability, scraped_at: row.scraped_at, run_id: runId });
      count++;
    }
    db.exec('COMMIT');
    finishRun(db, runId, { status: records.length ? 'ok' : 'empty', item_count: count,
      error_code: coverage.complete ? null : coverage.status, error_message: coverage.limitations?.join('；') || null });
  } catch (error) {
    db.exec('ROLLBACK'); finishRun(db, runId, { status: 'failed', error_code: 'CATALOG_WRITE_FAILED', error_message: error.message }); throw error;
  }
}
function saveContent(db, records, coverage, version) {
  db.exec('CREATE TABLE IF NOT EXISTS inspiration_observations (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, record TEXT NOT NULL, coverage TEXT NOT NULL)');
  const insert = db.prepare('INSERT OR REPLACE INTO inspiration_observations VALUES (?,?,?,?,?,?)');
  for (const record of records) {
    const id = createHash('sha256').update(`${record.source_platform}|${record.source_url}|${record.observed_at}`).digest('hex');
    insert.run(id, record.source_platform, record.source_url, record.observed_at, JSON.stringify(record), JSON.stringify(coverage));
  }
}
export class DomesticProvider {
  constructor(options = {}) { this.options = options; }
  async search(plan, options = {}) { return runDomesticSearch(plan, { ...this.options, ...options }); }
}
export async function runDomesticSearch(plan, {
  dbPath, packageRoot, signal, timeoutMs = 90000, port = 19366, headless = true,
  profileDir = join(REPO_ROOT, '.tmp/domestic-profile'), maxPages = 50,
  pageFactory = createDomesticPage, platformSearch, contentSearch, dianpingSearch = searchDianping, onProgress = () => {},
} = {}) {
  const products = [], contents = [], images = [], coverage = [], warnings = [];
  let page, db, root, version;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, timeoutMs));
  const queries = Array.isArray(plan?.queries) ? plan.queries : (plan?.keywords ?? []).map(keyword => ({ keyword, kind: null, city: plan.city ?? null }));
  if (plan?.needs_retrieval !== true || !queries.length) {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    return { status: 'skipped', evidence_id: null, products, contents, images, coverage, warnings, recommendations_available: true,
      enrichment_only: true, audit: plan?.audit ?? { decision_reason: '未提供明确工具使用决定' } };
  }
  try {
    const { DOMESTIC_PLATFORMS, runDomesticSearch: searchPlatform } = await import('../collect/domestic-platforms.mjs');
    const { DOMESTIC_CONTENT_SOURCES, runDomesticContentSearch: searchContent } = await import('../collect/domestic-content.mjs');
    root = opencliPackageRoot(packageRoot); version = opencliVersion(root);
    if (dbPath) db = openDb(taskDatabasePath(dbPath)); // Explicit isolated database only; no shared default.
    const tasks = queries.flatMap(query => {
      if (typeof query.keyword !== 'string' || !query.keyword.trim() || query.keyword.length > 200) throw new Error('INVALID_RETRIEVAL_QUERY');
      return [...new Set(query.sources ?? [])].map(source => ({ source, query }));
    });
    for (const { source, query } of tasks) {
      if (controller.signal.aborted) { coverage.push({ source, keyword: query.keyword, city: query.city ?? null,
        status: signal?.aborted ? 'cancelled' : 'timeout', pages_completed: 0, observed_count: 0, complete: false,
        limitations: ['本次检索已取消或到达时限，未执行此来源；可继续模型推荐'] }); continue; }
      const inspiration = query.purpose === 'inspiration';
      const useContent = inspiration && Boolean(DOMESTIC_CONTENT_SOURCES[source]);
      if (!['purchase','inspiration'].includes(query.purpose) || (query.purpose === 'purchase' && source !== 'dianping' && !DOMESTIC_PLATFORMS[source]) || (!useContent && source !== 'dianping' && !DOMESTIC_PLATFORMS[source])) {
        coverage.push({ source, keyword: query.keyword, status: 'SOURCE_NOT_ALLOWED', complete: false, pages_completed: 0,
          limitations: ['来源尚未接入或不适用于本次用途'] }); continue;
      }
      try {
        page ??= await pageFactory({ port, headless, profileDir, signal: controller.signal, timeoutMs: Math.min(timeoutMs, 20000) });
        const outcome = useContent
          ? await (contentSearch ?? searchContent)(page, { source, keyword: query.keyword, city: query.city ?? null,
            packageRoot: root, maxPages, signal: controller.signal })
          : source === 'dianping'
          ? await dianpingSearch(page, { ...query, packageRoot: root, maxPages, signal: controller.signal, onProgress })
          : await (platformSearch ?? searchPlatform)(page, { platform: source, keyword: query.keyword, city: query.city ?? null,
            maxPages, signal: controller.signal, onProgress });
        const sourceCoverage = { source, keyword: query.keyword, city: query.city ?? null,
          ...(outcome.coverage && typeof outcome.coverage === 'object' ? outcome.coverage : {}) };
        // Some adapter versions expose coverage at the top level; preserve its exact completion statement.
        for (const key of ['pages_completed', 'pages_requested', 'reported_total', 'complete', 'limitations', 'status']) {
          if (sourceCoverage[key] === undefined && outcome[key] !== undefined) sourceCoverage[key] = outcome[key];
        }
        sourceCoverage.complete = sourceCoverage.complete === true;
        sourceCoverage.observed_count = outcome.records?.length ?? 0;
        sourceCoverage.purpose = query.purpose;
        coverage.push(sourceCoverage);
        if (useContent) {
          const records = outcome.records ?? [];
          contents.push(...records);
          images.push(...records.filter(r => r.image_url).map(r => ({ url: r.image_url, source_url: r.source_url,
            title: r.title, observed_at: r.observed_at, source_platform: source, kind: 'inspiration_reference', product_id: null })));
          if (db) saveContent(db, records, sourceCoverage, version);
          onProgress(sourceCoverage);
          continue;
        }
        const records = (outcome.records ?? []).map(r => ({ ...r, source_site: r.source_site || DOMESTIC_PLATFORMS[source]?.source_site,
          capability: r.capability || DOMESTIC_PLATFORMS[source]?.capability,
          scraped_at: r.scraped_at || new Date().toISOString(), query_params: { ...r.query_params, keyword: query.keyword, city: query.city ?? null } })).filter(isDomesticProduct);
        products.push(...records.map(r => asEvidence(r, source)));
        if (db) saveRecords(db, records, sourceCoverage, version);
        onProgress(sourceCoverage);
      } catch (error) {
        coverage.push({ source, keyword: query.keyword, city: query.city ?? null, status: controller.signal.aborted ? 'timeout' : (error.code || 'SOURCE_FAILED'),
          pages_completed: 0, observed_count: 0, complete: false, limitations: [error.message] });
      }
    }
  } catch (error) { warnings.push(error.code || error.message); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); await page?.close?.(); db?.close(); }
  const unique = [...new Map(products.map(p => [p.product_id, p])).values()];
  return { status: unique.length || contents.length ? (coverage.every(c => c.complete) ? 'ready' : 'partial') : 'unavailable',
    evidence_id: unique.length ? createHash('sha256').update(unique.map(p => p.product_id).join('|')).digest('hex').slice(0, 32) : null,
    products: unique, contents: [...new Map(contents.map(c => [c.source_url, c])).values()], images,
    coverage, warnings, recommendations_available: true, enrichment_only: true, opencli_version: version ?? null, audit: plan?.audit ?? null };
}
