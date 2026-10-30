// QA-001 专用 Dify 浏览器执行器（独立复核用）。
// 与 workflow/tools/dify-runner.cjs 分离，原因：测试 Agent 不修改 workflow/ 目录，
// 且本轮证据需落在 docs/test-reports/ 下。
// 只使用项目专用登录配置目录 workflow/tools/dify-browser-profile-chrome；
// 不读取个人 Chrome 配置、Cookie、API Key 或任何凭证；不打印凭证。
// 用法: node tests/acceptance/stage_c/dify-qa-runner.cjs <steps.json>
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'workflow', 'tools', 'node_modules', 'playwright-core'));

const REPO = path.join(__dirname, '..', '..', '..');
const PROFILE = path.join(REPO, 'workflow', 'tools', 'dify-browser-profile-chrome');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.join(REPO, 'docs', 'test-reports', 'stage-c', 'evidence');
const SHOTS = path.join(OUT, 'shots');
const QA_JS = path.join(__dirname, 'qa-js');

const results = [];
function record(entry) {
  results.push(entry);
  fs.appendFileSync(path.join(OUT, 'qa-runner-log.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
  console.log(JSON.stringify(entry));
}

(async () => {
  const stepsFile = process.argv[2];
  if (!stepsFile) throw new Error('missing steps file');
  const steps = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
  fs.mkdirSync(SHOTS, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: ['--no-first-run', '--no-default-browser-check']
  });
  const page = context.pages()[0] || (await context.newPage());

  const traffic = [];
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/console/api/')) {
      traffic.push({
        url,
        status: response.status(),
        method: response.request().method(),
        at: new Date().toISOString()
      });
    }
  });
  const runRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/workflow-runs|draft\/run|workflows\/run|trace-runs/.test(url)) {
      runRequests.push({
        url,
        method: request.method(),
        postData: (request.postData() || '').slice(0, 2000),
        at: new Date().toISOString()
      });
    }
  });

  async function text() {
    try {
      return (await page.locator('body').innerText()).slice(0, 30000);
    } catch (error) {
      return '<text error: ' + error.message + '>';
    }
  }

  function loadCode(step) {
    if (step.codeFile) {
      const file = path.isAbsolute(step.codeFile) ? step.codeFile : path.join(QA_JS, step.codeFile);
      return fs.readFileSync(file, 'utf8');
    }
    return step.code;
  }

  try {
    for (const step of steps) {
      const label = step.label || step.action;
      try {
        if (step.action === 'goto') {
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          record({ step: label, url: page.url(), title: await page.title() });
        } else if (step.action === 'wait') {
          await page.waitForTimeout(step.ms || 1000);
          record({ step: label, ms: step.ms || 1000, url: page.url() });
        } else if (step.action === 'snapshot') {
          record({ step: label, url: page.url(), text: await text() });
        } else if (step.action === 'screenshot') {
          const file = path.join(SHOTS, step.file);
          await page.screenshot({ path: file, fullPage: !!step.full });
          record({ step: label, file: path.relative(REPO, file) });
        } else if (step.action === 'click_role') {
          const locator = page.getByRole(step.role, { name: step.name });
          const count = await locator.count();
          if (count === 0) throw new Error('no element for role=' + step.role + ' name=' + step.name);
          await locator.first().click({ timeout: step.timeout || 25000 });
          await page.waitForTimeout(step.settle || 1500);
          record({ step: label, matched: count });
        } else if (step.action === 'click_sel') {
          const locator = page.locator(step.selector);
          const count = await locator.count();
          if (count === 0) throw new Error('no element for selector=' + step.selector);
          await locator.nth(step.nth || 0).click({ timeout: step.timeout || 25000 });
          await page.waitForTimeout(step.settle || 1500);
          record({ step: label, matched: count });
        } else if (step.action === 'inspect') {
          const nodes = await page.locator(step.selector).evaluateAll((list) =>
            list.map((n) => ({
              tag: n.tagName,
              role: n.getAttribute('role'),
              text: (n.innerText || '').slice(0, 120),
              ariaSelected: n.getAttribute('aria-selected'),
              disabled: n.disabled === true
            }))
          );
          record({ step: label, selector: step.selector, count: nodes.length, nodes });
        } else if (step.action === 'eval') {
          const value = await page.evaluate(loadCode(step));
          record({ step: label, value });
        } else if (step.action === 'traffic') {
          record({ step: label, traffic: traffic.slice(-step.last || -8), runRequests: runRequests.slice(-12) });
        } else {
          record({ step: label, error: 'unknown_action' });
        }
      } catch (error) {
        record({ step: label, action: step.action, error: error.message });
      }
    }
  } finally {
    record({ step: 'final', url: page.url() });
    await context.close();
  }
})().catch((error) => {
  record({ step: 'fatal', error: error.message, stack: String(error.stack).slice(0, 1500) });
  process.exitCode = 1;
});
