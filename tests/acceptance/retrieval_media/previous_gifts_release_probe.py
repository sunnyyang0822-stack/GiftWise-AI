"""Release regression probe for previous_gifts; offline only."""
import importlib.util
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from workflow.intake import adapt_intake as source_adapt
spec=importlib.util.spec_from_file_location('generated_intake',ROOT/'workflow/generated/intake_node.py')
gen=importlib.util.module_from_spec(spec); spec.loader.exec_module(gen)
BASE={"contract_version":"giftwise-20261031-v2","recipient_relation":"friend","closeness":"familiar","occasion":"birthday","budget_mode":"slider","budget_range":{"min":"100","max":"300"},"budget_amount":"300.00","currency":"CNY","deadline_days":5,"interests":["coffee_food"],"interest_confidence":{"coffee_food":"confirmed"},"gift_styles":["practical"],"hard_exclusions":{"tags":[],"terms":[],"unresolved":[]},"additional_context":"offline fixture"}
def run(adapt,payload): return adapt(json.dumps(payload,ensure_ascii=False))
def check(name,payload,predicate):
 a=run(source_adapt,payload); b=run(gen.adapt_intake,payload); assert predicate(a),(name,a); assert a==b,(name,'source/generated mismatch',a,b); print('PASS',name,a['status'])
check('omitted',BASE,lambda x:x['status']=='ready' and json.loads(x['request_json']).get('previous_gifts','') == '')
for value,name in [('', 'empty'),('   ','whitespace')]:
 p=dict(BASE,previous_gifts=value); check(name,p,lambda x:x['status']=='ready' and json.loads(x['request_json']).get('previous_gifts','') == '')
text='去年送过蓝色杯具，想换个方向'; p=dict(BASE,previous_gifts=text); check('valid',p,lambda x:x['status']=='ready' and json.loads(x['request_json'])['previous_gifts']==text and json.loads(x['request_json']).get('dislikes','')=='' and json.loads(x['request_json'])['hard_exclusions_original']==BASE['hard_exclusions'])
p=dict(BASE,previous_gifts=123); check('non-string',p,lambda x:x['status']=='needs_input' and any(e['code']=='INVALID_TYPE' and e['path']=='intake.previous_gifts' for e in x['errors']))
p=dict(BASE,previous_gifts='x'*1001); check('over-limit',p,lambda x:x['status']=='needs_input' and any(e['code']=='LIMIT_EXCEEDED' and e['path']=='intake.previous_gifts' for e in x['errors']))
print('PASS source/generated parity: all six cases')
print('Dify external variable: intake_json; internal request_json is adapter output')

