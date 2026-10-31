import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySourceObservation, createSourceAvailabilityState, createSourceAvailabilityTracker } from '../server/retrieval/source-availability.mjs';

const tracker = options => createSourceAvailabilityTracker({ processState: createSourceAvailabilityState(), ...options });

test('真实搜索分页和详情嵌套coverage里的明确风控均暂停来源', () => {
  for (const coverage of [
    { status: 'ACCESS_RESTRICTED' },
    { status: 'partial', pages: [{ status: 'ok' }, { status: 'restricted' }] },
    [{ source: 'jd', status: 'partial', detail: { status: 'captcha_required' } }],
    { status: 'ok', detail_observation: { status: 'security_verification' } },
  ]) {
    const state = tracker();
    const result = state.observe({ sessionId: 'a', source: 'jd', coverage });
    assert.equal(result.status, 'paused');
    assert.equal(result.allow_request, false);
    assert.equal(result.scope, 'process_source');
    assert.equal(state.getAvailability({ sessionId: 'b', source: 'jd' }).allow_request, false);
    assert.equal(state.getAvailability({ sessionId: 'a', source: 'taobao' }).allow_request, true);
  }
});

test('只有明确安全提示文本触发，不扫描标题或通用limitations，不回传文本', () => {
  for (const safe_text of ['请完成验证码后继续', '请进行安全验证', '当前访问受限', 'Access Denied', '请求太频繁，请稍后再试']) {
    const state = tracker();
    assert.equal(state.observe({ source: 'taobao', safe_text }).allow_request, false);
    assert.equal(JSON.stringify(state.toModelContext()).includes(safe_text), false);
  }
  for (const input of [
    { status: 'ok', title: '验证码教学', limitations: ['可能需要安全验证'] },
    { status: 'ok', safe_text: '未出现验证码，无需安全验证' },
    { status: 'ok', coverage: [{ source: 'taobao', status: 'restricted' }] },
  ]) assert.equal(classifySourceObservation({ source: 'jd', ...input }).risk, false);
});

test('未知商品变化、普通失败、空结果和超时均非风控，不触发跨来源暂停', () => {
  const state = tracker();
  for (const status of ['detail_product_changed', 'product_identity_mismatch', 'empty_or_selector_changed', 'timeout', 'failed', 'unavailable', 'detail_read_failed']) {
    const result = state.observe({ source: 'jd', status });
    assert.equal(result.status, 'unknown', status);
    assert.equal(result.allow_request, true, status);
    assert.equal(result.reason_code, null, status);
    assert.equal(result.observed_status, status);
  }
  assert.equal(state.getAvailability({ source: 'taobao' }).allow_request, true);
});

test('进程状态跨tracker/会话保留；成功观察不能自动解封风控来源', () => {
  const shared = createSourceAvailabilityState();
  const first = createSourceAvailabilityTracker({ processState: shared });
  const second = createSourceAvailabilityTracker({ processState: shared });
  first.observe({ source: 'jd', sessionId: 'a', status: 'restricted', observation_id: 'risk1' });
  assert.equal(second.getAvailability({ source: 'jd', sessionId: 'b' }).allow_request, false);
  assert.equal(second.observe({ source: 'jd', status: 'ok' }).status, 'paused');
  assert.equal(second.getAvailability({ source: 'taobao' }).allow_request, true);
});

test('近期两次独立风控停止JD和淘宝直抓，重复汇总同一观察不计两次', () => {
  let time = 1000;
  const state = tracker({ now: () => time });
  const risk = { source: 'jd', status: 'restricted', observation_id: 'search-page1' };
  state.observe(risk);
  state.observe(risk);
  assert.equal(state.getAvailability({ source: 'taobao' }).allow_request, true);
  time += 100;
  state.observe({ source: 'jd', coverage: { detail: { status: 'restricted' } }, observation_id: 'detail-page1' });
  for (const source of ['jd', 'taobao']) {
    const result = state.getAvailability({ source, sessionId: 'new-session' });
    assert.equal(result.allow_request, false);
    assert.equal(result.scope, 'process_commerce');
    assert.equal(result.reason_code, 'repeated_commerce_risk');
  }
  // 非电商内容能力不因电商暂停而虚报已失效或已接通。
  assert.equal(state.getAvailability({ source: 'content_example' }).status, 'unknown');
  assert.equal(state.getAvailability({ source: 'content_example' }).allow_request, true);
});

test('时间窗外风险不累加；来源暂停不因时间流逝自动解除', () => {
  let time = 0;
  const state = tracker({ now: () => time, riskWindowMs: 1000 });
  state.observe({ source: 'jd', status: 'restricted' });
  time = 1001;
  state.observe({ source: 'jd', status: 'restricted' });
  assert.equal(state.getAvailability({ source: 'taobao' }).allow_request, true);
  assert.equal(state.getAvailability({ source: 'jd' }).allow_request, false);
  time += 1;
  state.observe({ source: 'taobao', status: 'captcha' });
  assert.equal(state.getAvailability({ source: 'jd' }).scope, 'process_commerce');
});

test('未登录作为会话限制，既不冒称风控也不累计电商风险', () => {
  const state = tracker();
  const result = state.observe({ source: 'jd', sessionId: 'a', status: 'LOGIN_REQUIRED' });
  assert.equal(result.status, 'login_required');
  assert.equal(result.allow_request, false);
  assert.equal(result.scope, 'session_source');
  assert.equal(result.reason_code, 'login_required');
  assert.equal(state.getAvailability({ source: 'jd', sessionId: 'b' }).allow_request, true);
  state.observe({ source: 'taobao', status: 'restricted' });
  assert.equal(state.getAvailability({ source: 'taobao' }).scope, 'process_source');
});

test('模型上下文保持最终建议可用，替代来源能力未知、不自动绕过来源暂停', () => {
  const state = tracker();
  state.observe({ source: 'jd', status: 'restricted' });
  const view = state.toModelContext({ sources: ['jd', 'taobao', 'jd'] });
  assert.equal(view.source_availability.length, 2);
  assert.equal(view.recommendations_available, true);
  assert.equal(view.alternatives.find(item => item.kind === 'model_suggestion').available, true);
  assert.equal(view.alternatives.find(item => item.kind === 'content_inspiration').available, null);
  assert.match(view.instruction, /停止.*搜索、详情、分页或重试/);
  assert.match(view.alternatives.at(-1).hint, /不得用切换账号、身份或端口/);
});

test('非法来源不允许请求，非法阈值不静默放宽', () => {
  assert.equal(tracker().getAvailability({ source: '../jd' }).allow_request, false);
  for (const options of [{ repeatThreshold: 1 }, { riskWindowMs: 0 }]) assert.throws(() => tracker(options), /INVALID_SOURCE_AVAILABILITY_POLICY/);
});
