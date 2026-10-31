import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { DOMESTIC_EXTRA_PLATFORMS as sources, normalizeExtraProduct, buildExtraPlatformReadScript, runExtraPlatformSearch } from '../server/collect/domestic-extra-platforms.mjs';

test('补充平台有搜索或商品详情实现，未证实入口不冒充搜索', () => {
  assert.equal(sources.yanxuan.searchUrl('茶 & 杯'), 'https://you.163.com/search?keyword=%E8%8C%B6+%26+%E6%9D%AF');
  assert.equal(sources.xiaomi.keyword_search_available, true);
  for (const id of ['xiaohongshu_shop', 'kuaishou', 'dewu']) {
    assert.equal(sources[id].searchUrl, null);
    assert.equal(sources[id].capability, 'product_url_dom');
    assert.equal(sources[id].integration_status, 'implemented_not_live_verified');
    assert.equal(sources[id].opencli, null);
  }
  for (const id of Object.keys(sources)) assert.doesNotThrow(() => new Function(`return ${buildExtraPlatformReadScript(id, 'detail')}`));
});

test('交易来源域/商品路径/ID白名单，笔记、商家后台和官网不得绑定商品', () => {
  for (const [id, url] of [['xiaohongshu_shop', 'https://www.xiaohongshu.com/explore/123'], ['xiaohongshu_shop', 'https://ark.xiaohongshu.com/goods/123'], ['kuaishou', 'https://www.kwaixiaodian.com/'], ['dewu', 'https://stark.dewu.com/'], ['dewu', 'https://fast.dewu.com.evil.test/router/product/ProductDetail?spuId=1'], ['yanxuan', 'https://you.163.com/item/detail?id=no'], ['yanxuan', 'https://user:pass@you.163.com/item/detail?id=1']]) assert.equal(normalizeExtraProduct(id, { title: '错误商品', url }), null);
  assert.equal(sources.xiaohongshu_shop.acceptsProductUrl('https://www.xiaohongshu.com/goods-detail/68dbe80f3f37a9000105bc66'), true);
  assert.equal(sources.kuaishou.acceptsProductUrl('https://app.kwaixiaodian.com/web/kwaishop-goods-detail-page-app?id=123'), true);
});

test('公开Product JSON-LD只取当前商品，推荐商品不混入', () => {
  const url = 'https://fast.dewu.com/router/product/ProductDetail?spuId=123';
  const data = { '@graph': [{ '@type': 'Product', url: 'https://fast.dewu.com/router/product/ProductDetail?spuId=456', name: '推荐商品', offers: { price: 1, priceCurrency: 'CNY' } }, { '@type': 'Product', url, name: '当前商品', offers: { price: '89.90', priceCurrency: 'CNY' }, image: 'https://cdn.dewu.com/product.jpg' }] };
  const raw = vm.runInNewContext(buildExtraPlatformReadScript('dewu', 'detail'), { URL, location: new URL(url), document: { body: { innerText: '' }, querySelectorAll: selector => { assert.equal(selector, 'script[type="application/ld+json"]'); return [{ textContent: JSON.stringify(data) }]; } } });
  assert.equal(raw.status, 'ok');
  assert.equal(raw.records.length, 1);
  const record = normalizeExtraProduct('dewu', raw.records[0], { page_kind: 'detail', observed_at: '2026-10-31T18:00:00Z' });
  assert.equal(record.title, '当前商品');
  assert.equal(record.price_amount, '89.90');
  assert.equal(record.currency, 'CNY');
  assert.equal(record.specifications, null);
  assert.equal(record.image_validation, null);
  assert.equal(record.image_provenance.validation_status, 'not_fetched');
  assert.equal(record.raw_excerpt.observation_method, 'product_json_ld');
});

test('缺币种/规格/图片保留未知，条件价和单位保留原文', () => {
  const url = 'https://you.163.com/item/detail?id=123';
  const unknown = normalizeExtraProduct('yanxuan', { title: '杯子', url, price: '99' });
  assert.equal(unknown.currency, null);
  assert.equal(unknown.price_amount, null);
  assert.equal(unknown.image_url, null);
  const conditional = normalizeExtraProduct('yanxuan', { title: '杯子', url, price: '券后39元/个起' });
  assert.equal(conditional.price_text, '券后39元/个起');
  assert.equal(conditional.price_amount, null);
  assert.deepEqual(conditional.price_conditions, ['券后', '起']);
  assert.equal(conditional.price_unit, '个');
});

test('无检索入口返回明确依赖，不访问官网冒充接入', async () => {
  const result = await runExtraPlatformSearch({ goto: async () => { throw new Error('不应访问官网'); } }, { platform: 'kuaishou', keyword: '茶杯' });
  assert.equal(result.coverage.status, 'product_link_required');
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.records, []);
});

test('检索卡片结果与详情观察覆盖范围诚实，非法详情链接不静默漏记', async () => {
  let calls = 0;
  const page = { goto: async () => calls++, evaluate: async () => ({ status: 'ok', page_url: 'https://you.163.com/item/detail?id=123', records: [{ title: '真实杯子', product_url: 'https://you.163.com/item/detail?id=123', price_text: '¥39', observation_method: 'search_dom' }] }) };
  const search = await runExtraPlatformSearch(page, { platform: 'yanxuan', keyword: '茶杯', maxPages: 3 });
  assert.equal(calls, 1);
  assert.equal(search.records.length, 1);
  assert.equal(search.coverage.complete, false);
  assert.equal(search.coverage.scope, 'visible_first_page_only');
  const detail = await runExtraPlatformSearch(page, { platform: 'yanxuan', productUrls: ['https://you.163.com/item/detail?id=123', 'https://evil.test/item/1'] });
  assert.equal(detail.coverage.product_urls_rejected, 1);
  assert.equal(detail.coverage.complete, false);
  const swapped = await runExtraPlatformSearch({ goto: async () => {}, evaluate: async () => ({ status: 'ok', page_url: 'https://you.163.com/item/detail?id=456', records: [] }) }, { platform: 'yanxuan', productUrls: ['https://you.163.com/item/detail?id=123'] });
  assert.equal(swapped.coverage.status, 'product_changed');
});

test('登录/服务异常/取消不伪装检索完成', async () => {
  const common = { URL, location: new URL('https://app.kwaixiaodian.com/web/kwaishop-goods-detail-page-app?id=123') };
  for (const [body, status] of [['服务异常，请联系客服', 'service_unavailable'], ['扫码登录', 'login_required'], ['安全验证', 'restricted']]) {
    const raw = vm.runInNewContext(buildExtraPlatformReadScript('kuaishou', 'detail'), { ...common, document: { body: { innerText: body } } });
    assert.equal(raw.status, status);
  }
  const result = await runExtraPlatformSearch({ goto: async () => { throw new Error('must not run'); } }, { platform: 'yanxuan', keyword: '茶杯', signal: AbortSignal.abort() });
  assert.equal(result.coverage.status, 'aborted');
});
