"""同一契约输入分别验证 Python 工作流与 JS 接入；不调用模型。"""
import copy
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from workflow.intake import adapt_intake

BASE = dict(contract_version='giftwise-20261031-v2', recipient_relation='pursuit',
    occasion='birthday', budget_mode='other', budget_range={'min':'0','max':'300'},
    currency='CNY', deadline_days=5, closeness='unknown', interests=[],
    interest_confidence={}, gift_styles=[], dislikes='',
    hard_exclusions={'tags':[],'terms':[],'unresolved':[]}, additional_context='QA虚构案例')
CASES = []
for relation in ['partner','pursuit','friend']:
    CASES.append((relation, {**copy.deepcopy(BASE),'recipient_relation':relation}, 'ready', None))
for field in ['recipient_relation','occasion']:
    custom=field+'_custom'
    valid={**copy.deepcopy(BASE),field:'other',custom:'虚构补充说明'}
    CASES.append((custom+'_valid',valid,'ready',(field,'虚构补充说明')))
    CASES.append((custom+'_missing',{**copy.deepcopy(BASE),field:'other'},'needs_input',None))
    CASES.append((custom+'_illegal_combination',{**copy.deepcopy(BASE),custom:'虚构补充说明'},'needs_input',None))

class IntakeParity(unittest.TestCase):
    records=[]
    @classmethod
    def tearDownClass(cls):
        out=ROOT/'docs/test-reports/final-qa-1031/evidence/intake-parity-results.json'
        out.write_text(json.dumps(cls.records,ensure_ascii=False,indent=2),encoding='utf-8')

def install(layer,case):
    name,payload,status,field=case
    def test(self):
        if layer=='python':
            actual=adapt_intake(json.dumps(payload,ensure_ascii=False))
        else:
            source="import {adaptIntakeObject} from './web/server/intake.mjs'; let raw=''; for await(const b of process.stdin) raw+=b; console.log(JSON.stringify(adaptIntakeObject(JSON.parse(raw))));"
            proc=subprocess.run(['node','--input-type=module','-e',source],cwd=ROOT,
                input=json.dumps(payload,ensure_ascii=False).encode(),capture_output=True,check=True)
            actual=json.loads(proc.stdout)
        record=dict(layer=layer,id=name,input=payload,expected_status=status,actual=actual)
        self.records.append(record)
        self.assertEqual(actual['status'],status,json.dumps(record,ensure_ascii=False))
        if field:
            request=json.loads(actual['request_json'])
            self.assertEqual(request[field[0]],field[1])
            self.assertEqual(request[field[0]+'_custom'],field[1])
    setattr(IntakeParity,'test_'+layer+'_'+name,test)

for layer in ['python','js']:
    for case in CASES:install(layer,case)

if __name__=='__main__':unittest.main(verbosity=2)
