import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildJdDetailReadScript, normalizeJdDetail } from '../server/collect/jd-detail-reader.mjs';

const source_url = 'https://item.jd.com/10179988291541.html';
const image_url = 'https://img10.360buyimg.com/pcpubliccms/s1440x1440_jfs/example.jpg.avif';
const specification = '四杯（混色）+小号杯架+沥水托盘';
const title = `雅港马克杯陶瓷杯家用喝水杯子咖啡杯情侣女生专用高颜值早餐杯泡茶杯 ${specification}`;
const fixture = overrides => ({
  status: 'ok', source_url, observed_at: '2026-10-31T17:28:47.911Z', title,
  price_text: '¥117.15', price_conditions: ['首单到手价'], secondary_price_text: '¥163.5',
  price_context: '¥117.15 首单到手价 ¥163.5 累计评价 0 降价通知',
  selected_specifications: [], specification_options: ['四杯（混色）', '四杯（混色）+小号杯架', specification],
  gallery: [{ url: image_url, container: '#spec-n1', natural_width: 1440, natural_height: 1440, sku: null }], ...overrides,
});

test('现代京东详情保留套装原文、首单价条件、灰色次价和AVIF自然尺寸', () => {
  const result = normalizeJdDetail(fixture(), { product_url: source_url, external_id: '10179988291541' });
  assert.equal(result.title, title);
  assert.equal(result.specifications, specification);
  assert.equal(result.specifications_basis, 'title_exact_option');
  assert.equal(result.price_amount, '117.15');
  assert.equal(result.currency, 'CNY');
  assert.deepEqual(result.price_conditions, ['首单到手价']);
  assert.equal(result.secondary_price_text, '¥163.5');
  assert.equal(Object.hasOwn(result, 'regular_price'), false);
  assert.equal(result.observation.price_context, fixture().price_context);
  assert.equal(result.image_url, image_url);
  assert.equal(result.image_natural_width, 1440);
  assert.equal(result.image_natural_height, 1440);
  assert.equal(result.observation.image_verification, 'dom_observed_only');
});

test('已选规格需同SKU，规格缺失留null，不把标题中的部分标签当完整规格', () => {
  const selected = normalizeJdDetail(fixture({ selected_specifications: [{ text: specification, sku: '10179988291541', href: source_url }] }));
  assert.equal(selected.specifications_basis, 'selected_dom');
  assert.equal(selected.specifications, specification);
  assert.deepEqual(selected.observation.selected_specifications[0], { text: specification, sku: '10179988291541', href: source_url });
  for (const item of [{ text: '单杯', sku: '999' }, { text: '单杯', href: 'https://item.jd.com/999.html' }]) {
    const result = normalizeJdDetail(fixture({ selected_specifications: [item], specification_options: [] }));
    assert.equal(result.specifications, null);
    assert.equal(result.specifications_basis, null);
  }
  assert.equal(normalizeJdDetail(fixture({ specification_options: ['四杯（混色）', '小号杯架', '沥水托盘'] })).specifications, null);
});

test('URL及ctx所有标识必须为同一真实京东SKU，否则不输出商品/价格/图', () => {
  for (const context of [{ source_url: 'https://item.jd.com/999.html' }, { product_url: source_url, sku: '999' }, { external_id: '999' }, { product_url: 'https://item.jd.com.evil.test/10179988291541.html' }]) {
    const result = normalizeJdDetail(fixture(), context);
    assert.equal(result.observation.status, 'product_identity_mismatch');
    for (const key of ['title', 'price_amount', 'image_url', 'source_url']) assert.equal(result[key], null);
  }
  for (const url of ['http://item.jd.com/10179988291541.html', 'https://u:p@item.jd.com/10179988291541.html', 'https://search.jd.com/Search?keyword=x']) {
    assert.equal(normalizeJdDetail(fixture({ source_url: url })).image_url, null);
  }
});

