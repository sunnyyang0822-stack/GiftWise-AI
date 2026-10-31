/**
 * 服务进程自证块（防「旧进程冒充新代码」）。
 *
 * 本项目已经出现过「旧进程还在跑、却按新代码验收」这类假通过，因此每个响应都带上：
 *   - `pid`：处理这次请求的进程号；
 *   - `code_revision`：本进程启动时算出的**源码内容哈希**（不是时间戳、不是 git 分支名）；
 *   - `started_at` / `uptime_ms`：这进程活了多久；
 *   - `stale`：调用方在请求里带了 `client_code_revision` / `x-giftwise-code-revision` 时，
 *     与本进程的修订比对；不一致即 `stale=true` + 中文原因，**不冒充**。
 *
 * 哈希口径：把一组服务端源文件按路径排序后，取「路径 + 文件字节」再哈希，取前 16 位十六进制。
 * 这样「改了一个字节」与「没改」可以区分；且它是内容哈希，不依赖 git（工作区未提交改动也算得出来）。
 * ⛔ 不参与哈希：任何密钥、环境变量值、.env。
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_ROOT = fileURLToPath(new URL('./', import.meta.url));
export const REPO_WEB_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** 参与修订哈希的源文件根目录（相对 web/）。 */
const HASH_ROOTS = Object.freeze(['server', 'tools/smoke-http.mjs']);

function collectFiles(absolute) {
  const out = [];
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    out.push(absolute);
    return out;
  }
  for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(child));
    else if (entry.isFile() && /\.(mjs|js|json)$/.test(entry.name)) out.push(child);
  }
  return out;
}

/**
 * 计算服务端源码修订（内容哈希，前 16 位十六进制）。
 * 可用 `GIFTWISE_CODE_REVISION` 显式覆盖（部署时注入构建号时用）。
 */
export function computeCodeRevision({ override = process.env.GIFTWISE_CODE_REVISION } = {}) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  const hash = createHash('sha256');
  const files = [];
  for (const root of HASH_ROOTS) files.push(...collectFiles(join(REPO_WEB_ROOT, root)));
  files.sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    hash.update(relative(REPO_WEB_ROOT, file).split(sep).join('/'));
    hash.update('\u0000');
    try {
      hash.update(readFileSync(file));
    } catch {
      hash.update('<unreadable>');
    }
    hash.update('\u0000');
  }
  return hash.digest('hex').slice(0, 16);
}

export const CODE_REVISION = computeCodeRevision();
export const STARTED_AT = new Date().toISOString();
export const STARTED_MS = Date.now();
export const PID = process.pid;

/** 本进程的自证块。传入调用方声明的修订即可判定 stale。 */
export function attestation({ clientCodeRevision = null } = {}) {
  const declared = typeof clientCodeRevision === 'string' && clientCodeRevision.trim() ? clientCodeRevision.trim() : null;
  const stale = Boolean(declared) && declared !== CODE_REVISION;
  return {
    pid: PID,
    code_revision: CODE_REVISION,
    started_at: STARTED_AT,
    uptime_ms: Date.now() - STARTED_MS,
    revision_source: 'sha256(web/server/** 内容) 前 16 位',
    stale,
    stale_reason: stale
      ? `调用方声明的代码修订（${declared}）与本进程正在运行的修订（${CODE_REVISION}）不一致：这很可能是旧进程在冒充新代码，请重启服务后重试。`
      : null,
  };
}

/** 从请求头里取调用方声明的修订。 */
export function clientRevisionFrom(headers = {}) {
  const raw = headers['x-giftwise-code-revision'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
