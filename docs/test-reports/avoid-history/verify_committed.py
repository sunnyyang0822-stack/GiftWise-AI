"""先校验提交原件，之后才允许重建；所有执行发生在git archive全新副本。"""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[3]
SHA = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
OUT = Path(__file__).parent / ('bytes-' + datetime.now(timezone(timedelta(hours=8))).strftime('%Y%m%dT%H%M%S%f+0800'))
OUT.mkdir()
def verify(root):
    manifest = json.loads((root/'workflow/generated/manifest.json').read_bytes())
    checks = []
    for field, base in [('sources_sha256', root), ('artifacts_sha256', root/'workflow/generated')]:
        for name, expected in manifest[field].items():
            actual = hashlib.sha256((base/name).read_bytes()).hexdigest()
            checks.append({'file': name, 'expected': expected, 'actual': actual, 'passed': actual == expected})
    assert len(checks) == 9
    return checks
result = {'tested_commit': SHA, 'online_calls': 0, 'Dify':'未执行', 'tokens':'未执行', 'model_latency':'未执行', 'cost':'未执行'}
with tempfile.TemporaryDirectory(prefix='giftwise-blob-') as tmp:
    clone = Path(tmp)
    archive = subprocess.check_output(['git','archive','--format=zip',SHA],cwd=ROOT)
    zipfile.ZipFile(io.BytesIO(archive)).extractall(clone)
    # 此处之前没有运行构建、探针或任何会改写导出文件的命令。
    result['committed_before_rebuild'] = verify(clone)
    assert all(c['passed'] for c in result['committed_before_rebuild'])
    before = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (clone/'workflow/generated').iterdir()}
    for args in (['git','init','-q',str(clone)], ['git','-C',str(clone),'fetch','-q',str(ROOT),SHA], ['git','-C',str(clone),'update-ref','HEAD','FETCH_HEAD']):
        subprocess.run(args,check=True,capture_output=True)
    result['commands'] = []
    for label, args in [('build',['workflow/build_code_node.py']),('main',['-m','unittest','discover','-s','tests','-q']),('legacy',['workflow/verify_local.py']),('nov01',['workflow/verify_local.py','--nov01']),('stage-c',['-m','unittest','discover','-s','tests/acceptance/stage_c','-v']),('context',['workflow/examples/avoid-history/verify.py'])]:
        cmd = [sys.executable,*args]
        proc = subprocess.run(cmd,cwd=clone,env=dict(os.environ,PYTHONIOENCODING='utf-8'),capture_output=True)
        (OUT/(label+'.stdout.txt')).write_bytes(proc.stdout)
        (OUT/(label+'.stderr.txt')).write_bytes(proc.stderr)
        result['commands'].append({'label':label,'command':cmd,'exit_code':proc.returncode})
    result['after_rebuild'] = verify(clone)
    after = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (clone/'workflow/generated').iterdir()}
    result['rebuild_byte_identical'] = before == after
    assert all(c['passed'] for c in result['after_rebuild']) and before == after
(OUT/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
print(OUT)
