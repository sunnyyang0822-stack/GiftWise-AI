// QA-only preload. No source changes. Network access is limited to the owned loopback test port.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import {syncBuiltinESMExports} from 'node:module';
const port=Number(process.env.QA_HTTP_PORT), enabled=process.env.QA_ALLOW_HTTP==='1';
const counts={listen:0,connect:0,fetch:0,numeric_loopback_lookup:0,blocked:0};
function reject(kind){counts.blocked++;throw Error('QA_NETWORK_BLOCKED_'+kind);}
function permitted(host,p){return enabled&&['127.0.0.1','localhost'].includes(host)&&Number(p)===port;}
const socketConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let a=args[0];if(Array.isArray(a))a=a[0];
 const opts=typeof a==='object'?a:{port:a,host:typeof args[1]==='string'?args[1]:'localhost'};
 if(!permitted(opts.host??'localhost',opts.port))return reject('CONNECT');
 counts.connect++;return socketConnect.apply(this,args);
};
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){
 const a=args[0],opts=typeof a==='object'?a:{port:a,host:args[1]};
 if(!permitted(opts.host,opts.port))return reject('LISTEN');
 counts.listen++;return listen.apply(this,args);
};
tls.connect=()=>reject('TLS');dgram.createSocket=()=>reject('DGRAM');
// Node listen/connect can call lookup even for a numeric address. Satisfy it locally, without DNS.
dns.lookup=(host,options,callback)=>{if(typeof options==='function'){callback=options;options={};}if(!enabled||host!=='127.0.0.1')return reject('DNS');counts.numeric_loopback_lookup++;queueMicrotask(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));};
dns.resolve=()=>reject('DNS');
for(const k of ['lookup','resolve','resolve4','resolve6','resolveAny'])if(dns.promises[k])dns.promises[k]=async()=>reject('DNS');
const actualFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.protocol!=='http:'||!permitted(u.hostname,u.port))return reject('FETCH');counts.fetch++;return actualFetch(input,options);};
syncBuiltinESMExports();
process.on('exit',()=>console.log('QA_NETWORK_GUARD '+JSON.stringify({mode:enabled?'owned-loopback':'offline',port:enabled?port:null,...counts})));
