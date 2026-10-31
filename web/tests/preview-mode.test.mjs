import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PREVIEW_MODE, previewConfig, previewRequest, setPreviewScenario} from "../public/js/preview-api.js";

const intake = {contract_version:"giftwise-20261031-v2",recipient_relation:"pursuit",occasion:"birthday",budget_mode:"slider",budget_range:{min:"100",max:"300"},currency:"CNY",deadline_days:5,interests:[],interest_confidence:{},gift_styles:[],dislikes:"",previous_gifts:"",hard_exclusions:{tags:[],terms:[],unresolved:[]},additional_context:""};
test("本地配置、六档与预算不需要重复确认",async()=>{
  assert.equal(PREVIEW_MODE,false, '未显式启用预览时必须使用正式链路');
  assert.deepEqual(previewConfig.ranges.deadline.map(r=>r.days),[1,5,7,30,90,365]);
  const app=(await Promise.all(['../public/app.js','../public/js/chat.js'].map(n=>readFile(new URL(n,import.meta.url),'utf8')))).join('\n');
  assert.doesNotMatch(app,/budget_confirmed/);
  assert.match(app,/if \(PREVIEW_MODE\) return previewRequest\(path, payload\);/);
  assert.match(app,/await fetch\(path,/);
  assert.match(app,/credentials: "same-origin"/);
  assert.match(app,/previous_gifts: f\.previous_gifts/);
  assert.match(app,/placeholder:"讨厌的东西，过敏，衣服尺码未知"/);
});
test("只有显式preview=1或true启用预览，不把其他参数当开关",async()=>{
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    for (const [index, search] of ['', '?preview=1', '?preview=true', '?preview=0', '?preview=false', '?preview=normal'].entries()) {
      globalThis.location = {search};
      const {PREVIEW_MODE: enabled} = await import(`../public/js/preview-api.js?preview-mode-test=${index}`);
      assert.equal(enabled, search === '?preview=1' || search === '?preview=true', search);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  }
});
test("三方案、用户选择、单礼物账单和失败项禁选",async()=>{
  setPreviewScenario('normal');
  const {data:r}=await previewRequest('/api/recommendations',{intake});
  assert.equal(r.candidates.length,3);
  assert.equal(new Set(r.candidates.map(c=>c.name)).size,3);
  assert.equal(r.selected_candidate_id,null);
  const {data:p}=await previewRequest('/api/presentations',{recommendation_run_id:r.recommendation_run_id,selected_candidate_id:r.candidates[0].id});
  assert.equal(p.recheck_summary.gift_estimated_total,'80.00');
  assert.equal(p.sections.length,4);
  assert.equal(p.recheck_summary.business_data_verification,'not_verified');
  assert.equal(r.validation.candidate_results[0].warnings[0].code,'BELOW_BUDGET_RANGE');
  setPreviewScenario('blocked');
  const {data:b}=await previewRequest('/api/recommendations',{intake});
  assert.deepEqual(b.selectable_candidate_ids,[]);
  assert.equal((await previewRequest('/api/presentations',{recommendation_run_id:b.recommendation_run_id,selected_candidate_id:b.candidates[0].id})).ok,false);
});
test("预览状态：失败可重试，空状态不替选",async()=>{
  setPreviewScenario('error');
  assert.equal((await previewRequest('/api/recommendations',{intake})).ok,false);
  assert.equal((await previewRequest('/api/recommendations',{intake})).ok,true);
  setPreviewScenario('empty');
  const {data}=await previewRequest('/api/recommendations',{intake});
  assert.deepEqual(data.candidates,[]);
  assert.deepEqual(data.selectable_candidate_ids,[]);
});
