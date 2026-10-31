"""统一 release SHA 上的 previous_gifts 跨层探针；只记录实际行为，不修改被测文件。"""
import importlib.util
import json
from pathlib import Path
import os
import sys

ROOT=Path(os.environ['QA_RELEASE_ROOT']).resolve()
OUT=Path(os.environ['QA_RESULTS']).resolve()
sys.path.insert(0,str(ROOT))
from workflow.intake import adapt_intake as python_adapt

spec=importlib.util.spec_from_file_location('generated_intake',ROOT/'workflow/generated/intake_node.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
generated_adapt=mod.adapt_intake

BASE={"contract_version":"giftwise-20261031-v2","recipient_relation":"friend","occasion":"birthday",
 "budget_mode":"other","budget_range":{"min":"100","max":"200"},"currency":"CNY","deadline_days":5,
 "interests":[],"interest_confidence":{},"gift_styles":[],"dislikes":"不要香水",
 "hard_exclusions":{"tags":[],"terms":[],"unresolved":[]},"additional_context":"QA虚构"}
cases=[
 ('valid',{'previous_gifts':'去年送过一本虚构笔记本'},'ready'),
 ('empty',{'previous_gifts':''},'ready'),
 ('non_string',{'previous_gifts':123},'needs_input'),
 ('long',{'previous_gifts':'字'*1001},'needs_input'),
 ('none',{},'ready'),
]
rows=[]
for name,extra,expected in cases:
 payload={**BASE,**extra};raw=json.dumps(payload,ensure_ascii=False)
 py=python_adapt(raw);gen=generated_adapt(raw)
 for layer,actual in [('workflow.intake.py',py),('workflow/generated/intake_node.py',gen)]:
  request=None
  if actual.get('request_json'):
   request=json.loads(actual['request_json'])
  rows.append({'case':name,'layer':layer,'expected_status':expected,'actual':actual,
               'request_previous_gifts':request.get('previous_gifts') if request else None,
               'request_hard_exclusions':request.get('hard_exclusions') if request else None,
               'request_dislikes':request.get('dislikes') if request else None,
               'status_matches_expected':actual.get('status')==expected})
counts={'PASS':sum(r['status_matches_expected'] for r in rows),'FAIL':sum(not r['status_matches_expected'] for r in rows)}
parity=[]
for name in [c[0] for c in cases]:
 a=[r for r in rows if r['case']==name]
 parity.append({'case':name,'same_status':a[0]['actual'].get('status')==a[1]['actual'].get('status'),
  'same_request_json':a[0]['actual'].get('request_json')==a[1]['actual'].get('request_json')})
result={'release_sha':os.environ['QA_RELEASE_SHA'],'scope':'offline_release_probe','counts':counts,'parity':parity,'rows':rows,
 'note':'未调用Dify；ready仅表示本地适配输出，不表示真实工作流成功。'}
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'counts':counts,'parity':parity},ensure_ascii=False,indent=2))
raise SystemExit(1 if counts['FAIL'] or any(not p['same_status'] or not p['same_request_json'] for p in parity) else 0)
