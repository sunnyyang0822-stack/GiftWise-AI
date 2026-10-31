import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { runDomesticSearch } from '../server/retrieval/domestic-provider.mjs';
import { REPO_ROOT } from '../server/localdb/db.mjs';
import { readSourceImage } from '../server/catalog/source-image-cache.mjs';
import { taskDirectory } from '../server/collect/task-paths.mjs';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const observed_at = '2026-10-31T17:28:47.911Z';
const records = (count = 3) => Array.from({ length: count }, (_, i) => ({
  reference_kind: 'public_reference', source_url: `https://sspai.com/post/validation-speed-${i}`,
  title: `离线参考${i}`, summary: '仅离线元数据夹具，不代表真实抓取成功', observed_at, source_platform: 'bing',
  image_url: `https://tse${i % 4 + 1}-mm.cn.bing.net/th/id/validation-speed-${i}`,
  image_provenance: { kind: 'search_thumbnail', same_sku_verified: false },
}));
const query = (keyword = '离线参考图', source = 'bing', purpose = 'reference') => ({ purpose, keyword, sources: [source] });
const plan = queries => ({ needs_retrieval: true, queries });
const outcome = items => ({ records: items, coverage: { source: 'bing', status: 'ok', execution_mode: 'public_http', native_executed: false, pages_completed: 1, complete: false } });
const noBrowser = () => { throw new Error('TEST_BROWSER_MUST_NOT_START'); };
const imageResponse = () => new Response(gif, { headers: { 'content-type': 'image/gif' } });

test('纯HTTP reference不依赖OpenCLI/浏览器，保留来源观察时间、字节验证与分段时序', async () => {
  let browserCalls = 0, queries = 0, imageGets = 0;
  const queryFetchImpl = () => { throw new Error('injected query transport is not called by fake adapter'); };
  const result = await runDomesticSearch(plan([query()]), {
    packageRoot: join(REPO_ROOT, '.tmp', 'nonexistent-opencli-package'),
    pageFactory: () => { browserCalls++; return noBrowser(); }, queryFetchImpl,
    referenceSearch: async options => {
      queries++;
      assert.equal(options.source, 'bing');
      assert.equal(options.fetchImpl, queryFetchImpl);
      assert.equal(options.maxPages, 1);
      assert.ok(options.timeoutMs <= 8000);
      assert.equal(options.signal.aborted, false);
      return outcome(records());
    },
    imageFetchImpl: async (_url, options) => {
      imageGets++;
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.imageRole, 'reference');
      return imageResponse();
    },
  });
  assert.equal(browserCalls, 0);
  assert.equal(queries, 1);
  assert.equal(imageGets, 3);
  assert.equal(result.opencli_version, null);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.references.length, 3);
  for (const record of result.references) {
    assert.equal(record.observed_at, observed_at);
    assert.equal(record.image_validation.ok, true);
    assert.equal(record.image_validation.width, 1);
    assert.equal(record.image_validation.height, 1);
    assert.equal('bytes' in record.image_validation, false);
    assert.deepEqual(readSourceImage(record.image_id).bytes, gif);
    assert.equal(record.image_provenance.validation_status, 'validated');
  }
  assert.equal(result.coverage[0].execution_mode, 'public_http');
  assert.equal(result.coverage[0].complete, false);
  assert.ok(result.coverage[0].discovery_ms >= 0);
  assert.ok(result.coverage[0].image_validation_ms >= 0);
});

test('每query最多3路并发、6个不同URL验证，重复URL复用且结果顺序稳定', async () => {
  const items = records(8);
  items[1].image_url = items[0].image_url;
  let active = 0, peak = 0;
  const gets = [];
  const result = await runDomesticSearch(plan([query()]), {
    pageFactory: noBrowser, referenceSearch: async () => outcome(items),
    imageFetchImpl: async url => {
      gets.push(String(url)); active++; peak = Math.max(peak, active);
      await delay(12); active--;
      return imageResponse();
    },
  });
  assert.equal(peak, 3);
  assert.equal(gets.length, 6);
  assert.equal(new Set(gets).size, 6);
  assert.deepEqual(result.references.map(record => record.title), items.map(record => record.title));
  assert.ok(result.references.slice(0, 7).every(record => record.image_validation.ok));
  assert.equal(result.references[7].image_validation.error_code, 'IMAGE_NOT_FETCHED_LIMIT');
  assert.equal(result.references[7].image_id, null);
  assert.equal(result.coverage[0].images_validation_attempted, 6);
  assert.equal(result.coverage[0].image_validation_concurrency, 3);
});

