"""固定 SHA 独立 QA：原样记录输出；仅迁移测试资产，不改业务源码。"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/test-reports/final-qa-1031/evidence'
OUT.mkdir(parents=True, exist_ok=False)
ZONE = dt.timezone(dt.timedelta(hours=8))
ENV = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUTF8='1', GW_MODE='mock')
QA = '48904eb99261ed1186481af795f9dd7a4c696a3d'
summary = {'time_zone':'Asia/Shanghai', 'qa_source_commit':QA, 'runs':[]}

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def fingerprints():
    return {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
            for p in git('ls-files', 'validator', 'web/server', 'web/public', 'workflow').decode().splitlines()
            if (ROOT/p).is_file()}

def save():
    (OUT/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

def run(name, command, timeout=180):
    start = dt.datetime.now(ZONE).isoformat()
    with (OUT/(name+'.stdout.txt')).open('wb') as stdout, (OUT/(name+'.stderr.txt')).open('wb') as stderr:
        try:
            result = subprocess.run(command, cwd=ROOT, env=ENV, stdout=stdout, stderr=stderr, timeout=timeout)
            code = result.returncode
        except subprocess.TimeoutExpired:
            code = 'TIMEOUT'
    summary['runs'].append(dict(name=name,command=command,cwd=str(ROOT),started=start,
        finished=dt.datetime.now(ZONE).isoformat(),exit_code=code))
    save()
    print(name, code, flush=True)

summary['release_sha'] = git('rev-parse','HEAD').decode().strip()
summary['initial_status'] = git('status','--short').decode()
summary['business_before'] = fingerprints()
save()
py = sys.executable
commands = [
 ('nov01',[py,'tests/acceptance/nov01_revision/run_nov01.py']),
 ('main',[py,'-m','unittest','discover','-s','tests','-q']),
 ('stage-b',[py,'-m','unittest','discover','-s','tests/acceptance/stage_b','-q']),
 ('stage-c',[py,'-m','unittest','discover','-s','tests/acceptance/stage_c','-q']),
 ('boundary',[py,'-m','unittest','discover','-s','tests/acceptance/boundary','-q']),
]
for name,command in commands:
    run('release-'+name,command)
for name in ['exclusions','revision-rules','revision-api','access-layer']:
    run(name,['node',f'web/tests/{name}.test.mjs'])

# 来源于已审阅的 QA PR51，保留基线失败；不从实际业务输出推导期望。
paths = git('ls-tree','-r','--name-only',QA,'tests/acceptance/nov01_revision').decode().splitlines()
paths += ['tests/acceptance/stage_b/build_cases.py','tests/acceptance/stage_b/cases.json',
          'tests/acceptance/stage_b/pinned_hashes.json',
          'tests/acceptance/boundary/test_boundary_ranges.py',
          'tests/acceptance/boundary/test_error_composition.py']
summary['qa_overlay_files'] = paths
for p in paths:
    dest = ROOT/p
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(git('show',QA+':'+p))
for name,command in commands:
    run('qa-migrated-'+name,command)
run('fixture-check',[py,'tests/acceptance/nov01_revision/prepare_fixtures.py','--check'])
run('backend',['node','tests/acceptance/nov01_revision/backend-revision.mjs'])
run('snapshot',['node','tests/acceptance/nov01_revision/snapshot-revision.mjs'])
run('workflow-default',[py,'workflow/verify_local.py'])
run('workflow-nov01',[py,'workflow/verify_local.py','--nov01'])
summary['business_after'] = fingerprints()
summary['changed_business_files'] = [p for p,h in summary['business_before'].items() if summary['business_after'].get(p)!=h]
summary['final_status'] = git('status','--short').decode()
save()
