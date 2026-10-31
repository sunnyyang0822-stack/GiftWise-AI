"""仅离线重建、独立哈希与临时副本验收，保留所有命令失败。"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).parent / datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%dT%H%M%S%f+0800')
OUT.mkdir()
sys.path.insert(0, str(ROOT))
env = dict(os.environ, PYTHONIOENCODING='utf-8')
def write(name, value):
    with (OUT / name).open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')
def run(label, args, cwd):
    r = subprocess.run(args, cwd=cwd, env=env, capture_output=True)
    (OUT / (label + '.stdout.txt')).write_bytes(r.stdout)
    (OUT / (label + '.stderr.txt')).write_bytes(r.stderr)
    return {'command':args, 'exit_code':r.returncode, 'status':'PASS' if r.returncode == 0 else 'FAIL'}
summary = {'baseline':subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(), 'python':sys.version, 'commands':{}, 'Dify':'SKIP', 'online_model':'SKIP', 'model_calls':0, 'tokens':'未执行', 'latency':'未执行', 'cost':'未执行'}
summary['commands']['build'] = run('build', [sys.executable,'workflow/build_code_node.py'], ROOT)
assert summary['commands']['build']['exit_code'] == 0
manifest = json.loads((ROOT/'workflow/generated/manifest.json').read_text(encoding='utf-8'))
hashes = []
for group, base in [('sources_sha256', ROOT), ('artifacts_sha256',ROOT/'workflow/generated')]:
    for name, expected in manifest[group].items():
        actual = hashlib.sha256((base/name).read_bytes()).hexdigest()
        hashes.append({'group':group,'file':name,'expected':expected,'actual':actual,'passed':actual==expected})
assert len(hashes)==9 and all(h['passed'] for h in hashes)
write('hashes.json', hashes)
with tempfile.TemporaryDirectory(prefix='giftwise-qa51-offline-') as tmp:
    clone=Path(tmp)
    (clone/'docs').mkdir()
    shutil.copy2(ROOT/'docs/intake-contract.md',clone/'docs/intake-contract.md')
    for folder in ('workflow','validator','tests'):
        shutil.copytree(ROOT/folder,clone/folder,ignore=shutil.ignore_patterns('evidence','tools','__pycache__'))
    for args in (['git','init','-q',str(clone)], ['git','-C',str(clone),'fetch','-q',str(ROOT),'HEAD'], ['git','-C',str(clone),'update-ref','HEAD','FETCH_HEAD']):
        subprocess.run(args,check=True,capture_output=True)
    for label, args in [('old-probes',['workflow/verify_local.py']),('nov01-probes',['workflow/verify_local.py','--nov01']),('stage-c',['-m','unittest','discover','-s','tests/acceptance/stage_c','-v'])]:
        summary['commands'][label]=run(label,[sys.executable,*args],clone)
    for pattern in ('workflow/evidence/local-2026-10-29/runs/*/results.json','docs/test-reports/nov01-workflow/probes-*.json'):
        for p in clone.glob(pattern):
            write('actual-'+p.parent.name+'-'+p.name,json.loads(p.read_text(encoding='utf-8')))
from workflow.intake import dump
from workflow.runtime import check, report, recheck
data=json.loads((ROOT/'workflow/examples/nov01/cases.json').read_text(encoding='utf-8'))
req, batch=data['request'],data['candidates']
raw=dump(req)
normal=report(check(raw,dump(batch)))
assert normal['all_passed'] and normal['selected_candidate_id'] is None and normal['repair_count']==0
assert normal['request']==req and normal['request']['budget_range']=={'min':'100','max':'300'}
assert '礼物本身估价' in normal['report_text'] and '推断：' in normal['report_text'] and '未知：' in normal['report_text']
assert any(w['code']=='BELOW_BUDGET_RANGE' for c in normal['validation']['candidate_results'] for w in c['warnings'])
zero=report(check(dump(data['zero']['request']),dump(data['zero']['candidates'])))
assert zero['all_passed'] and zero['request']['budget_amount']=='0'
failure=report(recheck(raw,dump(data['revision']['initial']),dump(data['revision']['revised'])))
assert failure['status']=='failed' and failure['repair_count']==1 and failure['remaining_repairs']==0 and failure['request']==req
write('semantics.json',{'normal':normal,'zero':zero,'revision_failed':failure,'passed':True,'scope':'固定虚构候选的代码行为；不是模型生成或修订'})
summary['hash_checks']={'passed':9,'failed':0}
summary['semantics']='PASS'
write('summary.json',summary)
print(json.dumps(summary,ensure_ascii=False,indent=2))
print('Evidence:',OUT)
