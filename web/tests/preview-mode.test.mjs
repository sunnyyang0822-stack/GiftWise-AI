import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PREVIEW_MODE, previewConfig, previewRequest, setPreviewScenario} from "../public/js/preview-api.js";

const intake = {contract_version:"giftwise-20261031-v2",recipient_relation:"pursuit",occasion:"birthday",budget_mode:"slider",budget_range:{min:"100",max:"300"},currency:"CNY",deadline_days:5,interests:[],interest_confidence:{},gift_styles:[],dislikes:"",previous_gifts:"",hard_exclusions:{tags:[],terms:[],unresolved:[]},additional_context:""};
test("本地配置、六档与预算不需要重复确认",async()=>{
  assert.equal(PREVIEW_MODE,true);
  assert.deepEqual(previewConfig.ranges.deadline.map(r=>r.days),[1,5,7,30,90,365]);
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(app,/budget_confirmed|fetch\(/);
  assert.match(app,/previous_gifts: f\.previous_gifts/);
  assert.match(app,/placeholder:"讨厌的东西，过敏，衣服尺码未知"/);
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
