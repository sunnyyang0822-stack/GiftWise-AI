import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DOMESTIC_CONTENT_SOURCES as sources, normalizeDomesticContent, buildDomesticContentReadScript, runDomesticContentSearch } from '../server/collect/domestic-content.mjs';

test('安装能力如实登记、仅灵感能力，不默认为商品', () => {
  for (const id of ['xiaohongshu', 'bilibili', 'zhihu', 'weibo', 'douban', 'douyin', 'huodongxing']) assert.ok(sources[id]);
  for (const source of Object.values(sources)) {
    assert.equal(source.purpose, 'inspiration');
    assert.equal(source.verification_status, 'not_live_verified');
    assert.equal(new URL(source.searchUrl('旅行 & 礼物')).protocol, 'https:');
    assert.doesNotThrow(() => new Function(`return ${buildDomesticContentReadScript(source.id)}`));
  }
  assert.equal(sources.huodongxing.opencli, null);
  assert.equal(sources.bilibili.opencli.command, 'bilibili search');
  assert.equal(new URL(sources.bilibili.searchUrl('旅行', null, 3)).searchParams.get('page'), '3');
});

test('无价格、无图片的资料可用，来源/作者/短摘要保真', () => {
  const record = normalizeDomesticContent('zhihu', { title: '手工包装的思路', url: 'https://zhuanlan.zhihu.com/p/123', author: '小王', summary: '甲'.repeat(500), price: '100', product_url: 'https://item.jd.com/1.html' }, { observedAt: '2026-10-31T17:00:00Z' });
  assert.equal(record.record_kind, 'content');
  assert.equal(record.product_url, null);
  assert.equal(record.image_url, null);
  assert.equal(record.author, '小王');
  assert.equal(record.summary.length, 300);
  assert.equal(record.observed_at, '2026-10-31T17:00:00Z');
  assert.equal(Object.hasOwn(record, 'price'), false);
});

test('严格来源域与内容路径，拒绝海外、伪子域、登录/商城页', () => {
  for (const url of ['https://youtube.com/video/BV123', 'https://bilibili.com.evil.test/video/BV123', 'https://passport.bilibili.com/login', 'https://mall.bilibili.com/item/1', 'javascript:alert(1)', 'https://user:pass@bilibili.com/video/BV123']) {
    assert.equal(normalizeDomesticContent('bilibili', { title: '资料', url }), null);
  }
  assert.equal(normalizeDomesticContent('bilibili', { title: '教程', url: 'https://www.bilibili.com/video/BV123' }).record_kind, 'video');
  assert.equal(normalizeDomesticContent('huodongxing', { title: '读书活动', url: 'https://www.huodongxing.com/event/123' }).record_kind, 'event');
});

test('只接受内容卡片真实图片，不将图片当商品实拍', () => {
  const raw = { title: '布置思路', url: 'https://www.xiaohongshu.com/explore/abcdef', image_url: 'https://sns-webpic-qc.xhscdn.com/test.jpg' };
  assert.equal(normalizeDomesticContent('xiaohongshu', raw).image_url, null);
  const content = normalizeDomesticContent('xiaohongshu', { ...raw, image_provenance: 'content_card' });
  assert.equal(content.image_role, 'inspiration_reference');
  assert.equal(content.image_url, raw.image_url);
  assert.equal(normalizeDomesticContent('xiaohongshu', { ...raw, image_provenance: 'content_card', image_url: 'data:image/png;base64,aaa' }).image_url, null);
});

test('仅调用模型选中来源；保留无报价资料并去重，不要求packageRoot执行代码', async () => {
  const urls = [];
  const page = { goto: async url => urls.push(url), evaluate: async () => ({ status: 'ok', next_available: false, records: [{ title: '咖啡文化', url: 'https://www.bilibili.com/video/BV123' }, { title: '重复', url: 'https://www.bilibili.com/video/BV123' }] }) };
  const result = await runDomesticContentSearch(page, { source: 'bilibili', keyword: '咖啡', maxPages: 3, packageRoot: 'not-executed' });
  assert.equal(urls.length, 1);
  assert.equal(new URL(urls[0]).hostname, 'search.bilibili.com');
  assert.equal(result.records.length, 1);
  assert.equal(result.coverage.pages_completed, 1);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.scope, 'partial_or_unavailable');
  await assert.rejects(runDomesticContentSearch(page, { keyword: '咖啡' }), /不支持/);
});

