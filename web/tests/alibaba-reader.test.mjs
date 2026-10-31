import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { canonicalAlibabaProductUrl, parseAlibabaPrice, normalizeAlibabaRecord, buildAlibabaSearchReadScript, buildAlibabaDetailReadScript, readAlibabaSearch, readAlibabaDetail } from '../server/collect/alibaba-reader.mjs';

test('规范商品URL只保留真实item/sku ID，拒绝追踪ID、伪子域和无身份链接', () => {
  assert.equal(canonicalAlibabaProductUrl('taobao', 'https://item.taobao.com/item.htm?id=123&skuId=456&spm=removed&session=removed'), 'https://item.taobao.com/item.htm?id=123&skuId=456');
  assert.equal(canonicalAlibabaProductUrl('tmall', '//detail.tmall.com/item.htm?spm=removed&id=123&sku_id=456'), 'https://detail.tmall.com/item.htm?id=123&skuId=456');
  assert.equal(canonicalAlibabaProductUrl('1688', 'https://detail.m.1688.com/page/index.html?offerId=123&spm=removed'), 'https://detail.1688.com/offer/123.html');
  assert.equal(canonicalAlibabaProductUrl('1688', '', { observedOfferId: '123' }), 'https://detail.1688.com/offer/123.html');
  for (const url of ['https://detail.1688.com.evil.test/offer/123.html', 'https://detail.1688.com/offer/not-id.html', 'javascript:void(0)', 'https://s.1688.com/?id=123']) assert.equal(canonicalAlibabaProductUrl('1688', url), null);
  assert.equal(canonicalAlibabaProductUrl('1688', 'https://detail.1688.com/offer/123.html', { observedOfferId: '456' }), null);
  assert.equal(canonicalAlibabaProductUrl('taobao', 'https://item.taobao.com/item.htm?spm=123'), null);
});

test('真实观察到的价格污染格式只提取价格数值和条件，不拼入销量地名', () => {
  const price = parseAlibabaPrice({ price_text: '¥ 21 .1 券后价 400+人付款 福建 泉州' });
  assert.equal(price.price_text, '¥21.1');
  assert.equal(price.price_amount, '21.1');
  assert.deepEqual(price.price_conditions, ['券后价']);
  assert.equal(price.price_kind, 'conditional');
  const noCoupon = parseAlibabaPrice({ price_text: '¥ 2 .8 4000+人付款 湖南 株洲' });
  assert.equal(noCoupon.price_amount, '2.8');
  assert.equal(noCoupon.price_text.includes('4000'), false);
  const split = parseAlibabaPrice({ price_integer: '12', price_decimal: '.09', currency_evidence: '¥', price_text: '污染片段不会替代专用整数小数节点', price_conditions: ['券后价'] });
  assert.equal(split.price_amount, '12.09');
  assert.equal(parseAlibabaPrice({ price_text: '券后价 ¥19.9' }).price_amount, '19.9');
});

test('区间/起批/单位/未知币种保真，不拿销量当价格', () => {
  const range = parseAlibabaPrice({ price_text: '¥12.5-15.8元/个', moq_text: '2个起批' });
  assert.equal(range.price_amount, null);
  assert.equal(range.price_min, '12.5');
  assert.equal(range.price_max, '15.8');
  assert.equal(range.price_unit, '个');
  assert.deepEqual(range.price_conditions, ['2个起批']);
  assert.equal(parseAlibabaPrice({ price_text: '¥12起' }).price_min, '12');
  for (const raw of [{ price_text: '400人付款' }, { price_text: '400人付款 云南 元江' }, { price_text: 'USD 9.99' }, { price_integer: '99', currency: 'USD' }, {}]) {
    const record = parseAlibabaPrice(raw);
    assert.equal(record.price_amount, null);
    assert.equal(record.currency, null);
  }
  assert.equal(parseAlibabaPrice({ price_text: '400人付款 云南 元江' }).price_text, null);
});

function card({ offerId, href, title = '咖啡杯', integer = '21', decimal = '.1' } = {}) {
  const node = value => ({ innerText: value, getAttribute: () => null });
  const anchor = { href, getAttribute: () => null };
  return {
    getAttribute: name => name === 'data-offer-id' ? offerId || null : name === 'data-spm-act-id' ? '9999999999' : null,
    querySelectorAll: selector => selector === 'a[href]' ? (href ? [anchor] : []) : [],
    querySelector: selector => {
      if (selector.includes('title')) return node(title);
      if (selector.includes('priceInt--') || selector.includes('price-integer')) return integer ? node(integer) : null;
      if (selector.includes('priceFloat--') || selector.includes('price-decimal')) return decimal ? node(decimal) : null;
      if (selector.includes('priceSymbol--')) return node('¥');
      if (selector.includes('price--') || selector.includes('offer-price')) return node('¥ 21 .1 券后价 400+人付款 福建 泉州');
      if (selector.startsWith('img')) return { currentSrc: 'https://img.alicdn.com/product.jpg', alt: title, getAttribute: () => null };
      return null;
    },
  };
}

