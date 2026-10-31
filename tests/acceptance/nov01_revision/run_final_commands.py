"""QA 命令采集器：保留原始 stdout/stderr 字节、退出码和版本，不重写断言。"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'docs/test-reports/rev-qa-001/final-20261031/raw-python312'
PY = Path('C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe')
COMMANDS = [
    ('old-main', [str(PY), '-m', 'unittest', 'discover', '-s', 'tests', '-q']),
    ('old-stage-b', [str(PY), '-m', 'unittest', 'discover', '-s', 'tests/acceptance/stage_b', '-q']),
    ('old-stage-c', [str(PY), '-m', 'unittest', 'discover', '-s', 'tests/acceptance/stage_c', '-q']),
    ('old-boundary', [str(PY), '-m', 'unittest', 'discover', '-s', 'tests/acceptance/boundary', '-q']),
    ('exclusions', ['node', 'web/tests/exclusions.test.mjs']),
    ('revision-rules', ['node', 'web/tests/revision-rules.test.mjs']),
    ('revision-api', ['node', 'web/tests/revision-api.test.mjs']),
    ('access-layer', ['node', 'web/tests/access-layer.test.mjs']),
    ('prepare-fixtures', [str(PY), 'tests/acceptance/nov01_revision/prepare_fixtures.py']),
    ('nov01', [str(PY), 'tests/acceptance/nov01_revision/run_nov01.py']),
]

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=False)
    def stamp():
        return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat()
    record = {'start': stamp(), 'head': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              'initial_status': subprocess.check_output(['git','status','--short'],cwd=ROOT,text=True), 'commands': []}
    paths = ['validator/rules.py','workflow/intake.py','web/server/checker.mjs','web/server/pipeline.mjs',
             'web/server/server.mjs','web/server/config.mjs','web/public/app.js','web/public/index.html']
    record['business_hashes_before'] = {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}
    for name, cmd in COMMANDS:
        start = stamp()
        env = os.environ.copy()
        env['PYTHONIOENCODING'] = 'utf-8'
        env['GW_MODE'] = 'mock'
        result = subprocess.run(cmd,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
        for stream in ['stdout','stderr']:
            (OUT/f'{name}.{stream}.txt').write_bytes(getattr(result,stream))
        record['commands'].append({'name':name,'command':cmd,'start':start,'end':stamp(),
                                   'exit_code':result.returncode,'status':'PASS' if result.returncode==0 else 'FAIL'})
        print(name, result.returncode)
    record['business_hashes_after'] = {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}
    record['end'] = stamp()
    (OUT/'summary.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    sys.exit(any(x['exit_code'] for x in record['commands']))
