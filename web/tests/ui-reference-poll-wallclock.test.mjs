import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecommendationMedia } from "../public/js/recommendation-media.js";
import { setup, fixture, flush } from "./helpers/reference-poll-clock.mjs";

test("早期0.5秒、后期回退的绝对目标最多60读，180秒结束", async () => {
  const h = setup(createRecommendationMedia);
  while (h.timers.size && h.calls.length < 100) await h.next();
  assert.deepEqual(h.calls.slice(0, 20).map(c => c.startedAt), Array.from({ length: 20 }, (_, i) => (i + 1) * 500));
  assert.deepEqual(h.calls.slice(20, 23).map(c => c.startedAt), [11000, 12000, 13000]);
  assert.deepEqual(h.calls.slice(30, 33).map(c => c.startedAt), [22000, 24000, 26000]);
  assert.deepEqual(h.calls.slice(40, 43).map(c => c.startedAt), [44000, 48000, 52000]);
  assert.deepEqual(h.calls.slice(45, 48).map(c => c.startedAt), [68000, 76000, 84000]);
  assert.equal(h.calls.length, 60); assert.equal(h.now, 180000); assert.equal(h.timers.size, 0); assert.equal(h.maxInFlight, 1);
  assert.ok(h.calls.every(c => c.args[1] === null && c.args[2].timeoutMs === 10000 && c.args[2].track === false));
});

test("8.25秒API就绪且80ms读取耗时时，8.58秒补入三图而非等待15秒", async () => {
  const h = setup(createRecommendationMedia, { readyAt: 8250, latency: 80 });
  while (h.timers.size && !h.root.querySelector("img")) await h.next();
  assert.equal(h.now, 8580); assert.equal(h.calls.length, 17); assert.equal(h.root.querySelectorAll("img").length, 3);
  assert.deepEqual(h.calls.slice(0, 3).map(c => c.startedAt), [500, 1000, 1500], "GET耗时不累加到后续周期");
  assert.equal(h.timers.size, 0); assert.equal(h.maxInFlight, 1);
});

test("9秒慢GET计入墙钟且跳过过期检查点，不补发，末读最多再用10秒", async () => {
  const h = setup(createRecommendationMedia, { latency: 9000 });
  while (h.timers.size && h.calls.length < 100) await h.next();
  assert.ok(h.calls.length < 60); assert.equal(h.calls.at(-1).startedAt, 180000);
  assert.equal(h.now, 189000); assert.equal(h.timers.size, 0); assert.equal(h.maxInFlight, 1);
  assert.ok(h.state.report.media.candidates.every(c => c.status === "pending"));
  h.mount(); assert.equal(h.timers.size, 0);
});

test("超截止才运行的旧timer不自动补发，即使是最后计划检查点", async () => {
  const h = setup(createRecommendationMedia); h.advance(180001); await h.next();
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
  const last = setup(createRecommendationMedia); for (let i = 0; i < 59; i++) await last.next();
  last.advance(8001); await last.next(); assert.equal(last.calls.length, 59); assert.equal(last.timers.size, 0);
});

test("到期后手动只读一次不重开自动预算，重复点击仍单在途", async () => {
  let resolve; let held = false;
  const h = setup(createRecommendationMedia, { fetcher: async () => held ? new Promise(done => { resolve = done; }) : { ok: true, status: 200, data: fixture() } });
  while (h.timers.size && h.calls.length < 100) await h.next(); held = true;
  const button = h.root.querySelectorAll("button").find(b => b.textContent === "刷新配图");
  button.events.click(); button.events.click(); assert.equal(h.calls.length, 61); assert.equal(h.maxInFlight, 1);
  resolve({ ok: true, status: 200, data: fixture() }); await flush();
  assert.equal(h.timers.size, 0); assert.ok(h.state.report.media.candidates.every(c => c.status === "pending"));
});

test("缓存首份三ready零轮询；读取跨截止也不会在响应后延长窗口", async () => {
  const ready = setup(createRecommendationMedia, { initial: fixture(true) });
  assert.equal(ready.timers.size, 0); assert.equal(ready.calls.length, 0); assert.equal(ready.root.querySelectorAll("img").length, 3);
  let resolve; const waiting = setup(createRecommendationMedia, { fetcher: () => new Promise(done => { resolve = done; }) });
  await waiting.next(); waiting.advance(180000); waiting.mount();
  assert.equal(waiting.calls.length, 1); resolve({ ok: true, status: 200, data: fixture() }); await flush();
  assert.equal(waiting.timers.size, 0); assert.match(waiting.root.textContent, /配图还在准备/);
});

test("无图的真实内容参考不启动图片轮询，也不改写正文或可选性", () => {
  const initial = fixture();
  initial.selectable_candidate_ids = ["c1", "c2", "c3"];
  initial.candidates[0].description = "根据已检索教程整理的建议";
  initial.retrieval.references = [{ reference_id: "text-only", source_url: "https://content.example/tutorial", summary: "真实文本资料的受控协议示例", image_id: null }];
  initial.media.candidates.forEach(slot => { slot.status = "unavailable"; });
  const h = setup(createRecommendationMedia, { initial });
  assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0); assert.equal(h.root.querySelectorAll("img").length, 0);
  assert.deepEqual(h.state.report, initial);
});