test('URL复用只存在query内，相同URL在下一query仍实际验证，不跨任务共享元数据', async () => {
  let searchCalls = 0, gets = 0;
  const sharedUrl = records(1)[0].image_url;
  const result = await runDomesticSearch(plan([query('离线一'), query('离线二')]), {
    pageFactory: noBrowser, referenceSearch: async () => {
      const record = records(1)[0];
      record.source_url += `-${++searchCalls}`;
      record.image_url = sharedUrl;
      return outcome([record]);
    }, imageFetchImpl: async () => { gets++; return imageResponse(); },
  });
  assert.equal(searchCalls, 2);
  assert.equal(gets, 2);
  assert.equal(result.references.length, 2);
  assert.notEqual(result.references[0].image_id, result.references[1].image_id);
});

test('取消后停止调度剩余图片GET，资料与缺口保留、最终建议仍可用', async () => {
  const controller = new AbortController();
  let gets = 0;
  const result = await runDomesticSearch(plan([query()]), {
    signal: controller.signal, pageFactory: noBrowser, referenceSearch: async () => outcome(records(6)),
    imageFetchImpl: async () => {
      gets++;
      if (gets === 3) controller.abort();
      await delay(8);
      return imageResponse();
    },
  });
  assert.equal(gets, 3);
  assert.equal(result.references.length, 6);
  assert.ok(result.references.every(record => record.image_id === null && record.image_validation.ok === false));
  assert.equal(result.recommendations_available, true);
});

test('失败/假ok/商店来源不冒充有效图片，不阻断合法文字资料或启动Chrome兜底', async () => {
  const items = records(4);
  items[0].image_url = 'https://img10.360buyimg.com/not-reference.jpg';
  items[0].image_validation = { ok: true, width: 100, height: 100 };
  items[1].image_url = null;
  items[1].image_validation = { ok: true, width: 100, height: 100 };
  items[2].image_url = 'https://tse1-mm.cn.bing.net/th/id/html-not-image';
  items[3].source_url = 'https://item.jd.com/10179988291541.html';
  let gets = 0;
  const result = await runDomesticSearch(plan([query()]), {
    pageFactory: noBrowser, referenceSearch: async () => outcome(items),
    imageFetchImpl: async () => { gets++; return new Response('<html>unavailable</html>', { headers: { 'content-type': 'text/html' } }); },
  });
  assert.equal(gets, 1);
  assert.equal(result.references.length, 3);
  assert.ok(result.references.every(record => record.image_id === null));
  assert.equal(result.references[0].image_validation.error_code, 'IMAGE_URL_NOT_ALLOWED');
  assert.equal(result.references[1].image_validation, null);
  assert.equal(result.references[2].image_validation.error_code, 'IMAGE_MIME_NOT_ALLOWED');
  assert.equal(result.recommendations_available, true);
});

test('后续同source参考图验证失败不覆盖本请求之前的完整合法已验证记录', async () => {
  let queries = 0, gets = 0;
  const first = records(1)[0];
  const result = await runDomesticSearch(plan([query('第一次'), query('第二次')]), {
    pageFactory: noBrowser, referenceSearch: async () => {
      queries++;
      return outcome([{ ...first, title: queries === 1 ? first.title : '后续较弱观察' }]);
    }, imageFetchImpl: async () => ++gets === 1 ? imageResponse() : new Response(null, { status: 404 }),
  });
  assert.equal(gets, 2);
  assert.equal(result.references.length, 1);
  assert.equal(result.references[0].title, first.title);
  assert.equal(result.references[0].image_validation.ok, true);
});

test('DDG reference明确未支持HTTP且不回退browser，inspiration仍延迟走旧browser路径', async () => {
  let starts = 0, searches = 0;
  const ddg = await runDomesticSearch(plan([query('离线DDG', 'duckduckgo')]), {
    packageRoot: join(REPO_ROOT, '.tmp', 'nonexistent-opencli-package'),
    pageFactory: () => { starts++; return noBrowser(); }, referenceSearch: async () => { searches++; return outcome([]); },
  });
  assert.equal(starts, 0); assert.equal(searches, 0);
  assert.equal(ddg.coverage[0].status, 'HTTP_SOURCE_UNSUPPORTED');
  assert.equal(ddg.recommendations_available, true);
  const fixtureRoot = taskDirectory(join(REPO_ROOT, '.tmp', 'reference-speed-fixture-opencli'));
  assert.ok(realpathSync(fixtureRoot).startsWith(realpathSync(REPO_ROOT)));
  mkdirSync(join(fixtureRoot, 'clis', 'dianping'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ version: 'offline-speed-fixture' }));
  writeFileSync(join(fixtureRoot, 'clis', 'dianping', 'search.js'), '// offline fixture only');
  let closed = 0;
  const inspiration = await runDomesticSearch(plan([query('离线内容', 'pinterest', 'inspiration')]), {
    packageRoot: fixtureRoot, pageFactory: async () => { starts++; return { close: async () => { closed++; } }; },
    contentSearch: async () => ({ records: [], coverage: { status: 'ok', complete: false } }),
  });
  assert.equal(starts, 1);
  assert.equal(closed, 1);
  assert.equal(inspiration.opencli_version, 'offline-speed-fixture');
});
