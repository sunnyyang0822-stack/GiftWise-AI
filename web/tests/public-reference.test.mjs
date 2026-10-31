import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import vm from 'node:vm';
import { PUBLIC_REFERENCE_SOURCES, publicReferenceUrl, extractReferencePrices, normalizePublicReference, buildPublicReferenceReadScript, runPublicReferenceSearch } from '../server/collect/public-reference.mjs';

test('Bing是公开DOM而非虚构native，DDG保留实际OpenCLI命令能力', () => {
  assert.equal(PUBLIC_REFERENCE_SOURCES.bing.opencli, null);
  assert.equal(PUBLIC_REFERENCE_SOURCES.duckduckgo.opencli.command, 'duckduckgo search');
  assert.equal(PUBLIC_REFERENCE_SOURCES.duckduckgo.opencli.native_executed, false);
  assert.equal(new URL(PUBLIC_REFERENCE_SOURCES.bing.searchUrl('礼物 图片', 2)).searchParams.get('first'), '11');
  assert.equal(new URL(PUBLIC_REFERENCE_SOURCES.bing.searchUrl('礼物 图片')).pathname, '/images/search');
  assert.equal(new URL(PUBLIC_REFERENCE_SOURCES.duckduckgo.searchUrl('咖啡 布置')).searchParams.get('kl'), 'cn-zh');
});

test('全球非电商内容可用于图片灵感，海外电商仍拒绝',()=>{
 for(const url of ['https://www.pinterest.com/pin/123/','https://unsplash.com/photos/fixture','https://www.instructables.com/Coffee-Corner/'])assert.ok(publicReferenceUrl(url,'bing'));
 for(const url of ['https://amazon.com/item/1','https://www.ebay.com/itm/123','https://www.etsy.com/listing/123'])assert.equal(publicReferenceUrl(url,'bing'),null);
});

test('公开跳转目标解码后只保留国内非电商来源，去认证/追踪字段', () => {
  const target = 'https://sspai.com/post/123?utm_source=tracking&token=private';
  const bing = 'https://www.bing.com/ck/a?u=a1' + Buffer.from(target).toString('base64url');
  assert.equal(publicReferenceUrl(bing, 'bing'), 'https://sspai.com/post/123');
  assert.equal(publicReferenceUrl('https://duckduckgo.com/l/?uddg=' + encodeURIComponent('https://sspai.com/post/123'), 'duckduckgo'), 'https://sspai.com/post/123');
  for (const url of ['https://amazon.com/item/1', 'https://item.jd.com/123.html', 'https://item.taobao.com/item.htm?id=1', 'https://detail.tmall.com/item.htm?id=1', 'https://you.163.com/item/detail?id=1', 'https://www.suning.cn/product/1', 'https://www.xiaohongshu.com/goods-detail/123', 'https://www.mi.com/shop/buy/detail?product_id=1', 'https://store.honor.com/cn/', 'https://sspai.com.evil.test/post/1', 'https://user:pass@sspai.com/post/1', 'http://127.0.0.1/']) assert.equal(publicReferenceUrl(url, 'bing'), null);
});

test('参考价明确原文/范围/多报价，不拿年份、销量或外币编人民币报价', () => {
  assert.deepEqual(extractReferencePrices('2026年测评，销量1000件，USD 19.99'), []);
  const one = extractReferencePrices('参考399元/套，历史低价仅供参考');
  assert.equal(one[0].amount, '399');
  assert.equal(one[0].unit, '套');
  assert.equal(one[0].is_live_quote, false);
  const range = extractReferencePrices('参考价 ¥99-129');
  assert.equal(range[0].amount, null);
  assert.equal(range[0].min, '99');
  const multi = normalizePublicReference({ title: '导购', url: 'https://sspai.com/post/123', snippet: '不同方案399元、599元' });
  assert.equal(multi.price_amount, null);
  assert.equal(multi.reference_prices.length, 2);
});