test('登录/受限/异常/取消均以覆盖元数据返回，不阻断建议', async () => {
  for (const status of ['login_required', 'restricted', 'empty_or_selector_changed']) {
    const result = await runDomesticContentSearch({ goto: async () => {}, evaluate: async () => ({ status, records: [] }) }, { source: 'weibo', keyword: '摄影' });
    assert.equal(result.coverage.status, status);
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(result.records, []);
  }
  const failed = await runDomesticContentSearch({ goto: async () => { throw new Error('secret'); } }, { source: 'weibo', keyword: '摄影' });
  assert.equal(failed.coverage.status, 'failed');
  assert.equal(JSON.stringify(failed).includes('secret'), false);
  const aborted = await runDomesticContentSearch({ goto: async () => { throw new Error('must not run'); } }, { source: 'weibo', keyword: '摄影', signal: AbortSignal.abort() });
  assert.equal(aborted.coverage.status, 'aborted');
});

test('DOM只提取卡片，不读cookie/storage，登录与风控状态不标成功', () => {
  for (const [body, status] of [['扫码登录', 'login_required'], ['安全验证', 'restricted'], ['', 'empty_or_selector_changed']]) {
    const context = { document: { body: { innerText: body }, querySelectorAll: () => [], querySelector: () => null }, location: new URL('https://www.xiaohongshu.com/search_result') };
    Object.defineProperty(context.document, 'cookie', { get() { throw new Error('Cookie access forbidden'); } });
    const result = vm.runInNewContext(buildDomesticContentReadScript('xiaohongshu'), context);
    assert.equal(result.status, status);
  }
});

test('DOM返回外站或商城链接时不标覆盖完成', async () => {
  const result = await runDomesticContentSearch({ goto: async () => {}, evaluate: async () => ({ status: 'ok', records: [{ title: '商品', url: 'https://mall.bilibili.com/item/1' }] }) }, { source: 'bilibili', keyword: '画画' });
  assert.equal(result.coverage.status, 'no_valid_content');
  assert.equal(result.coverage.pages_completed, 0);
  assert.equal(result.coverage.complete, false);
});

test('全球灵感源白名单、原生命令与真实卡片图归一化', () => {
  assert.equal(sources.pinterest.opencli.command, 'pinterest search-pins');
  assert.equal(sources.pixiv.opencli.command, 'pixiv search');
  assert.equal(sources.pinterest.opencli.native_executed, false);
  assert.equal(sources.pixiv.verification_status, 'not_live_verified');
  assert.equal(new URL(sources.pinterest.searchUrl('gift wrapping')).searchParams.get('q'), 'gift wrapping');
  assert.equal(new URL(sources.pixiv.searchUrl('花束')).pathname, '/tags/%E8%8A%B1%E6%9D%9F/artworks');
  for (const [source, url, image] of [['pinterest', 'https://www.pinterest.com/pin/123/', 'https://i.pinimg.com/736x/example.jpg'], ['pixiv', 'https://www.pixiv.net/artworks/123', 'https://i.pximg.net/img-master/example.jpg']]) {
    const record = normalizeDomesticContent(source, { title: '包装参考图', source_url: url, image_url: image, image_provenance: 'content_card' }, { keyword: '包装' });
    assert.equal(record.image_url, image);
    assert.equal(record.product_url, null);
    assert.equal(record.purpose, 'inspiration');
    assert.equal(record.relevance.keyword, '包装');
    assert.equal(record.relevance.verified, false);
    assert.equal(record.image_role, 'inspiration_reference');
    assert.equal(normalizeDomesticContent(source, { title: '错域', source_url: 'https://pixiv.net.evil.test/artworks/1' }), null);
    assert.doesNotThrow(() => new Function(`return ${buildDomesticContentReadScript(source)}`));
  }
});
