import { request } from 'node:https';
import { isIP } from 'node:net';
import { hostAllowedAny } from './hosts.mjs';
import { SUPPORTED_RASTER_TYPES, UNSUPPORTED_RASTER_TYPES } from './raster.mjs';

/**
 * 固定的 DNS-over-HTTPS 解析器：**不信任本机 DNS**。
 *
 * 为什么必须这样（本机实测，2026-10-31）：本机处于「拦截式代理」环境，
 * 系统 DNS 把所有域名都解析成代理 fake-IP `198.18.0.0/15`（benchmarking 保留段）
 * + 保留 IPv6 `fdfe:dcba:9876::/48`：
 *   ```
 *   y.zdmimg.com       => 198.18.0.150/4, fdfe:dcba:9876::84/6
 *   img.alicdn.com     => 198.18.0.166/4, fdfe:dcba:9876::94/6
 *   api.modelverse.cn  => 198.18.0.39/4,  fdfe:dcba:9876::24/6
 *   ```
 * 于是「解析结果必须是公网 IPv4」这条闸门在真实主机上**永远不通过**，
 * 参考图路径 100% 退化成 `MEDIA_ADDRESS_BLOCKED`（实测：真实商品的
 * `https://y.zdmimg.com/...jpg` 也读不到）。
 *
 * 口径与 `docs/research/opencli/delivery.md` 里已经踩过同一个坑的结论一致：
 * **没有放开保留地址**，而是改用固定 DoH 查询 A 记录 → 校验公网 → 再按该 IP 连接。
 * 实测：DoH 返回 `y.zdmimg.com -> 43.174.196.3`（真实公网 A 记录），
 * 按该 IP 连接得到 200 + `image/jpeg` + 210,001 字节 + `ffd8ffe0`。
 */
export const DOH_ENDPOINT = 'https://dns.google/resolve';
export const DOH_TIMEOUT_MS = 4000;

/**
 * 必须带一个**如实自报**的 User-Agent。
 * 实测（2026-10-31）：不带 UA 直连 `y.zdmimg.com` 会被腾讯 EdgeOne 以
 * `status=567 text/plain content-length=45`（server: TencentEdgeOne）拒绝，
 * 带上自报 UA 后同一 URL 得到 `200 image/jpeg 210001 ffd8ffe0`。
 * 这里只自报身份，不伪装浏览器、不带 Referer、不借 Cookie。
 */
export const REFERENCE_USER_AGENT = 'GiftWiseReferenceFetcher/1.0 (server-side gift-packaging reference read)';

