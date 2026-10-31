import fs from 'node:fs';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));const base=process.env.GW_BASE||'http://127.0.0.1:19002';const v=await(await fetch((process.env.GW_CDP||'http://127.0.0.1:9342')+'/json/version')).json();const ws=new WebSocket(v.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let seq=0;const p=new Map(),requests=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent')requests.push({session:m.sessionId,url:m.params.request.url});if(p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};const send=(method,params={},sessionId)=>new Promise((r,j)=>{const id=++seq;p.set(id,m=>m.error?j(m.error):r(m.result));ws.send(JSON.stringify({id,method,params,...sessionId?{sessionId}:{}}))});const checks=[];function check(name,ok){console.log(`${ok?'PASS':'FAIL'} ${name}`);checks.push({name,passed:!!ok});if(!ok)process.exitCode=1;}
for(const [width,mode] of [[1440,'normal'],[390,'normal'],[320,'normal'],[390,'failed'],[390,'missing'],[390,'pending'],[1440,'hexagon'],[390,'paper'],[390,'package_failed']]){
 const tag=`${width}-${mode}`;const {targetId}=await send('Target.createTarget',{url:'about:blank'});const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});const cmd=(m,p)=>send(m,p,sessionId);
 const ev=async x=>{const r=await cmd('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 const wait=async x=>{for(let i=0;i<100;i++){if(await ev(x))return;await new Promise(r=>setTimeout(r,100))}throw Error('wait '+x)};
 const click=s=>ev(`document.querySelector(${JSON.stringify(s)}).click()`);
 const key=async k=>{await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:k==='Enter'?13:k==='Escape'?27:9,...(k==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k,windowsVirtualKeyCode:k==='Enter'?13:k==='Escape'?27:9});};
 const shot=async name=>{await new Promise(r=>setTimeout(r,150));const x=await cmd('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${root}/media-${tag}-${name}.png`,Buffer.from(x.data,'base64'))};
 await cmd('Network.enable');if(mode==='failed')await cmd('Network.setBlockedURLs',{urls:['*media-demo/notebook-photo.jpg*']});
 if(mode==='package_failed')await cmd('Network.setBlockedURLs',{urls:['*media-demo/scene-light.jpg*']});
 await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
 await cmd('Page.navigate',{url:base+'/?media='+mode});await wait(`!!document.querySelector('#view')?.dataset.viewKey`);await click('#cta-start');
 await click('input[aria-label="追求对象"]');await click('input[aria-label="生日"]');await click('input[aria-label="3–5天"]');await click('#step-next');await click('#step-next');await click('#step-next');
 await wait(`document.querySelectorAll('#view .gift-media').length===3`);
 check(tag+' visible preview marker',await ev(`document.querySelector('#mode-flag').textContent.includes('界面预览／模拟数据')`));
 check(tag+' three images bound',await ev(`[...document.querySelectorAll('#view .gift-media')].length===3&&new Set([...document.querySelectorAll('#view .gift-media')].map(n=>n.dataset.imageId)).size===(['missing'].includes(${JSON.stringify(mode)})?1:3)`));
 check(tag+' responsive card arrangement',await ev(`(()=>{const cards=[...document.querySelectorAll('.gift-choice')].map(n=>n.getBoundingClientRect());return innerWidth>=1000?Math.abs(cards[0].top-cards[2].top)<1:cards[1].top>=cards[0].bottom&&cards[2].top>=cards[1].bottom})()`));
 check(tag+' no package request before selection',requests.filter(r=>r.session===sessionId&&(r.url.includes('/wrap-')||r.url.includes('/scene-'))).length===0);
 check(tag+' reference source and unread date',await ev(`document.querySelectorAll('.media-price').length===3&&[...document.querySelectorAll('.media-price')].every(n=>n.textContent.includes('读取日期：未检索')&&n.textContent.includes('非实时价格'))`));
 if(mode==='missing'){
  check(tag+' missing does not block text selection',await ev(`document.querySelectorAll('.gift-media img').length===0&&[...document.querySelectorAll('button')].some(n=>n.textContent.includes('选择这个方案'))`));
  await ev(`document.querySelector('.gift-media').scrollIntoView({block:'center'})`);await shot('missing');
 }else if(mode==='pending'){
  check(tag+' pending status visible',await ev(`document.querySelector('.media-status').textContent.includes('正在准备')&&!document.querySelector('.media-status').hidden`));
  await ev(`document.querySelector('.candidate-grid').scrollIntoView({block:'start'})`);await shot('pending');
  await click('.media-retry');await wait(`document.querySelector('.gift-media img')?.naturalWidth>0`);check(tag+' pending can reload',true);
 }else{
  if(mode==='failed'){
   await wait(`document.querySelector('.media-status').textContent.includes('加载失败')`);
   check(tag+' failed leaves candidate selectable',await ev(`[...document.querySelectorAll('button')].some(n=>n.textContent.includes('选择这个方案'))`));
   await ev(`document.querySelector('.gift-media').scrollIntoView({block:'center'})`);await shot('error');
   await cmd('Network.setBlockedURLs',{urls:[]});await click('.media-retry');
  }
  await wait(`[...document.querySelectorAll('#view .media-stage > img')].every(n=>n.naturalWidth===1400)&&document.querySelectorAll('#view .media-stage > img').length===3`);
  check(tag+' complete images no stretching',await ev(`[...document.querySelectorAll('.media-stage > img')].every(n=>{const r=n.getBoundingClientRect();return Math.abs(r.width/r.height-4/3)<.01&&getComputedStyle(n).objectFit==='contain'})`));
  check(tag+' sample provenance visible',await ev(`[...document.querySelectorAll('.media-attribution')].every(n=>n.textContent.includes('Pexels')&&n.textContent.includes('非对应SKU'))`));
  await ev(`document.querySelector('.candidate-grid').scrollIntoView({block:'start'})`);await shot('candidate');
  await ev(`document.querySelector('.media-zoom').focus()`);await key('Enter');await wait(`!!document.querySelector('dialog[open]')`);
  check(tag+' keyboard opens zoom',await ev(`document.activeElement.textContent==='关闭图片'`));await key('Tab');check(tag+' keyboard stays in modal',await ev(`!!document.activeElement.closest('dialog')`));
  await key('Escape');await wait(`!document.querySelector('dialog')`);check(tag+' escape restores focus',await ev(`!document.querySelector('dialog')&&document.activeElement.classList.contains('media-zoom')`));
 }
 const selectionIndex=mode==='hexagon'?1:mode==='paper'?2:0;
 await ev(`[...document.querySelectorAll('button')].filter(n=>n.textContent.includes('选择这个方案'))[${selectionIndex}].click()`);
 await wait(`!!document.querySelector('.packaging-media')`);
 check(tag+' package selected only',await ev(`document.querySelector('.gift-media')?.dataset.imageId===${JSON.stringify(mode==='missing'?'missing':`demo-wrap-${['notebook','workshop','art'][selectionIndex]}`)}`));
 if(mode!=='missing'){
  if(mode==='package_failed'){
   await wait(`document.querySelector('.packaging-media .media-status').textContent.includes('加载失败')`);
   check(tag+' package image failure keeps bill',await ev(`document.querySelector('#view').textContent.includes('80.00 CNY')&&document.querySelector('.packaging-media .media-retry').hidden===false`));
   await ev(`document.querySelector('.packaging-media').scrollIntoView({block:'start'})`);await shot('package-error');
   await cmd('Network.setBlockedURLs',{urls:[]});await click('.packaging-media .media-retry');
  }
  await wait(`document.querySelector('.packaging-media img')?.naturalWidth===1400`);
  check(tag+' three Chinese arrows and equivalent text',await ev(`document.querySelectorAll('.media-arrows path').length===3&&document.querySelectorAll('.media-notes li').length===3&&[...document.querySelectorAll('.media-label')].every(n=>/[\u4e00-\u9fff]/.test(n.getAttribute('aria-label')))`));
  const aligned=`(()=>{const s=document.querySelector('.packaging-media .media-stage'),a=s.querySelector('svg').getBoundingClientRect(),b=s.querySelector('img').getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1&&a.top===b.top})()`;
  check(tag+' arrows align with original image bounds',await ev(aligned));
  await ev(`document.querySelectorAll('.media-label')[2].focus()`);await key('Enter');check(tag+' keyboard label updates readable text',await ev(`document.querySelector('.media-active-note').textContent===document.querySelectorAll('.media-notes li')[2].textContent`));
  check(tag+' curves and unframed notes',await ev(`document.querySelector('.media-arrows path').getAttribute('d').includes(' Q ')&&getComputedStyle(document.querySelector('.media-label')).borderTopWidth==='0px'`));
  check(tag+' scene full original ratio',await ev(`(()=>{const i=document.querySelector('.packaging-media img'),r=i.getBoundingClientRect();return Math.abs(r.width/r.height-i.naturalWidth/i.naturalHeight)<.01&&document.querySelector('.packaging-media').textContent.includes('场景道具不包含')})()`));
  check(tag+' touch target >=44',await ev(`[...document.querySelectorAll('.media-label')].every(n=>n.getBoundingClientRect().height>=44&&n.getBoundingClientRect().width>=44)`));
  await ev(`document.querySelector('.media-notes summary').focus()`);await key('Enter');check(tag+' keyboard equivalent description',await ev(`document.querySelector('.media-notes').open`));
  await ev(`document.querySelector('.packaging-media').scrollIntoView({block:'start'})`);await shot('package');
  await click('.packaging-media .media-zoom');await wait(`document.querySelector('dialog .media-arrows')`);await ev(`[...document.querySelectorAll('dialog button')].find(n=>n.textContent==='放大至200%').click()`);
  check(tag+' 200percent keeps annotation alignment',await ev(`(()=>{const s=document.querySelector('dialog .media-stage'),a=s.querySelector('svg').getBoundingClientRect(),b=s.querySelector('img').getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1})()`));await shot('zoom');await key('Escape');
 }
 check(tag+' bill single gift and no package price',await ev(`document.querySelector('#view').textContent.includes('${['80.00','150.00','220.00'][selectionIndex]} CNY')&&document.querySelector('#view').textContent.includes('未计价，不代表免费')`));
 check(tag+' document no horizontal overflow',await ev(`document.documentElement.scrollWidth<=innerWidth`));
 check(tag+' no business or external requests',requests.filter(r=>r.session===sessionId&&(!r.url.startsWith(base)||new URL(r.url).pathname.startsWith('/api/'))).length===0);
 await send('Target.closeTarget',{targetId});
}
ws.close();fs.writeFileSync(`${root}/media-results.json`,JSON.stringify({total:checks.length,passed:checks.filter(x=>x.passed).length,checks},null,2));console.log('TOTAL',checks.length,'PASS',checks.filter(x=>x.passed).length);
