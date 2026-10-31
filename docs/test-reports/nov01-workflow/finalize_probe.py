"""隔离运行历史探针，并实测冻结输入到生成节点的传递；不联网。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from workflow.intake import adapt_intake, dump

OUT = Path(__file__).parent / 'final-baseline-ce5fd11'
OUT.mkdir(exist_ok=True)

def write(name, value):
    with (OUT / name).open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')

manifest = json.loads((ROOT / 'workflow/generated/manifest.json').read_text(encoding='utf-8'))
for name, expected in manifest['sources_sha256'].items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
for name, expected in manifest['artifacts_sha256'].items():
    assert hashlib.sha256((ROOT / 'workflow/generated' / name).read_bytes()).hexdigest() == expected, name
write('manifest-check.json', {'sources': 4, 'artifacts': 5, 'all_matched': True, 'manifest': manifest})

# 原历史探针会写指针和索引；只在临时副本运行，历史证据不复制。
with tempfile.TemporaryDirectory(prefix='giftwise-wf-final-') as tmp:
    clone = Path(tmp)
    for folder in ('workflow', 'validator'):
        shutil.copytree(ROOT / folder, clone / folder,
                        ignore=shutil.ignore_patterns('evidence', 'tools', '__pycache__'))
    subprocess.run(['git', 'init', '-q', str(clone)], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(clone), 'fetch', '-q', str(ROOT), 'HEAD'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(clone), 'update-ref', 'HEAD', 'FETCH_HEAD'], check=True, capture_output=True)
    for label, args in [('legacy', []), ('nov01', ['--nov01'])]:
        result = subprocess.run([sys.executable, 'workflow/verify_local.py', *args], cwd=clone,
                                env=dict(os.environ, PYTHONIOENCODING='utf-8'), capture_output=True, text=True)
        write(label + '-command.json', {'command': [sys.executable, 'workflow/verify_local.py', *args],
                                      'exit_code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr})
    for pattern in ('workflow/evidence/local-2026-10-29/runs/*/results.json', 'docs/test-reports/nov01-workflow/probes-*.json'):
        for p in clone.glob(pattern):
            write('actual-' + p.parent.name + '-' + p.name, json.loads(p.read_text(encoding='utf-8')))

data = json.loads((ROOT / 'workflow/examples/intake.json').read_text(encoding='utf-8'))
data.pop('budget_amount')
data.update(contract_version='giftwise-20261031-v2', budget_mode='other',
            budget_range={'min':'125.50','max':'275.75'}, deadline_days=5,
            recipient_relation='other', recipient_relation_custom='社团搭档',
            occasion='other', occasion_custom='项目收尾感谢', dislikes='')
js = "import {adaptIntake} from './web/server/intake.mjs'; const d=JSON.parse(process.argv[1]);console.log(JSON.stringify(adaptIntake(JSON.stringify(d))));"
proc = subprocess.run(['node', '--input-type=module', '-e', js, dump(data)], cwd=ROOT,
                      capture_output=True, text=True, encoding='utf-8')
assert proc.returncode == 0, proc.stderr
adapted_js = json.loads(proc.stdout)
assert adapted_js['status'] == 'ready', adapted_js
request = json.loads(adapted_js['request_json'])
assert request['recipient_relation'] == data['recipient_relation_custom']
assert request['occasion'] == data['occasion_custom']
assert request['budget_range'] == data['budget_range'] and request['budget_amount'] == '275.75'
adapted_py = adapt_intake(dump(data))
assert adapted_py['status'] == 'needs_input'
assert any(e['path'] == 'intake.recipient_relation_custom' for e in adapted_py['errors'])
namespace = {}
exec(compile((ROOT / 'workflow/generated/code_node.py').read_text(encoding='utf-8'), 'generated', 'exec'), namespace)
batch = json.loads((ROOT / 'workflow/examples/nov01/cases.json').read_text(encoding='utf-8'))['candidates']
out = namespace['main']('check', dump({'request_json':adapted_js['request_json'], 'candidates_json':dump(batch),'repair_count':0}))
state = json.loads(out['envelope_json'])
assert state['request_json'] == adapted_js['request_json'] and out['all_passed']
report = namespace['report'](state)
assert report['request'] == request and '礼物本身估价' in report['report_text']
write('custom-transfer.json', {'intake':data, 'js':adapted_js, 'python':adapted_py,
                             'generated_check':out, 'report':report,
                             'pm_gap':'Python intake拒绝custom文本字段；JS冻结请求可原样通过Code校验和报告',
                             'model_calls':0, 'cloud_not_verified':True})
print('manifest 4 sources/5 artifacts matched; custom JS->generated->report preserved; Python intake gap recorded')
