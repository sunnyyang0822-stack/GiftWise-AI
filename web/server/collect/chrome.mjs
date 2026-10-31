/**
 * 专用无头浏览器的生命周期管理（CDP）。
 *
 * 为什么需要它：opencli 2.0.2 的 170 个站点适配器全部标记 `browser: true`，
 * 默认走 Browser Bridge **扩展**；本机没装该扩展，直接跑会得到
 * BROWSER_CONNECT(69)。opencli 支持 `OPENCLI_CDP_ENDPOINT` 直连 CDP
 * （getBrowserFactory() → CDPBridge），因此采集器自己拉起一个**专用**的
 * 无头 Chrome，只用它采集公开、免登录的页面。
 *
 * 安全边界（重要）：
 *   - 只监听 127.0.0.1，不对外暴露调试端口。
 *   - 使用本仓库 .tmp/ 下的**独立 profile**，绝不连接、绝不读取用户日常
 *     Chrome profile，因此不会碰到任何个人账号或 cookie。
 *   - 不执行任何登录动作。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../localdb/db.mjs';

const CANDIDATE_CHROME = [
  process.env.GW_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export function findChrome() {
  for (const p of CANDIDATE_CHROME) if (existsSync(p)) return p;
  return null;
}

async function cdpAlive(port, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 确保 127.0.0.1:<port> 上有一个可用的 CDP 浏览器。
 * 端口已有 CDP 时**复用**（不杀别人的进程）；否则用专用 profile 拉起一个，
 * 并在返回的 stop() 里只结束自己拉起的那个进程。
 */
export async function ensureChrome({ port = 19360, profileDir, startupTimeoutMs = 30000, log = () => {} } = {}) {
  const endpoint = `http://127.0.0.1:${port}`;
  if (await cdpAlive(port)) {
    log(`复用已存在的 CDP 浏览器：${endpoint}（不结束该进程）`);
    return { endpoint, started: false, stop: async () => {} };
  }

  const exe = findChrome();
  if (!exe) {
    throw Object.assign(new Error('找不到 Chrome/Chromium 可执行文件；请设置 GW_CHROME_PATH'), {
      code: 'CHROME_NOT_FOUND',
    });
  }

  const profile = profileDir || join(REPO_ROOT, '.tmp', 'opencli-cdp-profile');
  mkdirSync(profile, { recursive: true });

  const args = [
    '--headless=new',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    'about:blank',
  ];
  log(`启动专用无头浏览器：${exe}（profile=${profile}，端口 ${port}，仅本机）`);
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true, detached: false });
  child.unref?.();

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (await cdpAlive(port)) {
      log(`CDP 就绪：${endpoint}`);
      return {
        endpoint,
        started: true,
        stop: async () => stopChrome(child),
      };
    }
    if (child.exitCode !== null) {
      throw Object.assign(new Error(`专用浏览器启动即退出（exitCode=${child.exitCode}）`), {
        code: 'CHROME_EXITED',
      });
    }
    await sleep(400);
  }
  await stopChrome(child);
  throw Object.assign(new Error(`${startupTimeoutMs}ms 内未等到 CDP 就绪（端口 ${port}）`), {
    code: 'CHROME_TIMEOUT',
  });
}

async function stopChrome(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      const { execFile } = await import('node:child_process');
      await new Promise((r) => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => r()));
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* 结束失败不影响主流程；进程会随会话结束退出 */
  }
}
