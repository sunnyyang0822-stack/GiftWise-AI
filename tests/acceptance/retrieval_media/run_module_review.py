"""明确记录各PR副本及SHA，不合并分支、不调用真实检索或生图。"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/test-reports/retrieval-media/module-review-20261031'
OUT.mkdir(exist_ok=False)
targets={
 'backend':('qa-rm-backend-0346','0346f5364a0fdaeb0e6290b425892b1970f7eb89',61),
 'workflow':('qa-rm-workflow-277b','277b71d0042163a808a39b513edac684fb694747',58),
 'frontend':('qa-rm-frontend-dd50','dd50fefc6ab9cf86a11e23a93a43e9fd7b3c6b53',57),
 'seed':('qa-rm-seed-a4d6','a4d639bb757cc99315ca9acc633d45192d20c15a',64)}
summary={'scope':'independent_PR_module_reviews_not_release_integration','targets':{},'commands':[]}
def git(root,*args):return subprocess.check_output(['git',*args],cwd=root)
def hashes(root):
    return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in git(root,'ls-files').decode().splitlines() if (root/p).is_file()}
for key,(folder,sha,pr) in targets.items():
    root=ROOT.parent/folder
    assert git(root,'rev-parse','HEAD').decode().strip()==sha
    assert not git(root,'status','--porcelain').strip()
    summary['targets'][key]={'root':str(root),'sha':sha,'pr':pr,'initial_status':'clean','before':hashes(root)}
env=dict(os.environ,GW_MODE='mock',GIFTWISE_RETRIEVAL='',PYTHONIOENCODING='utf-8')
for key in ['backend','seed']:
    info=summary['targets'][key]
    env['QA_'+key.upper()+'_ROOT']=info['root'];env['QA_'+key.upper()+'_SHA']=info['sha']
    env['QA_RESULTS']=str(OUT/(key+'-results.json'))
    cmd=['node',str(Path(__file__).with_name('review_modules.mjs'))] if key=='backend' else [sys.executable,str(Path(__file__).with_name('review_seed.py'))]
    start=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat()
    p=subprocess.run(cmd,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
    (OUT/(key+'.stdout.txt')).write_bytes(p.stdout);(OUT/(key+'.stderr.txt')).write_bytes(p.stderr)
    summary['commands'].append(dict(target=key,command=cmd,started=start,finished=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),exit_code=p.returncode))
    print(key,p.returncode)
for key,info in summary['targets'].items():
    root=Path(info['root']);info['after_status']=git(root,'status','--porcelain').decode();info['tracked_files_unchanged']=hashes(root)==info['before']
    assert info['tracked_files_unchanged']
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
