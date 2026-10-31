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
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { REPO_ROOT } from '../localdb/db.mjs';
import { taskPath, taskDirectory, taskProcessEnv } from './task-paths.mjs';

const CANDIDATE_CHROME = [
  process.env.GW_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/google-chrome',
].filter(Boolean);

export function findChrome() {
  for (const p of CANDIDATE_CHROME) if (existsSync(p) && /^(chrome\.exe|google-chrome|chrome)$/i.test(basename(p))) return p;
  return null;
}

export function projectPath(path) {
  return taskPath(path);
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
 * 端口已有 CDP 时拒绝连接；否则用专用 profile 拉起一个，
 * 并在返回的 stop() 里只结束自己拉起的那个进程。
 */
export async function ensureChrome({ port = 19360, profileDir, headless = true, startupTimeoutMs = 30000, log = () => {} } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_CDP_PORT');
  const profile = projectPath(profileDir || join(REPO_ROOT, '.tmp', 'opencli-cdp-profile'));
  const endpoint = `http://127.0.0.1:${port}`;
  if (await cdpAlive(port)) {
    throw Object.assign(new Error(`端口 ${port} 已占用；不会连接其他浏览器，请为当前任务选择空闲端口`), { code: 'CDP_PORT_IN_USE' });
  }

  const exe = findChrome();
  if (!exe) {
    throw Object.assign(new Error('找不到 Google Chrome 可执行文件；请设置 GW_CHROME_PATH（不自动改用其他浏览器）'), {
      code: 'CHROME_NOT_FOUND',
    });
  }

  taskDirectory(profile);
  const runtimeDir = taskDirectory(join(REPO_ROOT, '.tmp/domestic-runtime'));
  const childEnv = taskProcessEnv(process.env, runtimeDir);

  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--disk-cache-dir=${taskDirectory(join(runtimeDir, 'chrome-cache'))}`,
    `--crash-dumps-dir=${taskDirectory(join(runtimeDir, 'crash-dumps'))}`,
    '--disable-breakpad',
    '--disable-component-update',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    'about:blank',
  ];
  log(`启动项目专用浏览器：${exe}（profile=${profile}，端口 ${port}，仅本机，${headless ? '后台' : '可见登录窗口'}）`);
  const child = spawn(exe, args, { env: childEnv, cwd: REPO_ROOT, stdio: 'ignore', windowsHide: headless, detached: false, shell: false });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  child.unref?.();

  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw Object.assign(new Error('Google Chrome 启动失败'), { code: 'CHROME_START_FAILED' });
    if (await cdpAlive(port)) {
      log(`CDP 就绪：${endpoint}`);
      return {
        endpoint,
        started: true,
        pid: child.pid,
        profileDir: profile,
        executable: exe,
        runtimeDir,
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