function searchContext(platform, cards) {
  const document = { body: { innerText: '' }, querySelectorAll: selector => selector.startsWith('a[href*=') ? [] : cards };
  Object.defineProperty(document, 'cookie', { get: () => { throw new Error('不允许读取Cookie'); } });
  return { URL, location: new URL(platform === '1688' ? 'https://s.1688.com/selloffer/offer_search.htm' : 'https://s.taobao.com/search'), document };
}

test('1688只从实际offer属性/直链确认商品；0有效直链不得status ok', () => {
  const result = vm.runInNewContext(buildAlibabaSearchReadScript('1688'), searchContext('1688', [card({ offerId: '123' }), card({ href: 'https://detail.1688.com/offer/456.html?spm=removed' }), card()]));
  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 2);
  assert.equal(result.diagnostics.missing_product_identity, 1);
  assert.equal(result.records[0].product_url, 'https://detail.1688.com/offer/123.html');
  const noIdentity = vm.runInNewContext(buildAlibabaSearchReadScript('1688'), searchContext('1688', [card()]));
  assert.equal(noIdentity.status, 'no_valid_product_links');
  assert.equal(noIdentity.records.length, 0);
});

test('淘宝现代整数/小数/专用条件节点与规范URL被纯归一化使用', async () => {
  const context = searchContext('taobao', [card({ href: 'https://item.taobao.com/item.htm?id=123&skuId=456&spm=removed' })]);
  const page = { evaluate: async script => vm.runInNewContext(script, context) };
  const result = await readAlibabaSearch(page, { platform: 'taobao', keyword: '咖啡杯' });
  assert.equal(result.records.length, 1);
  const product = result.records[0];
  assert.equal(product.price_amount, '21.1');
  assert.equal(product.product_url, 'https://item.taobao.com/item.htm?id=123&skuId=456');
  assert.equal(product.sku_id, '456');
  assert.equal(product.image_provenance.validation_status, 'not_fetched');
  assert.equal(product.image_validation, null);
  assert.equal(normalizeAlibabaRecord('taobao', { title: '无链接', item_id: '123' }), null);
});

function detailContext({ specs = true, title = true, image = true } = {}) {
  const node = (innerText, recommended = false) => ({ innerText, closest: () => recommended ? {} : null, getAttribute: () => null });
  const imageNode = (url, recommended = false) => ({ closest: () => recommended ? {} : null, getAttribute: key => key === 'data-origin' ? url : null });
  const selected = { ...node('黑色；标准杯碟'), getAttribute: key => key === 'data-sku-id' ? '456' : null };
  const root = { querySelectorAll: selector => {
    if (selector.includes('mainTitle--')) return title ? [node('推荐商品', true), node('当前商品')] : [];
    if (selector.includes('Price--priceText')) return [node('39.9')];
    if (selector.startsWith('[class*="Price--"]')) return [node('¥39.9 券后价')];
    if (selector.includes('skuItem--')) return specs ? [selected] : [];
    if (selector.startsWith('#J_ImgBooth')) return image ? [imageNode('https://img.alicdn.com/recommend.jpg', true), imageNode('https://img.alicdn.com/current.jpg')] : [];
    throw new Error('不得查询全页图片或价格');
  } };
  return { URL, location: new URL('https://item.taobao.com/item.htm?id=123&spm=removed'), document: { body: { innerText: '' }, querySelector: () => root } };
}

test('淘宝天猫详情只读已选SKU/当前gallery，未选规格和无图保留null', async () => {
  for (const platform of ['taobao', 'tmall']) {
    const context = detailContext();
    const result = await readAlibabaDetail({ evaluate: async script => vm.runInNewContext(script, context) }, { platform, productUrl: 'https://item.taobao.com/item.htm?id=123' });
    assert.equal(result.status, 'ok');
    assert.equal(result.record.title, '当前商品');
    assert.equal(result.record.specifications, '黑色；标准杯碟');
    assert.equal(result.record.sku_id, '456');
    assert.equal(result.record.price_amount, '39.9');
    assert.equal(result.record.image_urls.length, 1);
    assert.equal(result.record.image_url, 'https://img.alicdn.com/current.jpg');
  }
  const missing = vm.runInNewContext(buildAlibabaDetailReadScript('taobao'), detailContext({ specs: false, image: false }));
  assert.equal(missing.specifications, null);
  assert.equal(missing.image_url, null);
});

test('详情换商品拒绝绑定、非法URL不读取页面；未知价图不使有效商品消失', async () => {
  const changed = await readAlibabaDetail({ evaluate: async script => vm.runInNewContext(script, detailContext()) }, { platform: 'taobao', productUrl: 'https://item.taobao.com/item.htm?id=999' });
  assert.equal(changed.status, 'product_changed');
  assert.equal(changed.record, null);
  const invalid = await readAlibabaDetail({ evaluate: async () => { throw new Error('must not execute'); } }, { platform: 'taobao', productUrl: 'https://evil.test/item.htm?id=123' });
  assert.equal(invalid.status, 'product_url_not_allowed');
  const missing = normalizeAlibabaRecord('tmall', { title: '有效商品', url: 'https://detail.tmall.com/item.htm?id=123' });
  assert.equal(missing.price_amount, null);
  assert.equal(missing.image_url, null);
  assert.equal(missing.title, '有效商品');
});
