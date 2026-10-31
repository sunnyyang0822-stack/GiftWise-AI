/** Domestic retrieval enriches model recommendations; availability is never a generation gate. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createDomesticPage, opencliPackageRoot, opencliVersion } from '../collect/domestic-browser.mjs';
import { searchDianping } from '../collect/dianping.mjs';
import { openDb, startRun, finishRun, upsertProduct, addProductImages, productId, REPO_ROOT } from '../localdb/db.mjs';
import { taskDatabasePath } from '../collect/task-paths.mjs';
import { isDomesticProduct,imageIdOf } from '../catalog/db.mjs';
import { unknownPhysical } from '../media/scene.mjs';
import { enrichDomesticDetail,validateSourceImage } from '../collect/domestic-detail.mjs';
import { cacheSourceImage } from '../catalog/source-image-cache.mjs';
import{createSourceAvailabilityTracker}from'./source-availability.mjs';
const sourceAvailability=createSourceAvailabilityTracker();
const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,32);

async function referenceRecords(page,records,{source,signal,imageValidationLimit=6}){
 const result=[];let attempted=0;
 for(const record of records){
  if(signal?.aborted)break;
  const reference_id='ref_'+digest(`${source}|${record.source_url}`);
  const r={...record,reference_id,reference_kind:'public_reference',image_kind:'reference_image',image_id:null};
  if(record.image_url&&attempted<imageValidationLimit){
   attempted++;
   const validation=await validateSourceImage(record.image_url,{role:'reference',fetchImpl:page.fetchImage,signal,includeBytes:true});
   const{bytes,...metadata}=validation;r.image_validation=metadata;
   if(validation.ok){r.image_id=digest(`${reference_id}|${record.image_url}`);cacheSourceImage(r.image_id,validation);}
  }else if(record.image_url)r.image_validation={ok:false,error_code:'IMAGE_NOT_FETCHED_LIMIT'};
  result.push(r);
 }return result;
}

function asEvidence(record, source) {
  const id = productId(record);
  return { ...record, product_id: id, name: record.name || record.title,
    variant: record.variant || '', quantity: record.quantity ?? 1,
    price_source: 'browser_observed', source_url: record.product_url,
    observed_at: record.observed_at || record.scraped_at || new Date().toISOString(),
    evidence_ref: `${source}:${id}`, stock_status: 'unknown', shipping_status: 'unknown',
    image_id: record.image_validation?.ok&&record.image_url?imageIdOf(id,record.image_url):null, physical: unknownPhysical(), source_platform: source };
}
function observedQueryCache(db,source,query){
 if(!db||!['jd','taobao'].includes(source))return[];
 const rows=db.prepare("SELECT * FROM products WHERE json_extract(query_params,'$.keyword')=? AND scraped_at>=? ORDER BY last_seen_at DESC").all(query.keyword,new Date(Date.now()-30*60*1000).toISOString());
 return rows.map(row=>{let raw={},conditions=[],params={};try{raw=JSON.parse(row.raw_excerpt||'{}');conditions=JSON.parse(row.price_conditions||'[]');params=JSON.parse(row.query_params||'{}');}catch{}
  return{...row,price_conditions:conditions,query_params:params,raw_excerpt:raw,variant:raw.variant??'',specifications:raw.specifications??null,
   image_validation:raw.image_validation??null,image_provenance:raw.image_provenance??null,observed_at:row.scraped_at,page_kind:raw.page_kind??'search'};
 }).filter(r=>isDomesticProduct(r)&&(source==='jd'?r.source_site==='jd.com':['taobao.com','tmall.com'].includes(r.source_site)));
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
      const row = { ...record,image_url:record.image_validation?.ok?record.image_url:null, run_id: runId, scraped_at: record.scraped_at || new Date().toISOString(),
        raw_excerpt: { ...record.raw_excerpt, record_kind: record.record_kind, price_unit: record.price_unit ?? null,
          variant: record.variant ?? null, city: record.city ?? null, address: record.address ?? null,
          packages: record.packages ?? [], specifications:record.specifications??null,image_validation:record.image_validation??null,
          image_provenance:record.image_provenance??null,detail_observation:record.detail_observation??null,page_kind: record.page_kind ?? 'search', coverage } };
      const { product_id } = upsertProduct(db, row);
      if (record.image_url&&record.image_validation?.ok) addProductImages(db, product_id, [{ url: record.image_url, kind: 'main', position: 0, alt: record.title }],
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
  async details(records,options={}){return runDomesticDetails(records,{...this.options,...options});}
}
export async function runDomesticSearch(plan, {
  dbPath, packageRoot, signal, timeoutMs = 90000, port = 19366, headless = process.env.GW_DOMESTIC_HEADLESS === '1',
  profileDir = process.env.GW_DOMESTIC_PROFILE || join(REPO_ROOT, '.tmp/domestic-profile'), maxPages = 50,
  pageFactory = createDomesticPage, platformSearch, contentSearch, dianpingSearch = searchDianping, onProgress = () => {},
} = {}) {
  const products = [], references=[], contents = [], images = [], coverage = [], warnings = [];
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
    const {DOMESTIC_EXTRA_PLATFORMS,runExtraPlatformSearch}=await import('../collect/domestic-extra-platforms.mjs');
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
      const availability=sourceAvailability.getAvailability({source});
      if(!availability.allow_request){coverage.push({source,keyword:query.keyword,status:availability.reason_code,complete:false,pages_completed:0,observed_count:0});continue;}
      const publicReference=query.purpose==='reference'&&['duckduckgo','bing'].includes(source);
      const inspiration = query.purpose === 'inspiration';
      const useContent = inspiration && Boolean(DOMESTIC_CONTENT_SOURCES[source]);
      const cached=query.purpose==='purchase'?observedQueryCache(db,source,query):[];
      if(cached.length){
        products.push(...cached.map(r=>asEvidence(r,source)));
        coverage.push({source,keyword:query.keyword,status:'cached_observations',cached:true,pages_completed:0,observed_count:cached.length,complete:false,
          limitations:['复用同一查询的历史公开观察，具体所选规格与价格可继续调用详情工具核实']});continue;
      }
      if (!['purchase','inspiration','reference'].includes(query.purpose) || (query.purpose === 'reference'&&!publicReference) || (query.purpose === 'purchase' && source !== 'dianping') || (!publicReference&&!useContent && source !== 'dianping')) {
        coverage.push({ source, keyword: query.keyword, status: 'SOURCE_NOT_ALLOWED', complete: false, pages_completed: 0,
          limitations: ['来源尚未接入或不适用于本次用途'] }); continue;
      }
      try {
        const desiredProfile=['taobao','tmall','1688'].includes(source)&&process.env.GW_ALIBABA_PROFILE?process.env.GW_ALIBABA_PROFILE:profileDir;
        if(page&&page.__taskProfile!==desiredProfile){await page.close();page=null;}
        if(!page){page=await pageFactory({ port, headless, profileDir:desiredProfile, signal: controller.signal, timeoutMs: Math.min(timeoutMs, 20000) });page.__taskProfile=desiredProfile;}
        const outcome = publicReference
          ? await (await import('../collect/public-reference.mjs')).runPublicReferenceSearch(page,{source,keyword:query.keyword,packageRoot:root,maxPages:Math.min(maxPages,1),signal:controller.signal})
          : useContent
          ? await (contentSearch ?? searchContent)(page, { source, keyword: query.keyword, city: query.city ?? null,
            packageRoot: root, maxPages, signal: controller.signal })
          : DOMESTIC_EXTRA_PLATFORMS[source]
          ? await runExtraPlatformSearch(page,{platform:source,keyword:query.keyword,maxPages,signal:controller.signal})
          : source === 'dianping'
          ? await dianpingSearch(page, { ...query, packageRoot: root, maxPages, signal: controller.signal, onProgress })
          : await (platformSearch ?? searchPlatform)(page, { platform: source, keyword: query.keyword, city: query.city ?? null,
            maxPages, signal: controller.signal, onProgress, packageRoot: root });
        const sourceCoverage = { source, keyword: query.keyword, city: query.city ?? null,
          ...(outcome.coverage && typeof outcome.coverage === 'object' ? outcome.coverage : {}) };
        // Some adapter versions expose coverage at the top level; preserve its exact completion statement.
        for (const key of ['pages_completed', 'pages_requested', 'reported_total', 'complete', 'limitations', 'status']) {
          if (sourceCoverage[key] === undefined && outcome[key] !== undefined) sourceCoverage[key] = outcome[key];
        }
        sourceCoverage.complete = sourceCoverage.complete === true;
        sourceCoverage.observed_count = outcome.records?.length ?? 0;
        sourceCoverage.purpose = query.purpose;
        sourceAvailability.observe({source,coverage:sourceCoverage,observation_id:`${source}:${sourceCoverage.observed_at??Date.now()}`});
        coverage.push(sourceCoverage);
        if(publicReference||useContent){
          const records=outcome.records??[];
          const resolved=await referenceRecords(page,records,{source,signal:controller.signal});references.push(...resolved);
          sourceCoverage.image_candidates=records.filter(r=>r.image_url).length;
          sourceCoverage.image_validation_limit=6;
          sourceCoverage.images_validation_attempted=resolved.filter(r=>r.image_validation&&r.image_validation.error_code!=='IMAGE_NOT_FETCHED_LIMIT').length;
          if(publicReference){if(db)saveContent(db,records,sourceCoverage,version);onProgress(sourceCoverage);continue;}
        }
        if (useContent) {
          const records = outcome.records ?? [];
          contents.push(...records);
          images.push(...records.filter(r => r.image_url).map(r => ({ url: r.image_url, source_url: r.source_url,
            title: r.title, observed_at: r.observed_at, source_platform: source, kind: 'inspiration_reference', product_id: null })));
          if (db) saveContent(db, records, sourceCoverage, version);
          onProgress(sourceCoverage);
          continue;
        }
        const records = (outcome.records ?? []).map(r => ({ ...r, source_site: r.source_site || DOMESTIC_PLATFORMS[source]?.source_site||DOMESTIC_EXTRA_PLATFORMS[source]?.source_site,
          capability: r.capability || DOMESTIC_PLATFORMS[source]?.capability||DOMESTIC_EXTRA_PLATFORMS[source]?.capability,
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
  return { status: unique.length || contents.length || references.length ? (coverage.every(c => c.complete) ? 'ready' : 'partial') : 'unavailable',
    evidence_id: unique.length ? createHash('sha256').update(unique.map(p => p.product_id).join('|')).digest('hex').slice(0, 32) : null,
    products: unique, references:[...new Map(references.map(r=>[r.reference_id,r])).values()], contents: [...new Map(contents.map(c => [c.source_url, c])).values()], images,source_availability:sourceAvailability.toModelContext({sources:[...new Set(['jd','taobao',...queries.flatMap(q=>q.sources??[])])]}).source_availability,
    coverage, warnings, recommendations_available: true, enrichment_only: true, opencli_version: version ?? null, audit: plan?.audit ?? null };
}

/** Detail URLs must come from this task's observed product records, never from model URLs. */
export async function runDomesticDetails(records,{
 dbPath,signal,port=19366,profileDir=process.env.GW_DOMESTIC_PROFILE||join(REPO_ROOT,'.tmp/domestic-profile'),
 headless=process.env.GW_DOMESTIC_HEADLESS === '1',pageFactory=createDomesticPage,
}={}){
 const products=[],coverage=[];let page,db;
 try{
  if(dbPath)db=openDb(taskDatabasePath(dbPath));
  for(const record of records){
   if(signal?.aborted)break;
   if(!isDomesticProduct(record))continue;
   const source=record.source_platform;
   const availability=sourceAvailability.getAvailability({source});
   if(!availability.allow_request){coverage.push({source,status:availability.reason_code,complete:false,pages_completed:0,observed_count:0});continue;}
   const desiredProfile=source==='taobao'&&process.env.GW_ALIBABA_PROFILE?process.env.GW_ALIBABA_PROFILE:profileDir;
   if(page&&page.__taskProfile!==desiredProfile){await page.close();page=null;}
   if(!page){page=await pageFactory({port,profileDir:desiredProfile,headless,signal});page.__taskProfile=desiredProfile;}
   const detailPlatform=source==='taobao'&&record.source_site==='tmall.com'?'tmall':source;
   const detail=await enrichDomesticDetail(page,record,{platform:detailPlatform,signal,fetchImpl:page.fetchImage,includeImageBytes:true});
   const validation=detail.image_validation;
   const successful=detail.detail_observation?.status==='ok';
   const retained=!successful&&!validation?.ok?{...record,detail_observation:detail.detail_observation}:detail;
   const evidence=asEvidence({...retained,name:retained.title||record.name,variant:retained.specifications||record.variant||'',capability:record.capability},source);
   if(validation?.bytes&&validation.ok&&evidence.image_id)cacheSourceImage(evidence.image_id,validation);
   if(validation){const {bytes,...metadata}=validation;detail.image_validation=metadata;evidence.image_validation=metadata;}
   const observed={source,keyword:record.query_params?.keyword??null,status:detail.detail_observation?.status??'unavailable',pages_completed:1,complete:successful,
    observed_count:1,image_status:validation?.ok?'validated':validation?.error_code??'missing',detail:detail.detail_observation};
   coverage.push(observed);products.push(evidence);
   if(db&&successful)saveRecords(db,[{...detail,name:evidence.name,variant:evidence.variant}],observed,null);
  }
 }finally{await page?.close?.();db?.close();}
 return{status:products.length?'partial':'unavailable',products,contents:[],images:[],coverage,warnings:[],enrichment_only:true};
}
