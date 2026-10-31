// 独立真实 CDP 浏览器验收；不 mock 配置、不写入前端 state、不访问 Dify。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export async function runRevision({ Client, open, close, ensureLocalServer, stopOwnServer, base, cdp, out, viewports }) {
  base = await ensureLocalServer(base, {explicit:true});
  const cfg = await (await fetch(base+'/api/config')).json();
  if(cfg.mode !== 'mock') throw new Error('仅允许本地 mock 服务');
  const version = await (await fetch(cdp+'/json/version')).json();
  const client = await Client.connect(version.webSocketDebuggerUrl);
  const results=[];
  const record=(id,status,actual)=>{results.push({id,status,actual});console.log(status,id,JSON.stringify(actual));};
  const check=(id,ok,actual)=>record(id,ok?'PASS':'FAIL',actual);
  try {
    for(const vp of viewports) {
      const {page,targetId}=await open(client,vp,base+'/');
      const tag=vp.name;
      try {
        await page.clickId('cta-start');
        await page.waitFor(`return !!document.getElementById('budget-min')`);
        check(tag+':three-steps',await page.eval(`return document.getElementById('steps').getAttribute('aria-label')==='填写进度：第 1 步，共三步'`));
        check(tag+':mock-visible',await page.eval(`return /模拟/.test(document.getElementById('mode-flag').textContent)`));
        check(tag+':no-horizontal-overflow',!(await page.layoutAudit()).horizontalOverflow);
        const slider=await page.eval(`return [...document.querySelectorAll('input[type=range]')].map(x=>({id:x.id,min:x.min,max:x.max,step:x.step,label:x.getAttribute('aria-label')}))`);
        check(tag+':two-sliders',slider.length===2&&slider.every(x=>x.min==='0'&&x.max==='1000'&&x.step==='50'&&/礼物预算/.test(x.label)),slider);
        await page.eval(`document.getElementById('budget-max').focus()`);
        await page.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        await page.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
        check(tag+':slider-keyboard',await page.eval(`return document.getElementById('budget-max').value==='350'`));
        await page.setInput('#budget-min','1000');
        check(tag+':slider-no-cross',await page.eval(`return +document.getElementById('budget-min').value<=+document.getElementById('budget-max').value`));
        const deadline=await page.eval(`return {labels:[...document.querySelectorAll('.deadline-options label')].map(x=>x.textContent),error:document.body.textContent.includes('准备时间配置尚未更新为六档')}`);
        check(tag+':six-time-options',deadline.labels.length===6&&!deadline.error,deadline);
        await page.eval(`const n=[...document.querySelectorAll('[aria-label="双方关系"] label.chip, label.chip')].find(n=>n.textContent.trim()==='其他'); if(!n)throw Error('missing other relation'); n.querySelector('input').click()`);
        check(tag+':other-relation-input',await page.eval(`return [...document.querySelectorAll('input[type=text],textarea')].some(n=>/关系/.test(n.getAttribute('aria-label')||''))`));
        await page.eval(`const ns=[...document.querySelectorAll('label.chip')].filter(n=>n.textContent.trim()==='其他'); ns.at(-1).querySelector('input').click()`);
        check(tag+':other-occasion-input',await page.eval(`return [...document.querySelectorAll('input[type=text],textarea')].some(n=>/场合/.test(n.getAttribute('aria-label')||''))`));
        await page.click('chip','其他金额');
        check(tag+':other-money-inputs',await page.eval(`return !!document.getElementById('budget-other-min')&&!!document.getElementById('budget-other-max')`));
        await page.setInput('#budget-other-min',''); await page.setInput('#budget-other-max','');
        await page.clickId('budget-confirm'); await page.clickId('step-next');
        check(tag+':empty-money-blocked',await page.eval(`return document.getElementById('steps').getAttribute('aria-label').includes('第 1 步') && document.body.textContent.includes('预算两端都需填写')`));
        await page.screenshot('revision-'+tag);
        record(tag+':back-preserves-input','BLOCKED','六档时间配置不兼容，无法从正常界面进入第二步');
        for(const name of ['ai-confirmation','recommendation-three-candidates','selection-before-presentation','bill-one-gift-no-packaging-price','recognition-loading','recommendation-loading','presentation-loading','timeout-recovery']) {
          record(tag+':'+name,'BLOCKED','正常表单被六档时间缺陷阻断；未注入配置或模拟响应绕过');
        }
        check(tag+':console-errors',page.consoleErrors.length===0,page.consoleErrors);
      } catch(err) {record(tag+':probe-exception','BLOCKED',String(err));}
      finally {await close(client,targetId);}
    }
  } finally {
    client.ws.close();stopOwnServer();
    const counts=Object.fromEntries(['PASS','FAIL','SKIP','BLOCKED'].map(s=>[s,results.filter(x=>x.status===s).length]));
    writeFileSync(join(out,'revision-browser-report.json'),JSON.stringify({base,browser:version.Browser,mode:'mock',server_config:cfg,counts,results},null,2));
    console.log('TOTAL',JSON.stringify(counts));
    process.exitCode=counts.FAIL||counts.BLOCKED?1:0;
  }
}
