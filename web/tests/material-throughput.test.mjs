import test from 'node:test';
import assert from 'node:assert/strict';
import {RetrievalWorker} from '../server/retrieval/worker.mjs';
const plan=(id,purpose='inspiration')=>({category:'domestic',needs_retrieval:true,queries:[{purpose,keyword:id,sources:[purpose==='inspiration'?'web':'dianping']}]});
const tick=()=>new Promise(r=>setImmediate(r));
test('reference HTTP jobs overlap up to three; browser job is exclusive and FIFO',async()=>{
 let active=0,peak=0;const pending=new Map(),started=[],ids=new Set();
 const worker=new RetrievalWorker({search:async(p,{taskId})=>{const name=p.queries[0].keyword;started.push(name);assert.equal(ids.has(taskId),false);ids.add(taskId);peak=Math.max(peak,++active);await new Promise(r=>pending.set(name,r));active--;return{status:'partial',references:[{reference_id:name}]};}});
 const first=['one','two','three'].map(x=>worker.submit(plan(x)));assert.deepEqual(started,['one','two','three']);
 const fourth=worker.submit(plan('four')),browser=worker.submit(plan('browser','purchase')),last=worker.submit(plan('last'));
 pending.get('one')();await first[0];await tick();assert.deepEqual(started,['one','two','three','four']);
 for(const name of ['two','three','four'])pending.get(name)();await Promise.all([...first,fourth]);await tick();assert.equal(active,1);assert.equal(started.at(-1),'browser');
 pending.get('browser')();await browser;await tick();assert.equal(started.at(-1),'last');pending.get('last')();await last;assert.equal(peak,3);
});
test('parallel reference cancellation does not affect another owner task or follow-up work',async()=>{
 const controller=new AbortController();let release;
 const worker=new RetrievalWorker({search:async(p,{signal})=>{if(p.queries[0].keyword==='cancel')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));if(p.queries[0].keyword==='other')await new Promise(r=>release=r);return{status:'ready',references:[]};}});
 const a=worker.submit(plan('cancel'),{signal:controller.signal}),b=worker.submit(plan('other'));controller.abort();assert.equal((await a).status,'unavailable');release();assert.equal((await b).status,'ready');assert.equal((await worker.submit(plan('later'))).status,'ready');
});
