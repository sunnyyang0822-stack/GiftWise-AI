/** Project-owned read-only page. No cookie, credential, network capture or stealth APIs. */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureChrome, projectPath } from './chrome.mjs';
import { REPO_ROOT } from '../localdb/db.mjs';

export function opencliPackageRoot(explicit) {
  const paths = [explicit, process.env.OPENCLI_PACKAGE_ROOT,
    process.env.GW_OPENCLI_MAIN && resolve(dirname(process.env.GW_OPENCLI_MAIN), '../..'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, '.opencli/node_modules/@jackwener/opencli')].filter(Boolean);
  const root = paths.find(p => existsSync(join(p, 'package.json')) && existsSync(join(p, 'clis/dianping/search.js')));
  if (!root) throw Object.assign(new Error('未找到包含大众点评适配器的 OpenCLI 包，请配置 OPENCLI_PACKAGE_ROOT'), { code: 'OPENCLI_NOT_FOUND' });
  return resolve(root);
}
export function opencliVersion(root) { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version; }
export async function importOpencli(root, file) { return import(pathToFileURL(join(root, file)).href); }

export async function createDomesticPage({ port = 19366, profileDir = join(REPO_ROOT, '.tmp/domestic-profile'), headless = true, signal, timeoutMs = 20000 } = {}) {
  profileDir = projectPath(profileDir);
  mkdirSync(profileDir, { recursive: true });
  const browser = await ensureChrome({ port, profileDir, headless });
  let ws;
  try {
    const targets = await (await fetch(`${browser.endpoint}/json/list`)).json();
    const target = targets.find(t => t.type === 'page' && t.url === 'about:blank');
    if (!target?.webSocketDebuggerUrl) throw new Error('专用浏览器没有空白页面');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP_CONNECT_TIMEOUT')), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP_CONNECT_FAILED')); }, { once: true });
    });
    let seq = 0;
    let navigationSeq = 0;
    const pending = new Map();
    const rejectPending = (message) => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } pending.clear(); };
    ws.addEventListener('close', () => rejectPending('CDP_CLOSED'));
    ws.addEventListener('message', event => {
      const data = JSON.parse(String(event.data));
      if (data.method === 'Page.frameNavigated' && !data.params?.frame?.parentId) navigationSeq++;
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id); clearTimeout(p.timer);
      data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result);
    });
    function send(method, params = {}) {
      if (signal?.aborted) return Promise.reject(new Error('RETRIEVAL_CANCELLED'));
      return new Promise((resolvePromise, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('PAGE_TIMEOUT')); }, timeoutMs);
        pending.set(id, { resolve: resolvePromise, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error('页面只读提取失败');
      return result.result?.value;
    }
    const abort = () => { rejectPending('RETRIEVAL_CANCELLED'); ws.close(); };
    signal?.addEventListener('abort', abort, { once: true });
    await send('Page.enable');
    return {
      browser, evaluate,
      async goto(url) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('INVALID_SOURCE_URL');
        const before = navigationSeq;
        const result = await send('Page.navigate', { url });
        if (result.errorText) throw new Error('PAGE_NAVIGATION_FAILED');
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 250));
          const state = await evaluate('({ready:document.readyState,url:location.href})');
          if (navigationSeq > before && state?.url !== 'about:blank' && ['interactive', 'complete'].includes(state?.ready)) return;
        }
        throw new Error('PAGE_TIMEOUT');
      },
      async autoScroll({ times = 3, delayMs = 1000 } = {}) {
        for (let i = 0; i < times; i++) {
          await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');
          await new Promise(r => setTimeout(r, delayMs));
        }
      },
      async fetchImage(url) {
        // Only the fixed image validator calls this; credentials are explicitly omitted.
        const tree=await send('Page.getFrameTree');
        const {resource}=await send('Network.loadNetworkResource',{frameId:tree.frameTree.frame.id,url:String(url),options:{disableCache:false,includeCredentials:false}});
        if(!resource?.success||!resource.stream)return new Response(null,{status:resource?.httpStatusCode||502});
        const chunks=[];let length=0;
        try{while(true){const part=await send('IO.read',{handle:resource.stream,size:65536});const bytes=Buffer.from(part.data,part.base64Encoded?'base64':'utf8');length+=bytes.length;if(length>8*1024*1024)throw new Error('IMAGE_TOO_LARGE');chunks.push(bytes);if(part.eof)break;}}
        finally{await send('IO.close',{handle:resource.stream});}
        const headers={};for(const [key,value] of Object.entries(resource.headers??{}))if(['content-type','content-length'].includes(key.toLowerCase()))headers[key]=String(value);
        return new Response(Buffer.concat(chunks),{status:resource.httpStatusCode||200,headers});
      },
      async wait(seconds) {
        if(seconds&&typeof seconds==='object'&&typeof seconds.selector==='string'){
          const until=Date.now()+Math.min(20000,Math.max(1,Number(seconds.timeout)||8)*1000);
          while(Date.now()<until){if(signal?.aborted)throw Error('RETRIEVAL_CANCELLED');if(await evaluate(`Boolean(document.querySelector(${JSON.stringify(seconds.selector)}))`))return;await new Promise(r=>setTimeout(r,200));}
          throw Error('SELECTOR_TIMEOUT');
        }
        await new Promise((r, reject) => { const t = setTimeout(r, seconds * 1000); if (signal?.aborted) { clearTimeout(t); reject(new Error('RETRIEVAL_CANCELLED')); } });
      },
      async close() { signal?.removeEventListener('abort', abort); rejectPending('CDP_CLOSED'); ws.close(); await browser.stop(); },
    };
  } catch (error) { ws?.close(); await browser.stop(); throw error; }
}
