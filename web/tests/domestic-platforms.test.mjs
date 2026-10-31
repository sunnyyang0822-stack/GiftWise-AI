import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMESTIC_PLATFORMS as platforms, normalizeDomesticRecord, buildDomesticReadScript, runDomesticSearch } from '../server/collect/domestic-platforms.mjs';

test('直接来源覆盖，搜索词编码与分页，不将官网探测称检索', () => {
  assert.equal(Object.keys(platforms).length, 13);
  for (const p of Object.values(platforms)) {
    assert.match(p.searchUrl('咖啡 & 茶'), /^https:\/\//);
    assert.doesNotThrow(() => new Function(`return ${buildDomesticReadScript(p.id)}`));
  }
  assert.equal(new URL(platforms.taobao.searchUrl('咖啡 & 茶', null, 2)).searchParams.get('s'), '44');
  assert.equal(new URL(platforms.jd.searchUrl('咖啡', null, 2)).searchParams.get('page'), '3');
  assert.equal(platforms.kuaishou.capability, 'homepage_probe_only');
  assert.equal(platforms.dewu.capability, 'homepage_probe_only');
  assert.throws(() => platforms.jd.searchUrl(' '));
});

test('仅国内直链；聚合或伪造子域不冒充直连', () => {
  const base = { title: '咖啡杯', price: '¥39.90' };
  for (const url of ['https://amazon.com/item/1', 'https://jd.com.evil.test/1', 'https://smzdm.com/p/1', 'javascript:alert(1)', '']) {
    assert.equal(normalizeDomesticRecord('jd', { ...base, url }), null);
  }
  assert.equal(normalizeDomesticRecord('jd', { ...base, url: 'https://item.jd.com/123.html' }).price_amount, '39.90');
});

test('价格条件、规格、单位与观察时间忠实保留，不编缺失字段', () => {
  const record = platforms['1688'].normalize({ title: '礼盒', item_url: 'https://detail.1688.com/offer/123.html', price_text: '¥12-18元/套', moq_text: '2套起批', seller_name: '礼品店', location: '杭州', condition: '红色' }, { keyword: '礼盒', scrapedAt: '2026-10-31T10:00:00Z' });
  assert.equal(record.price_text, '¥12-18元/套');
  assert.equal(record.price_amount, null);
  assert.equal(record.price_unit, '套');
  assert.deepEqual(record.price_conditions, ['2套起批']);
  assert.equal(record.specifications, '红色');
  assert.equal(record.location, '杭州');
  assert.equal(record.price_observed_at, '2026-10-31T10:00:00Z');
  assert.equal(record.image_url, null);
  const missing = platforms.jd.normalize({ title: '耳机', url: 'https://item.jd.com/1.html' });
  for (const key of ['price_amount', 'price_text', 'price_unit', 'currency', 'location', 'seller', 'scraped_at']) assert.equal(missing[key], null);
});

test('各平台商品URL与字段可归一化', () => {
  for (const p of Object.values(platforms)) {
    const record = p.normalize({ title: '测试', url: `https://${p.domains[0]}/product/1`, price: '19.90', image_url: 'https://evil.test/1.jpg' });
    assert.equal(record.source_site, p.source_site);
    assert.equal(record.price_amount, '19.90');
    assert.equal(record.image_url, null);
  }
});

test('待登录不伪装成功；已有有效页保留；没有抓取结果不抛业务失败', async () => {
  let n = 0;
  const page = { goto: async () => {}, wait: async () => {}, evaluate: async () => ++n === 1 ? { status: 'ok', records: [{ title: '杯子', url: 'https://item.jd.com/1.html' }] } : { status: 'login_required', records: [] } };
  const report = await runDomesticSearch(page, { platform: 'jd', keyword: '杯子', pages: 3 });
  assert.equal(report.records.length, 1);
  assert.equal(report.records[0].price_amount, null);
  assert.equal(report.pages_completed, 1);
  assert.equal(report.complete, false);
  assert.equal(report.status, 'login_required');
  assert.equal(report.coverage, 'partial_or_unavailable');
});

test('不重复首屏冒充分页或全量；页面异常被记录', async () => {
  const page = { goto: async () => {}, evaluate: async () => ({ status: 'ok', records: [{ title: '杯子', url: 'https://www.xiaomiyoupin.com/detail?gid=1' }] }) };
  const result = await runDomesticSearch(page, { platform: 'youpin', keyword: '杯子', pages: 4 });
  assert.equal(result.pages_completed, 1);
  assert.equal(result.complete, false);
  const failed = await runDomesticSearch({ goto: async () => { throw Object.assign(new Error('secret'), { code: 'TIMEOUT' }); } }, { platform: 'jd', keyword: '杯子' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.pages[0].error_code, 'TIMEOUT');
  assert.equal(JSON.stringify(failed).includes('secret'), false);
});