test('资料和搜索缩略图不生成SKU或product_id，无图无价仍保留资料', () => {
  const raw = { title: '礼物布置灵感', url: 'https://www.zhihu.com/question/123', image_url: 'https://tse1.mm.bing.net/th?id=example', image_provenance: 'search_thumbnail' };
  const record = normalizePublicReference(raw, { source: 'bing', keyword: '礼物布置图片', observedAt: '2026-10-31T20:00:00Z' });
  assert.equal(record.reference_kind, 'public_reference');
  assert.equal(record.purpose, 'reference');
  assert.equal(Object.hasOwn(record, 'product_id'), false);
  assert.equal(record.product_url, null);
  assert.equal(record.price_amount, null);
  assert.equal(record.image_kind, 'reference_image');
  assert.equal(record.image_provenance.kind, 'search_thumbnail');
  assert.equal(record.image_provenance.same_sku_verified, false);
  assert.equal(record.image_validation, null);
  assert.ok(normalizePublicReference({ title: '无价灵感', url: 'https://sspai.com/post/123' }));
  assert.equal(normalizePublicReference({ ...raw, image_provenance: 'favicon' }).image_url, null);
});

test('Bing当前页DOM仅正文结果卡片与相关缩略图，不读认证或全页图片', () => {
  const card = { matches: () => false, querySelector: selector => {
    if (selector === 'h2 a[href]') return { innerText: '公开布置参考', href: 'https://sspai.com/post/123' };
    if (selector === '.b_caption p, .b_snippet') return { innerText: '参考材料约39元，仅供参考' };
    if (selector.includes('.cico img')) return { currentSrc: 'https://tse1.mm.bing.net/image.jpg', closest: () => null, getAttribute: () => null };
    return null;
  } };
  const document = { body: { innerText: '' }, querySelectorAll: selector => { assert.equal(selector, '#b_results > li.b_algo'); return [card]; }, querySelector: () => null };
  Object.defineProperty(document, 'cookie', { get: () => { throw new Error('Cookie forbidden'); } });
  const result = vm.runInNewContext(buildPublicReferenceReadScript('bing'), { document, location: new URL('https://cn.bing.com/search?q=example') });
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0].image_provenance, 'search_thumbnail');
});

test('国内有效资料与海外/电商结果区分，分页/风控不伪装全量', async () => {
  let calls = 0;
  const page = { goto: async () => calls++, evaluate: async () => ({ status: 'ok', next_available: false, records: [{ title: '参考资料', url: 'https://sspai.com/post/123' }, { title: '海外', url: 'https://amazon.com/1' }, { title: '电商', url: 'https://item.jd.com/1.html' }] }) };
  const result = await runPublicReferenceSearch(page, { source: 'bing', keyword: '公开灵感', maxPages: 3 });
  assert.equal(calls, 1);
  assert.equal(result.records.length, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.pages_completed, 1);
  assert.equal(result.coverage.native_executed, false);
  const restricted = await runPublicReferenceSearch({ goto: async () => {}, evaluate: async () => ({ status: 'restricted', records: [] }) }, { keyword: '图片' });
  assert.equal(restricted.coverage.status, 'restricted');
  assert.equal(restricted.coverage.complete, false);
});

