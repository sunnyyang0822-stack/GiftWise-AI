"""迁移预回归采集：独立目录、原始字节、精确版本，不自动更新指纹/合并 PR。"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
PY = 'C:/Users/lenovo/AppData/Local/Programs/Python/Python312/python.exe'


def stamp():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat()


def main():
    out = ROOT / 'docs/test-reports/rev-qa-001/migration-20261031' / datetime.datetime.now().strftime('%H%M%S-%f')
    out.mkdir(parents=True, exist_ok=False)
    env = {**os.environ, 'PYTHONIOENCODING':'utf-8', 'GW_MODE':'mock'}
    def git(*args):
        return subprocess.check_output(['git',*args],cwd=ROOT,text=True,encoding='utf-8')
    record = {'start':stamp(),'qa_head':git('rev-parse','HEAD').strip(),
        'release_sha':git('rev-parse','origin/release/2026-11-01-submission').strip(),
        'worktree':str(ROOT),'initial_status':git('status','--short'),
        'python':subprocess.check_output([PY,'--version'],text=True).strip(),
        'scope':('post-rebuild migration on release 3dfb186 with reviewed QA pins'
                 if git('rev-parse','origin/release/2026-11-01-submission').strip().startswith('3dfb186')
                 else 'pre-rebuild migration; fingerprint gates not yet closed'),
        'commands':[]}
    historical = git('ls-files','docs/test-reports/rev-qa-001/final-20261031').splitlines()
    protected = git('ls-files','validator','web/server','web/public','workflow','tests/test_cases.json','tests/test_validator.py').splitlines()
    def hashes(paths):
        return {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}
    before = hashes(protected+historical)
    (out/'changes-under-test.patch').write_bytes(subprocess.check_output(['git','diff','HEAD','--','tests/acceptance'],cwd=ROOT))
    # 先归档真实内容差异，再记录指纹；不更改 pinned_hashes.json 或生成物。
    (out/'reviewed-business-changes.patch').write_bytes(subprocess.check_output(['git','diff','e4ba08f',record['release_sha'],'--','validator/rules.py','tests/test_cases.json'],cwd=ROOT))
    baseline = json.loads((ROOT/'tests/acceptance/stage_b/pinned_hashes.json').read_text(encoding='utf-8'))
    record['fingerprint_review']={'pin_update_performed':bool(baseline.get('content_review_evidence')),'existing_pins':baseline['files'],
        'current_observed_after_content_review':hashes(baseline['files'])}
    for name,args in [
        ('prepare-migration',['tests/acceptance/nov01_revision/prepare_migration.py']),
        ('prepare-fixtures',['tests/acceptance/nov01_revision/prepare_fixtures.py','--check']),
        ('nov01',['tests/acceptance/nov01_revision/run_nov01.py']),
        ('main',['-m','unittest','discover','-s','tests','-q']),
        ('stage-b',['-m','unittest','discover','-s','tests/acceptance/stage_b','-v']),
        ('stage-c',['-m','unittest','discover','-s','tests/acceptance/stage_c','-q']),
        ('boundary',['-m','unittest','discover','-s','tests/acceptance/boundary','-v']),
        ('revision-rules',['node','web/tests/revision-rules.test.mjs'])]:
        start = stamp()
        command = args if args[0] == 'node' else [PY,*args]
        run = subprocess.run(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
        for stream in ('stdout','stderr'):
            (out/f'{name}.{stream}.txt').write_bytes(getattr(run,stream))
        record['commands'].append({'name':name,'command':command,'start':start,'end':stamp(),
            'exit_code':run.returncode,'status':'PASS' if run.returncode==0 else 'FAIL'})
        print(name,run.returncode)
    after = hashes(protected+historical)
    record.update(end=stamp(),protected_unchanged=before==after,protected_sha256=after)
    (out/'summary.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Evidence:',out)
    assert before==after,'业务代码或历史证据发生变化'
    return int(any(c['exit_code'] for c in record['commands']))


if __name__ == '__main__':
    sys.exit(main())
