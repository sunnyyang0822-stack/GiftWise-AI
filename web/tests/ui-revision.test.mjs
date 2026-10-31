import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
]);

for (const id of ["badges", "banner-slot", "mode-flag", "hero-flag", "footer-meta", "view", "cta-start", "cta-start-2", "hero", "how", "steps", "live"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
}
assert.match(html, /tokens\.css[\s\S]*styles\.css[\s\S]*landing\.css/, "stylesheet order changed");
assert.match(html, /id=["']welcome["']/);
assert.match(html, /id=["']cta-welcome["']/);
assert.match(app, /STEP_TITLES = \["关系场合预算时间", "兴趣风格", "需要避免的与补充"\]/);
assert.match(app, /budget_min/);
assert.match(app, /type:\s*["']range["']/);
assert.match(app, /recipient_relation_other/);
assert.match(app, /occasion_other/);
assert.match(app, /其他关系/);
assert.match(app, /其他送礼场合/);
assert.match(app, /请填写你与对方的关系/);
assert.match(app, /请填写具体送礼场合/);
assert.match(app, /recipient_relation === "other"/);
assert.match(app, /occasion === "other"/);
assert.match(app, /if \(f\.recipient_relation !== "other"\) f\.recipient_relation_other = ""/);
assert.match(app, /if \(f\.occasion !== "other"\) f\.occasion_other = ""/);
assert.match(app, /if \(f\.recipient_relation === "other"\) intake\.recipient_relation_custom/);
assert.match(app, /if \(f\.occasion === "other"\) intake\.occasion_custom/);
assert.match(app, /\/api\/exclusions\/analyze/);
assert.match(app, /exclusion_confirmation/);
assert.match(app, /gift_estimated_total/);
assert.doesNotMatch(app, /parseTerms\(/, "legacy free-text exclusion parser remains");
assert.doesNotMatch(app, /演示开关/, "engineering demo switch leaked into UI code");
assert.match(css, /budget-sliders/);
console.log("ui-revision: 28 assertions passed");
