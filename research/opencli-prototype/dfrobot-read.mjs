import {publicAddress} from '../../web/server/media/safe-read.mjs';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
// 参数仅来自服务端固定枚举，不接受URL、任意脚本或用户原文。
const root=process.env.OPENCLI_PACKAGE_ROOT;
const chrome=process.env.GIFTWISE_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const base=resolve(tmpdir());const profile=process.env.GIFTWISE_TASK_PROFILE?resolve(process.env.GIFTWISE_TASK_PROFILE):await mkdtemp(join(base,'giftwise-retrieval-'));
if(!profile.startsWith(base+sep+'giftwise-retrieval-')||profile===base)throw new Error('INVALID_TASK_PROFILE');
let browser,bridge;let phase='start';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function cleanup(){if(bridge){try{await bridge.send('Browser.close');}catch{}await bridge.close().catch(()=>{});}browser?.kill();if(profile.startsWith(base+sep)&&profile!==base)await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(()=>{});}
const timer=setTimeout(()=>{cleanup().finally(()=>process.exit(2));},45000);
try {
 const dns=await fetch('https://dns.google/resolve?name=www.dfrobot.com.cn&type=A',{signal:AbortSignal.timeout(5000),redirect:'error'}).then(r=>{if(!r.ok)throw new Error('DNS_FAILED');return r.json();});
 const addresses=(dns.Answer??[]).filter(a=>a.type===1).map(a=>a.data);if(dns.Status!==0||!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw new Error('DNS_ADDRESS_BLOCKED');
 const {CDPBridge}=await import(pathToFileURL(root+'/dist/src/browser/cdp.js'));
 browser=spawn(chrome,['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--host-resolver-rules=MAP www.dfrobot.com.cn '+addresses[0],'about:blank'],{shell:false,windowsHide:true,stdio:'ignore'});
 browser.on('error',()=>{});
 let port;for(let i=0;i<50;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port>0&&port<65536)break;}catch{}await pause(100);}
 if(!port)throw new Error('BROWSER_START_FAILED');
 bridge=new CDPBridge();const page=await bridge.connect({cdpEndpoint:'http://127.0.0.1:'+port,timeout:5});
 // 不读取Cookie或请求头。仅放行固定来源HTTPS文档/样式/脚本；阻止外域、内网地址与图片下载。
 await bridge.send('Network.enable');await bridge.send('Network.setCacheDisabled',{cacheDisabled:true});
 bridge.on('Fetch.requestPaused',async event=>{try{const u=new URL(event.request.url);let allowed=u.origin==='https://www.dfrobot.com.cn'&&!u.username&&!u.password&&['Document','Stylesheet','Script','XHR','Fetch'].includes(event.resourceType);if(allowed)allowed=addresses.every(publicAddress);await bridge.send(allowed?'Fetch.continueRequest':'Fetch.failRequest',allowed?{requestId:event.requestId}:{requestId:event.requestId,errorReason:'BlockedByClient'});}catch{await bridge.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}});
 await bridge.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 phase='search';const nav=await bridge.send('Page.navigate',{url:'https://www.dfrobot.com.cn/search.php?keywords=kit'});if(nav.errorText)throw new Error('NAVIGATION_FAILED:'+nav.errorText);
 for(let i=0;i<30;i++){if(await page.evaluate('!!document.querySelector("a[href*=goods-]")'))break;await pause(200);}
 const matches=await page.evaluate('Array.from(document.querySelectorAll("a[href]")).filter(a=>/虫虫机器人|micro:bit Go|Arduino自动浇花套件/.test(a.innerText)).map(a=>({name:a.innerText,url:a.href}))');
 const products=[];const details=[];
 for(const link of matches.slice(0,3)){
  const url=new URL(link.url);if(url.origin!=='https://www.dfrobot.com.cn'||!/^\/goods-[0-9]+\.html$/.test(url.pathname)||url.search)continue;
  phase='detail';await page.goto(url.href);
  const actual=await page.evaluate('({url:location.href,name:document.querySelector("h1")?.innerText,price:document.querySelector("#ECS_SHOPPRICE")?.innerText,sku:document.body.innerText.match(/货号\\s+([A-Z0-9]+)/)?.[1],quantity:document.querySelector("input[name=number]")?.value,text:document.body.innerText.split("用户评论")[0]})');
  if(actual.url!==url.href||!actual.name||!actual.sku)continue;
  const price=actual.price?.match(/^￥([0-9]+(?:\.[0-9]{1,2})?)$/)?.[1]??null;
  const observed_at=new Date().toISOString();const evidence_ref='dfrobot-'+actual.sku+'-'+Date.now();
  const dim=actual.text.match(/(?:组装后尺寸|外形尺寸)[：:]\s*(\d+)\s*[xX*×]\s*(\d+)\s*[xX*×]\s*(\d+)\s*(?:（)?mm/);
  const weight=actual.text.match(/重量[：:]\s*(\d+)\s*g/);
  const stock=actual.text.includes('暂时缺货')?'out_of_stock':'unknown';
  const qty=actual.quantity==null?1:Number(actual.quantity);if(qty!==1)continue;
  const product={name:actual.name,variant:actual.sku+'，单套（详情默认规格）',quantity:1,currency:'CNY',price_amount:price,price_conditions:/会员价|券后|到手价/.test(actual.text)?['存在条件报价，适用条件未核实']:[],page_kind:'detail',source_url:url.href,evidence_ref,stock_status:stock,observed_at,measurements:{dimensions:dim?{length:Number(dim[1]),width:Number(dim[2]),height:Number(dim[3])}:null,weight:weight?Number(weight[1]):null}};
  products.push(product);details.push({evidence_ref,source_url:url.href,observed_at,name:actual.name,sku:actual.sku,quantity:1,price_text:actual.price??null,stock_status:stock,dimensions_excerpt:dim?.[0]??null,weight_excerpt:weight?.[0]??null});await pause(300);
 }
 console.log(JSON.stringify({source:'browser_observed',search:{source_url:'https://www.dfrobot.com.cn/search.php?keywords=kit',matched_count:matches.length},products,details,page_diagnostic:products.length?null:await page.evaluate('({title:document.title,text:document.body.innerText.slice(0,300)})'),warnings:['仅适用于确认科技兴趣的创客方向；须确认装配能力、所需设备与准备时间','页面观察价，非结算/库存/送达保证；图片使用权未核实，未转载']}));
} catch (error) {if(process.env.GIFTWISE_RETRIEVAL_DIAGNOSTIC==='1')console.error(error.message);console.log(JSON.stringify({error:'PUBLIC_RETRIEVAL_FAILED',phase}));process.exitCode=2;}
finally {clearTimeout(timer);await cleanup();}
