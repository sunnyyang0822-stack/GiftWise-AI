import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");
for (const name of ["privacy.html", "terms.html"]) {
  const html = await read(name);
  test(`${name} 编码、确认的运营信息与邮箱`, () => {
    assert.match(html, /charset="utf-8"/);
    assert.match(html, /运营者：杨桐/);
    assert.match(html, /href="mailto:yt08_22@163.com"/);
    assert.doesNotMatch(html, /运营者或联系邮箱待补齐|\uFFFD/);
  });
  test(`${name} 目录锚点与页面导航`, () => {
    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(html.includes(`id="${match[1]}"`), match[1]);
    }
    assert.match(html, /href="\/privacy.html"/);
    assert.match(html, /href="\/terms.html"/);
    assert.match(html, /href="\/"/);
  });
  test(`${name} 只使用本地样式，不加载脚本`, () => {
    assert.match(html, /href="\/legal.css"/);
    assert.doesNotMatch(html, /<script\b|<link[^>]+href="https?:/i);
  });
}
test("首页和流程共用页脚入口；没有预算额外确认框", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  assert.match(html, /<footer[\s\S]*aria-label="隐私与使用条款"/);
  assert.match(html, /href="\/privacy.html" target="_blank"/);
  assert.match(html, /href="\/terms.html" target="_blank"/);
  assert.doesNotMatch(app, /id:\s*"budget-confirm"/);
  assert.doesNotMatch(app, /querySelector\("\.app-footer"\)\.hidden = true/);
});
