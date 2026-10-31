/** Resolve before creating anything. Reject lexical escapes and existing symlink/junction escapes. */
import { lstatSync, realpathSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { REPO_ROOT } from '../localdb/db.mjs';

function inside(root, path) {
  const rel = relative(root, path);
  return !rel.startsWith('..') && !isAbsolute(rel);
}
export function taskPath(value, { allowMemory = false } = {}) {
  if (value === ':memory:' && allowMemory) return value;
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('INVALID_TASK_PATH');
  const absolute = resolve(value);
  if (!inside(REPO_ROOT, absolute)) throw Object.assign(new Error('写入路径必须位于当前工作树'), { code: 'PATH_OUTSIDE_WORKTREE' });
  let ancestor = absolute;
  function entryExists(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  while (!entryExists(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error('INVALID_TASK_PATH');
    ancestor = parent;
  }
  const canonicalRoot = realpathSync.native(REPO_ROOT);
  let canonicalAncestor;
  try { canonicalAncestor = realpathSync.native(ancestor); } catch { throw Object.assign(new Error('写入路径包含无法解析的链接'), { code: 'PATH_OUTSIDE_WORKTREE' }); }
  if (!inside(REPO_ROOT, canonicalRoot) || !inside(canonicalRoot, canonicalAncestor)) {
    throw Object.assign(new Error('写入路径经符号链接或 junction 指向工作树外'), { code: 'PATH_OUTSIDE_WORKTREE' });
  }
  return absolute;
}
export function taskDirectory(value) {
  const path = taskPath(value);
  mkdirSync(path, { recursive: true });
  taskPath(path);
  return path;
}
export function taskDatabasePath(value) {
  const path = taskPath(value, { allowMemory: true });
  if (path !== ':memory:') for (const suffix of ['-wal', '-shm', '-journal']) taskPath(path + suffix);
  return path;
}
export function taskProcessEnv(base = process.env, runtimeDir = join(REPO_ROOT, '.tmp/domestic-runtime')) {
  const root = taskDirectory(runtimeDir);
  const paths = Object.fromEntries(['temp', 'cache', 'npm-cache', 'opencli-cache', 'home', 'appdata', 'localappdata', 'downloads'].map(name => [name, taskDirectory(join(root, name))]));
  // Windows known-folder resolution expands USERPROFILE\AppData, even when APPDATA is set.
  const roaming=taskDirectory(join(paths.home,'AppData','Roaming'));
  const local=taskDirectory(join(paths.home,'AppData','Local'));
  for(const folder of ['Desktop','Downloads','Documents'])taskDirectory(join(paths.home,folder));
  return { ...base, TEMP: paths.temp, TMP: paths.temp, TMPDIR: paths.temp,
    XDG_CACHE_HOME: paths.cache, XDG_CONFIG_HOME: roaming, XDG_DATA_HOME: local,
    npm_config_cache: paths['npm-cache'], OPENCLI_CACHE_DIR: paths['opencli-cache'],
    CHROME_LOG_FILE: taskPath(join(root, 'chrome.log')),
    USERPROFILE: paths.home, APPDATA: roaming, LOCALAPPDATA: local };
}
