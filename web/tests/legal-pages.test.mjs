import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// 2026-10-31 用户决定：网站不再提供隐私政策与使用条款页面，首页也不再展示任何政策入口。
const read = name => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

test("首页保留页脚但不再展示政策入口；没有预算额外确认框", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  assert.match(html, /<footer[^>]*class="[^"]*\bapp-footer\b/);
  assert.match(html, /id="footer-meta"/);
  assert.doesNotMatch(html, /href="\/(privacy|terms)\.html"/);
  assert.doesNotMatch(app, /id:\s*"budget-confirm"/);
  assert.doesNotMatch(app, /querySelector\("\.app-footer"\)\.hidden = true/);
});
