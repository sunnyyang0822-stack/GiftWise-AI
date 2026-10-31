import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runDomesticSearch } from '../server/retrieval/domestic-provider.mjs';
import { normalizeDianping, dianpingFailure } from '../server/collect/dianping.mjs';
import { RetrievalWorker } from '../server/retrieval/worker.mjs';
import { REPO_ROOT } from '../server/localdb/db.mjs';
import { taskDirectory } from '../server/collect/task-paths.mjs';

const temp = mkdtempSync(join(taskDirectory(join(REPO_ROOT, '.tmp/provider-tests')), 'test-'));
const fixturePackage = join(temp, 'fixture-opencli');
mkdirSync(join(fixturePackage, 'clis/dianping'), { recursive: true });
writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify({ version: 'fixture-not-real-data' }));
writeFileSync(join(fixturePackage, 'clis/dianping/search.js'), '// fixture only');
const query = (source, keyword = '夹具杯子') => ({ purpose: 'purchase', keyword, sources: [source], kind: null, city: null });
const plan = queries => ({ category: 'domestic', needs_retrieval: true, queries });

test('模型不查时不解析OpenCLI/不启动浏览器；不以预算或关键词自动改决定', async () => {
  let starts = 0;
  for (const keyword of ['自己DIY','演唱会','预算0']) {
    const result = await runDomesticSearch({ needs_retrieval: false, queries: [query('jd', keyword)] }, { pageFactory: () => { starts++; throw Error(); } });
    assert.equal(result.status, 'skipped'); assert.equal(result.recommendations_available, true);
  }
  assert.equal(starts, 0);
});
test('产品停用电商后搜索与详情均不启动浏览器，不复用旧记录冒充新采集', async () => {
  const calls = []; let closed = 0;
  const dbPath = join(temp, 'fixture-catalog.sqlite');
  const result = await runDomesticSearch(plan([query('jd'), query('taobao')]), {
    dbPath, packageRoot: fixturePackage,
    pageFactory: async () => ({ close: async () => { closed++; } }),
    platformSearch: async (page, { platform }) => {
      calls.push(platform);
      if (platform === 'taobao') throw Object.assign(new Error('fixture access failure'), { code: 'AUTH_REQUIRED' });
      return { records: [{ title: '夹具杯子', product_url: 'https://item.jd.com/123.html', price_amount: null, currency: null,
        image_url: null, price_unit: null, price_conditions: [], raw_excerpt: {} }], pages_completed: 2, complete: true, status: 'ok' };
    },
  });
  assert.deepEqual(calls, []); assert.equal(closed, 0);
  assert.equal(result.products.length, 0);
  assert.equal(result.recommendations_available, true); assert.equal(result.coverage[0].pages_completed, 0);
  assert.ok(result.coverage.every(c=>c.status==='COMMERCE_DISABLED_BY_USER'));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { assert.equal(db.prepare('select count(*) as n from products').get().n,0); }
  finally { db.close(); }
});
test('海外来源不执行且不得夹带到国内商品；无默认全平台扩展', async () => {
  let starts = 0, reads = 0;
  const result = await runDomesticSearch(plan([query('amazon')]), { packageRoot: fixturePackage, pageFactory: async () => { starts++; }, platformSearch: async () => { reads++; } });
  assert.equal(starts, 0); assert.equal(reads, 0); assert.equal(result.coverage[0].status, 'SOURCE_NOT_ALLOWED');
  const noSources = await runDomesticSearch(plan([{ keyword:'咖啡', sources:[] }]), { packageRoot:fixturePackage, pageFactory:async()=>{starts++;} });
  assert.equal(noSources.products.length, 0); assert.equal(starts, 0);
});
test('DB越界在浏览器启动前拒绝；取消不留下待执行平台', async () => {
  let starts = 0;
  const result = await runDomesticSearch(plan([query('jd')]), { packageRoot:fixturePackage, dbPath:join(REPO_ROOT,'../shared.sqlite'), pageFactory:()=>{starts++;} });
  assert.equal(starts, 0); assert.match(result.warnings.join(), /PATH_OUTSIDE_WORKTREE/);
  const c = new AbortController(); c.abort();
  const cancelled = await runDomesticSearch(plan([query('jd'),query('taobao')]), { packageRoot:fixturePackage, signal:c.signal, pageFactory:()=>{starts++;} });
  assert.equal(starts, 0); assert.equal(cancelled.coverage.length, 2); assert.ok(cancelled.coverage.every(c=>c.status==='cancelled'));
});
test('大众点评商户人均不是套餐价；地点图片观察时间保留，无价不补零', () => {
  const item = normalizeDianping({name:'夹具陶艺空间',url:'https://www.dianping.com/shop/fixture123',price_text:'人均：￥128',address:'夹具地点',image_url:'https://p0.meituan.net/fixture.jpg'}, {keyword:'陶艺体验',city:'上海',scrapedAt:'2026-10-31T10:00:00Z',detail:true});
  assert.equal(item.record_kind, 'experience'); assert.equal(item.price_amount, '128'); assert.match(item.price_unit,/人/);
  assert.ok(item.price_conditions.length); assert.equal(item.address,'夹具地点'); assert.equal(item.city,'上海');
  assert.equal(item.page_kind,'detail'); assert.equal(item.observed_at,'2026-10-31T10:00:00Z');
  assert.equal(normalizeDianping({name:'夹具',url:'https://www.dianping.com/shop/abc'}).price_amount,null);
  assert.equal(normalizeDianping({name:'夹具',url:'https://amazon.com/shop/a'}),null);
  assert.equal(dianpingFailure({url:'https://account.dianping.com/pclogin'}),'AUTH_REQUIRED');
  assert.equal(dianpingFailure({text:'安全验证'}),'ACCESS_RESTRICTED');
});
test('国内worker接受多需求与原话标点，单次取消不会毒化后续任务', async () => {
  let count=0;
  const worker = new RetrievalWorker({search:async()=>{if(++count===1)throw Error();return {products:[],status:'skipped'};}});
  const p=plan([query('dianping','黑白/陶艺 & 咖啡')]);
  assert.equal((await worker.submit(p)).status,'unavailable');
  assert.equal((await worker.submit(p)).status,'skipped');
});
test('全球灵感经公开文本索引返回，不抓网图/SKU且不创建OpenCLI浏览器', async () => {
  const dbPath=join(temp,'content-fixture.sqlite');let calls=0;
  const options={dbPath,pageFactory:()=>assert.fail('no browser for content index'),queryFetchImpl:async url=>{calls++;assert.match(new URL(url).searchParams.get('q'),/site:pinterest.com/);return new Response('<li class="b_algo"><h2><a href="https://www.pinterest.com/pin/123/">夹具灵感</a></h2><div class="b_caption"><p>这是公开索引的受控摘要，不是完整文章，也不是实时商品。</p></div></li>',{headers:{'content-type':'text/html'}});}};
  const result=await runDomesticSearch(plan([{purpose:'inspiration',keyword:'夹具灵感',sources:['pinterest']}]),options);
  assert.equal(result.products.length,0);assert.equal(result.references.length,1);assert.equal(result.images.length,0);assert.equal(result.coverage[0].source,'pinterest');assert.equal(result.coverage[0].engine,'bing');assert.equal(calls,1);
  const db=new DatabaseSync(dbPath,{readOnly:true});try{assert.equal(db.prepare('select count(*) as n from products').get().n,0);assert.equal(db.prepare('select count(*) as n from inspiration_observations').get().n,1);}finally{db.close();}
  const forbidden=await runDomesticSearch(plan([query('pinterest')]),options);assert.equal(calls,1);assert.equal(forbidden.coverage[0].status,'SOURCE_NOT_ALLOWED');
});