test('缺价、条件混合价、无币种不推断；缺图不阻断标题规格', () => {
  for (const price_text of [null, '117.15', '券后¥117.15起', '¥117.15-163.5']) {
    const result = normalizeJdDetail(fixture({ price_text, gallery: [] }));
    assert.equal(result.price_amount, null);
    assert.equal(result.currency, null);
    assert.equal(result.image_url, null);
    assert.equal(result.title, title);
    assert.equal(result.observation.status, 'ok');
  }
});

test('仅当前主图库CDN图，拒推荐/错SKU/认证/伪域名，不猜尺寸或改后缀', () => {
  const invalid = [
    { url: image_url, container: '.recommend' },
    { url: image_url, container: '#spec-n1', sku: '999' },
    { url: 'https://360buyimg.com.evil.test/p.jpg', container: '#spec-n1' },
    { url: 'https://u:p@img10.360buyimg.com/p.jpg', container: '#spec-n1' },
  ];
  for (const image of invalid) assert.equal(normalizeJdDetail(fixture({ gallery: [image] })).image_url, null);
  const result = normalizeJdDetail(fixture({ gallery: [...invalid, { url: image_url, container: '#spec-n1', natural_width: 0, natural_height: undefined }] }));
  assert.equal(result.image_url, image_url);
  assert.equal(result.image_natural_width, null);
  assert.equal(result.image_natural_height, null);
});

function readDom({ selected = false, rootMissing = false } = {}) {
  const node = (value, excluded = false, extra = {}) => ({ innerText: value, closest: () => excluded ? {} : null, getAttribute: () => null, ...extra });
  const root = { querySelectorAll(selector) {
    if (selector === '.sku-title-text') return [node('推荐商品单杯', true), node(title)];
    if (selector === '.product-price--main') return [node('¥1', true), node('¥117.15')];
    if (selector === '.product-price--activity-item') return [node('首单到手价')];
    if (selector === '.product-price--gray') return [node('¥163.5')];
    if (selector === '.product-price-panel') return [node(fixture().price_context)];
    if (selector.startsWith('#choose-attrs')) return selected ? [node('图标等辅助文案', false, { querySelector: () => node(specification), getAttribute: name => name === 'data-sku' ? '10179988291541' : null })] : [];
    if (selector === '.specification-item-sku-text') return fixture().specification_options.map(value => node(value));
    if (selector === '#spec-n1 img') return [node('', true, { currentSrc: 'https://img10.360buyimg.com/avatar.png' }), node('', false, { currentSrc: image_url, naturalWidth: 1440, naturalHeight: 1440 })];
    throw new Error(`unexpected selector ${selector}`);
  } };
  const raw = vm.runInNewContext(buildJdDetailReadScript(), {
    location: new URL(source_url), document: { querySelector(selector) {
      assert.ok(['.page-content-main', '.product-intro'].includes(selector));
      return rootMissing ? null : root;
    } },
  });
  return JSON.parse(JSON.stringify(raw));
}

test('只读脚本实际执行现代DOM selectors，过滤推荐头像，保持当前gallery自然尺寸', () => {
  const raw = readDom();
  assert.equal(raw.title, title);
  assert.equal(raw.price_text, '¥117.15');
  assert.deepEqual(raw.price_conditions, ['首单到手价']);
  assert.equal(raw.secondary_price_text, '¥163.5');
  assert.equal(raw.gallery.length, 1);
  assert.equal(raw.gallery[0].url, image_url);
  assert.equal(raw.gallery[0].natural_width, 1440);
  assert.equal(normalizeJdDetail(raw).specifications, specification);
  assert.equal(normalizeJdDetail(readDom({ selected: true })).specifications_basis, 'selected_dom');
});

test('缺少详情根节点清楚标识，空raw不会伪造观察', () => {
  assert.equal(normalizeJdDetail(readDom({ rootMissing: true })).observation.status, 'detail_root_missing');
  const empty = normalizeJdDetail(null);
  assert.equal(empty.title, null);
  assert.equal(empty.observation.observed_at, null);
  assert.equal(empty.image_url, null);
});
