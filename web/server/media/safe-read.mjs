import { lookup as defaultLookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
export function publicAddress(ip){if(isIP(ip)!==4)return false;const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
export async function readImage(raw,{hosts=[],maxBytes=2000000,timeoutMs=5000,resolveHost=defaultLookup,transport=request}={}){
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!hosts.includes(u.hostname))throw new Error('MEDIA_URL_BLOCKED');
 const addresses=await resolveHost(u.hostname,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('MEDIA_ADDRESS_BLOCKED');
 return new Promise((resolve,reject)=>{
 const req=transport(u,{lookup:(host,opts,cb)=>cb(null,addresses[0].address,4),timeout:timeoutMs},res=>{
  if(res.statusCode!==200){res.destroy();reject(new Error('MEDIA_HTTP_BLOCKED'));return;}
  const type=res.headers['content-type']?.split(';')[0];if(!['image/png','image/jpeg','image/webp'].includes(type)){res.destroy();reject(new Error('MEDIA_TYPE_BLOCKED'));return;}
  let size=0;const chunks=[];res.on('data',c=>{size+=c.length;if(size>maxBytes)res.destroy(new Error('MEDIA_TOO_LARGE'));else chunks.push(c);});res.on('error',reject);
  res.on('end',()=>{const b=Buffer.concat(chunks);const valid=type==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';if(!valid)reject(new Error('MEDIA_SIGNATURE_BLOCKED'));else resolve({bytes:b,type});});
 });req.on('timeout',()=>req.destroy(new Error('MEDIA_TIMEOUT')));req.on('error',reject);req.end();});
}
