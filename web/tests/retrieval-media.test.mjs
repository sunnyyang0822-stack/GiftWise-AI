import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RetrievalWorker, validatePlan, checkPrice, bindPrice } from '../server/retrieval/worker.mjs';
import { MediaProvider } from '../server/media/provider.mjs';
import { publicAddress,readImage } from '../server/media/safe-read.mjs';
const plan={category:'books',keywords:['礼物'],limit:3};
test('受限参数拒绝执行字段及注入',()=>{assert.throws(()=>validatePlan({...plan,eval:'x'}));assert.throws(()=>validatePlan({...plan,keywords:['$(whoami)']}));});
test('未知、条件、超预算及价格绑定',()=>{const p={product_id:'p',price_amount:'101',price_source:'browser_observed',price_conditions:[]};assert.equal(checkPrice(p,'100'),'over_budget');assert.equal(checkPrice({...p,price_amount:null},'100'),'unknown');assert.equal(checkPrice({...p,price_conditions:['会员']},'100'),'unknown');assert.throws(()=>bindPrice([p],'p','99','100'));assert.throws(()=>bindPrice([p],'other','101','100'));});
test('串行与任务隔离',async()=>{let active=0;const ids=[];const w=new RetrievalWorker({async search(p,{taskId}){assert.equal(++active,1);ids.push(taskId);await new Promise(r=>setTimeout(r,5));active--;return {products:[taskId]};}});const [a,b]=await Promise.all([w.submit(plan),w.submit(plan)]);assert.notDeepEqual(a,b);assert.equal(new Set(ids).size,2);});
test('超时及取消返回明确不可用',async()=>{const w=new RetrievalWorker({search:()=>new Promise(()=>{})},{timeoutMs:5});assert.equal((await w.submit(plan)).status,'unavailable');const c=new AbortController();c.abort();assert.equal((await w.submit(plan,{signal:c.signal})).status,'unavailable');});
test('媒体缺失、选后门禁与幂等',async()=>{const p=new MediaProvider();assert.equal(p.candidates([{candidate_id:'c',product_id:'p'}]).candidates[0].image,null);const run={selected_candidate_id:null,selectable_candidate_ids:['c']};await assert.rejects(p.packaging(run,'c'));run.selected_candidate_id='c';const a=await p.packaging(run,'c');assert.strictEqual(await p.packaging(run,'c'),a);assert.equal(a.status,'unavailable');});
test('URL风险默认拒绝及内网地址',async()=>{for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1'])assert.equal(publicAddress(ip),false);for(const url of ['http://example.com/x','https://127.0.0.1/x','https://example.com/x.svg'])await assert.rejects(readImage(url));});

import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
function fakeResponse(status,type,bytes){return (url,opts,callback)=>{const req=new EventEmitter();req.end=()=>{const res=new PassThrough();res.statusCode=status;res.headers={'content-type':type};callback(res);if(!res.destroyed)res.end(bytes);};return req;};}
const dns=async()=>[{address:'93.184.216.34',family:4}];
test('受控媒体读取：重定向、类型、大小、伪装内容和合法PNG',async()=>{
const opts={hosts:['example.com'],resolveHost:dns};
for(const [status,type,bytes] of [[302,'image/png',Buffer.alloc(0)],[200,'image/svg+xml',Buffer.from('<svg/>')],[200,'image/png',Buffer.from('html')]])await assert.rejects(readImage('https://example.com/i',{...opts,transport:fakeResponse(status,type,bytes)}));
await assert.rejects(readImage('https://example.com/i',{...opts,maxBytes:2,transport:fakeResponse(200,'image/png',Buffer.alloc(10))}));
const png=Buffer.from([137,80,78,71,13,10,26,10]);assert.equal((await readImage('https://example.com/i',{...opts,transport:fakeResponse(200,'image/png',png)})).type,'image/png');
await assert.rejects(readImage('https://example.com/i',{...opts,resolveHost:async()=>[{address:'127.0.0.1'}]}));
});
test('有界队列拒绝溢出',async()=>{let release;const w=new RetrievalWorker({search:()=>new Promise(r=>release=r)},{queueLimit:1,timeoutMs:30});const a=w.submit(plan);const b=w.submit(plan);await assert.rejects(w.submit(plan),/QUEUE_FULL/);release({products:[]});await a;await b;});

import { freezeEvidence,bindCandidates } from '../server/retrieval/evidence.mjs';
test('详情证据与冻结价格绑定，不接受摘要、错ID或模型低价',()=>{
const record={name:'虚构文具',variant:'蓝色单支',quantity:1,currency:'CNY',price_amount:'20.00',price_conditions:[],page_kind:'detail',source_url:'https://example.com/product',evidence_ref:'fixture-detail'};
assert.throws(()=>freezeEvidence([{...record,page_kind:'summary'}],{source:'browser_observed'}));
const e=freezeEvidence([record],{source:'browser_observed'});assert.equal(e.status,'partial');assert.throws(()=>{e.products[0].price_amount='1';});
const id=e.products[0].product_id;assert.throws(()=>bindCandidates(e,[{candidate_id:'c',product_id:id,estimated_total:'1'}],'100'));
assert.equal(bindCandidates(e,[{candidate_id:'c',product_id:id,estimated_total:'20.00'}],'100').get('c').quantity,1);
assert.throws(()=>bindCandidates(e,[{candidate_id:'c',product_id:id,estimated_total:'20.00'}],'19'));
});

import {verifyCandidateEvidence} from '../server/retrieval/evidence.mjs';
test('模型提供者引用一一对应规格与金额',()=>{const e=freezeEvidence([{name:'虚构礼物',variant:'蓝色',quantity:1,currency:'CNY',price_amount:'30',price_conditions:[]}],{source:'seed'});const id=e.products[0].product_id;const c=[{id:'c',name:'虚构礼物 · 蓝色',estimated_total:'30'}];assert.equal(verifyCandidateEvidence(e,c,[{candidate_id:'c',product_id:id}],'40').size,1);assert.throws(()=>verifyCandidateEvidence(e,c,null,'40'));assert.throws(()=>verifyCandidateEvidence(e,[{...c[0],name:'红色'}],[{candidate_id:'c',product_id:id}],'40'));});

test('证据过期、缺货与区间跨预算拒绝',()=>{const record={name:'虚构礼物',variant:'单件',quantity:1,currency:'CNY',price_amount:'30',price_range:{min:'20',max:'50'},price_conditions:[],page_kind:'detail',source_url:'https://example.com/p',evidence_ref:'fixture'};const e=freezeEvidence([record],{source:'browser_observed',now:new Date(Date.now()-700000).toISOString()});const c=[{id:'c',name:'虚构礼物 · 单件',estimated_total:'30'}];assert.throws(()=>verifyCandidateEvidence(e,c,[{candidate_id:'c',product_id:e.products[0].product_id}],'100'),/STALE/);assert.equal(checkPrice(record,'40'),'over_budget');const unavailable=freezeEvidence([{...record,stock_status:'out_of_stock'}],{source:'seed'});assert.throws(()=>bindCandidates(unavailable,[{candidate_id:'c',product_id:unavailable.products[0].product_id,estimated_total:'30'}],'100'),/OUT_OF_STOCK/);});
test('媒体DNS和响应绝对超时',async()=>{await assert.rejects(readImage('https://example.com/i',{hosts:['example.com'],timeoutMs:5,resolveHost:()=>new Promise(()=>{})}),/TIMEOUT/);const transport=()=>{const req=new EventEmitter();req.end=()=>{};req.destroy=e=>req.emit('error',e);return req;};await assert.rejects(readImage('https://example.com/i',{hosts:['example.com'],timeoutMs:5,resolveHost:dns,transport}),/TIMEOUT/);});
