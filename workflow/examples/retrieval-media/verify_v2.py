"""Offline structural checks for retrieval-media-v2; no provider/model calls."""
import json, math
from pathlib import Path
F=Path(__file__).with_name('v2-cases.json')
d=json.loads(F.read_text(encoding='utf-8'))
assert d['backend_contract_commit']=='f080ad51e0f22ca7384ce3a93f75d0dba91d0508'
assert isinstance(d['previous_gifts'],str) and d['previous_gifts']
assert isinstance(d['retrieval_json'],str) and isinstance(json.loads(d['retrieval_json']),dict)
refs=json.loads(d['product_references_json']); assert len(refs)==3 and all(set(x)=={'candidate_id','product_id'} for x in refs)
assert isinstance(d['intake_json'],str) and json.loads(d['intake_json'])['previous_gifts']==d['previous_gifts']
plan=d['plan']; assert set(plan)=={'category','keywords','limit'}
assert plan['category']=='maker' and plan['keywords']==['kit'] and plan['limit']==3
media=d['media']; assert media['contract_version']=='retrieval-media-v2'
sel=media['selected']; assert sel and sel['status']=='unavailable' and sel['image'] is None and sel['annotations']==[]
assert sel['plan_version']=='packaging-seedream-v1' and sel['execution']=='not_submitted' and sel['annotation_status']=='not_verified'
assert d['dify_input_mapping']=={'external':'intake_json','internal_legacy':'request_json','mapping':'intake_json -> request_json before generation/validation'}
assert set(sel['physical'])=={'dimensions','shape','weight','fragility','materials'}
for x in sel['physical'].values(): assert x=={'status':'unknown','value':None,'unit':None,'sources':[]}
assert sel['packaging']['form']=='undetermined' and sel['packaging']['scale']['status']=='illustrative'
scene=sel['scene']; assert scene['props_are_included'] is False and scene['text_baked_in'] is False
for a in d['annotation_proposals']:
 assert set(a)=={'id','text','target','label','image_version','text_style','curve'}
 assert a['text_style']=='handwritten' and a['image_version']=='offline-proposal-v1'
 assert a['curve'] is None or len(a['curve']['control_points']) in (1,2)
 for p in (a['target'],a['label']):
  assert all(type(v) in (int,float) and not isinstance(v,bool) and math.isfinite(v) and 0<=v<=1 for v in p.values())
print('PASS retrieval-media-v2 offline structure: plan, physical, selected unavailable, scene, annotations, execution/status, Dify mapping')
print('SKIP provider/image/visual-coordinate verification: no real service called')