const installedRoot = 'C:/Users/chenhanyang/.opencli/node_modules/@jackwener/opencli';
test('已装DDG真实native func通过离线受控page执行，不启动浏览器/网络；icon不冒充内容图片', { skip: !existsSync(installedRoot + '/clis/duckduckgo/search.js') }, async () => {
  const nav = [], evaluations = [];
  const page = { goto: async url => nav.push(url), wait: async () => {}, evaluate: async script => { evaluations.push(script); return script.includes('var items=doc.querySelectorAll') ? [['包装参考', 'https://sspai.com/post/123', '参考包装材料39元', 'sspai.com', 'https://example.cn/favicon.ico', 'web']] : { status: 'ok', records: [{ title: '包装参考', source_url: 'https://sspai.com/post/123', snippet: '参考包装材料39元', image_url: 'https://example.cn/reference.jpg', image_provenance: 'search_thumbnail' }], next_available: false }; } };
  const result = await runPublicReferenceSearch(page, { source: 'duckduckgo', keyword: '包装 灵感', packageRoot: installedRoot });
  assert.equal(result.coverage.execution_mode, 'native_opencli');
  assert.equal(result.coverage.native_executed, true);
  assert.equal(result.coverage.status, 'ok');
  assert.equal(nav.length, 1);
  assert.equal(new URL(nav[0]).hostname, 'html.duckduckgo.com');
  assert.equal(result.records[0].image_url, 'https://example.cn/reference.jpg');
  assert.equal(result.records[0].price_amount, '39');
  assert.equal(evaluations.length, 2);
});

test('取消/未知原生包失败不扩展为其他来源或电商抓取', async () => {
  const page = { goto: async () => { throw new Error('must not run'); } };
  const aborted = await runPublicReferenceSearch(page, { keyword: '图片', signal: AbortSignal.abort() });
  assert.equal(aborted.coverage.status, 'aborted');
  const unknown = await runPublicReferenceSearch(page, { keyword: '图片', packageRoot: process.cwd() });
  assert.equal(unknown.coverage.status, 'native_adapter_unavailable');
});

test('Bing图片tab从真实公开元数据取得图片与页面来源，不取favicon或造商品', () => {
  const card = { getAttribute: name => name === 'm' ? JSON.stringify({ purl: 'https://sspai.com/post/123', t: '包装布置灵感', murl: 'https://cdn.sspai.com/reference.jpg', turl: 'https://tse1.mm.bing.net/th?id=example' }) : null, querySelector: selector => selector.startsWith('img') ? { src: 'data:image/gif;base64,placeholder', alt: '包装布置灵感', getAttribute: () => null } : null };
  const result = vm.runInNewContext(buildPublicReferenceReadScript('bing'), { document: { body: { innerText: '' }, querySelectorAll: selector => { assert.equal(selector, 'a.iusc[m]'); return [card]; } }, location: new URL('https://cn.bing.com/images/search?q=example') });
  assert.equal(result.status, 'ok');
  const record = normalizePublicReference(result.records[0], { source: 'bing' });
  assert.equal(record.source_url, 'https://sspai.com/post/123');
  assert.equal(record.image_url, 'https://tse1.mm.bing.net/th?id=example');
  assert.equal(record.image_provenance.kind, 'search_thumbnail');
  assert.equal(Object.hasOwn(record, 'product_id'), false);
});

test('DDG公开网页无图时补读同源内容页OG图，拒绝logo并保留真实图片来源', async () => {
  let current;
  const page = { goto: async url => { current = url; }, evaluate: async script => {
    if (new URL(current).hostname === 'html.duckduckgo.com') return { status: 'ok', next_available: false, records: [{ title: '手作布置参考', url: 'https://sspai.com/post/123', snippet: '材料参考39元' }] };
    return vm.runInNewContext(script, { URL, location: new URL(current), document: { body: { innerText: '' }, querySelector: selector => ({ getAttribute: () => selector.includes('og:image') ? 'https://cdn.sspai.com/site-logo.png' : null }), querySelectorAll: () => [{ currentSrc: 'https://cdn.sspai.com/article-image.jpg', naturalWidth: 800, naturalHeight: 600, closest: () => null }] } });
  } };
  const result = await runPublicReferenceSearch(page, { source: 'duckduckgo', keyword: '手作图片' });
  assert.equal(result.records[0].image_url, 'https://cdn.sspai.com/article-image.jpg');
  assert.equal(result.records[0].image_provenance.kind, 'public_page_image');
  assert.equal(result.records[0].image_provenance.source_url, 'https://sspai.com/post/123');
  assert.equal(result.records[0].price_amount, '39');
  assert.equal(result.coverage.image_pages[0].status, 'ok');
});
