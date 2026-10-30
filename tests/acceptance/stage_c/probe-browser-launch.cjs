// QA-001 最小浏览器启动探针：确认在受限沙箱内 playwright-core + 项目专用 profile 可用。
const path = require('node:path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'workflow', 'tools', 'node_modules', 'playwright-core'));
const PROFILE = path.join(__dirname, '..', '..', '..', 'workflow', 'tools', 'dify-browser-profile-chrome');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('about:blank');
  console.log(JSON.stringify({ ok: true, version: context.browser() ? context.browser().version() : null, pages: context.pages().length }));
  await context.close();
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e).slice(0, 600) })); process.exitCode = 1; });