/** 只用固定 DoH 拿 A 记录（绝不采用本机 DNS 的解析结果）。 */
export async function resolvePublicAddresses(hostname, { fetchImpl = fetch, timeoutMs = DOH_TIMEOUT_MS } = {}) {
 const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=A`;
 const response = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(timeoutMs) });
 if (!response.ok) throw new Error('MEDIA_ADDRESS_BLOCKED');
 const data = await response.json();
 return (Array.isArray(data?.Answer) ? data.Answer : [])
  .filter((answer) => answer?.type === 1 && typeof answer.data === 'string' && isIP(answer.data) === 4)
  .map((answer) => ({ address: answer.data, family: 4 }));
}

export function publicAddress(ip) {
 if(isIP(ip)!==4)return false;
 const [a,b]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===203&&b===0||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51));
}

/** 读出「已识别但本层不解码」的格式时用的明确错误码（与白名单/网络阻断分开）。 */
function formatUnsupported(type) {
 const error = new Error('IMAGE_FORMAT_UNSUPPORTED');
 error.code = 'IMAGE_FORMAT_UNSUPPORTED';
 error.detectedType = type;
 return error;
}

/**
 * 安全读取参考图字节。
 *
 * 三道闸门**都在发网络请求或读字节之前/之后立刻生效**，绝不把不可用字节交给供应商：
 *   1) 协议 + 主机白名单（`hostAllowedAny`：精确名或最左标签前缀通配，后缀锚定）；不合法 ⇒ MEDIA_URL_BLOCKED；
 *   2) DNS 用**固定 DoH** 解析、结果必须是公网 IPv4，并把连接**钉死**在该 IP 上（防 SSRF/内网/DNS rebinding）；
 *      解析不到、或任一 A 记录落在非公网段 ⇒ MEDIA_ADDRESS_BLOCKED；
 *   3) content-type 与**字节签名**双重校验：
 *      - 已识别但不支持的格式（AVIF/HEIC/GIF/BMP/TIFF/SVG）⇒ `IMAGE_FORMAT_UNSUPPORTED`（不是「被阻断」）；
 *      - 非图片类型 ⇒ MEDIA_TYPE_BLOCKED；签名与声明不符 ⇒ MEDIA_SIGNATURE_BLOCKED。
 *
 * ⚠️ 只经 IPv4 连接（`lookup` 固定 `family:4` 并返回钉死的那个 IP）：因此 AAAA 记录不参与判定，
 * 也永远不会经 IPv6 连接。Node ≥20 的 `autoSelectFamily` 在 `options.all===true` 时要求
 * 回调给出**地址数组**——不区分这个分支会直接抛 `ERR_INVALID_IP_ADDRESS`（实测踩到过），
 * 所以这里按 `opts.all` 分别返回数组/标量。
 */
export async function readImage(raw,{hosts=[],maxBytes=2000000,timeoutMs=5000,resolveHost=resolvePublicAddresses,transport=request}={}) {
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!hostAllowedAny(hosts,u.hostname))throw new Error('MEDIA_URL_BLOCKED');
 let dnsTimer;const started=Date.now();
 const resolved=await Promise.race([resolveHost(u.hostname,{all:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error('MEDIA_TIMEOUT')),timeoutMs);})]).finally(()=>clearTimeout(dnsTimer));
 const addresses=(Array.isArray(resolved)?resolved:[]).filter(a=>isIP(a?.address)===4);
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('MEDIA_ADDRESS_BLOCKED');
 const pinned=addresses[0].address;
 return new Promise((resolve,reject)=>{
  let req,settled=false;
  const done=(fn,value)=>{if(settled)return;settled=true;clearTimeout(deadline);fn(value);};
  const deadline=setTimeout(()=>{const error=new Error('MEDIA_TIMEOUT');req?.destroy(error);done(reject,error);},Math.max(1,timeoutMs-(Date.now()-started)));
  try {
   // ⛔ 显式不发 `Accept: image/webp`：本层拿到的格式应稳定可预期（见 raster.mjs 的协商实测记录），
   //    而格式判定一律以**字节签名**为准，不信扩展名也不信 content-type。
   //    解析结果被钉死成 `pinned`：请求不会二次解析域名（DNS rebinding 无从下手）。
   req=transport(u,{lookup:(host,opts,cb)=>{if(opts?.all)cb(null,[{address:pinned,family:4}]);else cb(null,pinned,4);},timeout:timeoutMs,headers:{'user-agent':REFERENCE_USER_AGENT}},res=>{
    if(res.statusCode!==200){res.destroy();done(reject,new Error('MEDIA_HTTP_BLOCKED'));return;}
    const type=res.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if(UNSUPPORTED_RASTER_TYPES.includes(type)){res.destroy();done(reject,formatUnsupported(type));return;}
    if(!SUPPORTED_RASTER_TYPES.includes(type)){res.destroy();done(reject,new Error('MEDIA_TYPE_BLOCKED'));return;}
    let size=0;const chunks=[];
    res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)res.destroy(new Error('MEDIA_TOO_LARGE'));else chunks.push(chunk);});
    res.on('error',error=>done(reject,error));res.on('aborted',()=>done(reject,new Error('MEDIA_TRUNCATED')));
    res.on('end',()=>{
     const bytes=Buffer.concat(chunks);
     const valid=type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
     if(!valid)done(reject,new Error('MEDIA_SIGNATURE_BLOCKED'));else done(resolve,{bytes,type});
    });
   });
   req.on('timeout',()=>req.destroy(new Error('MEDIA_TIMEOUT')));req.on('error',error=>done(reject,error));req.end();
  }catch(error){done(reject,error);}
 });
}

/** 供测试与报告引用：默认解析器就是固定 DoH（不是系统 DNS）。 */
export const defaultResolver = resolvePublicAddresses;
