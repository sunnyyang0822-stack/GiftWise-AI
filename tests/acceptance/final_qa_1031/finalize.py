"""归档自动生成证据，恢复 verify_local 产生的换行/证据指针写入。"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/test-reports/final-qa-1031/evidence'
summary=json.loads((OUT/'summary.json').read_text(encoding='utf-8'))
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
archive=OUT/'workflow-verification'
archive.mkdir(exist_ok=False)
for p in (ROOT/'workflow/evidence/local-2026-10-29/runs').glob('20261031T122647+0800'):
    shutil.copytree(p,archive/p.name)
for p in (ROOT/'docs/test-reports/nov01-workflow').glob('probes-20261031T122648+0800.json'):
    shutil.copy2(p,archive/p.name)
(OUT/'workflow-run-side-effects.patch').write_bytes(git('diff','HEAD','--','workflow'))
restored=[]
for path in summary['changed_business_files']:
    expected=summary['business_before'][path]
    data=git('show','HEAD:'+path)
    options=[data,data.replace(b'\r\n',b'\n'),data.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')]
    original=next(x for x in options if hashlib.sha256(x).hexdigest()==expected)
    # 仅恢复本次命令产生的变化；固定版本副本中没有其他人的并行写入。
    (ROOT/path).write_bytes(original)
    restored.append(path)
checked={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in summary['business_before']}
assert checked==summary['business_before']
(OUT/'protected-source-check.json').write_text(json.dumps({
    'release_sha':summary['release_sha'],'restored_command_side_effects':restored,
    'all_protected_files_identical_before_after':True,'hashes':checked},indent=2),encoding='utf-8')
(OUT/'qa-changes.patch').write_bytes(git('diff','HEAD','--','tests/acceptance','web/tools/browser-check.mjs'))
commands=summary['runs']+json.loads((OUT/'network-summary.json').read_text(encoding='utf-8'))['runs']+json.loads((OUT/'supplement-summary.json').read_text(encoding='utf-8'))
counts={'PASS':sum(c['exit_code']==0 for c in commands),'FAIL':sum(c['exit_code']!=0 for c in commands)}
(OUT/'command-index.json').write_text(json.dumps({'executed_commands':len(commands),'counts':counts,'commands':commands},ensure_ascii=False,indent=2),encoding='utf-8')
print(counts, '业务源码恢复后逐字节一致')
