import pathlib, subprocess, os, sys, json, datetime, hashlib, shutil, socket
sys.stdout.reconfigure(encoding='utf-8')
root=pathlib.Path(r'E:\黑客松\.worktrees\independent-qa-eceef056-20261031')
out=pathlib.Path(r'E:\黑客松\.tmp\handoff-eceef056\qa-d')
node=shutil.which('node'); python=sys.executable
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def git(*args): return subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'-c','maintenance.auto=false','-c','gc.auto=0',*args],cwd=root).decode().strip()
mode=sys.argv[1] if len(sys.argv)>1 else 'offline'
assert mode in ['offline','http']
label=sys.argv[2] if len(sys.argv)>2 else mode
assert label.replace('-','').isalnum()
run=out/label;run.mkdir(exist_ok=True)
assert not (run/'execution.json').exists(), 'Never overwrite previous evidence'
runtime=root/'.tmp'/('independent-final-'+label);runtime.mkdir(parents=True,exist_ok=True)
env={k:os.environ[k] for k in ['SystemRoot','WINDIR','COMSPEC','PATHEXT'] if k in os.environ}
env.update(PATH=os.pathsep.join([str(pathlib.Path(node).parent),str(pathlib.Path(python).parent),str(pathlib.Path(os.environ['SystemRoot'])/'System32')]),TEMP=str(runtime),TMP=str(runtime),TMPDIR=str(runtime),XDG_CACHE_HOME=str(runtime/'cache'),PYTHONPYCACHEPREFIX=str(runtime/'pycache'),PYTHONDONTWRITEBYTECODE='1',PYTHONUTF8='1',GW_MODE='mock',GW_HOST='127.0.0.1',GW_PORT='8932',QA_HTTP_PORT='8932',QA_ALLOW_HTTP='1' if mode=='http' else '0',GW_LOCAL_DB=str(runtime/'catalog.sqlite'),GW_LLM_LEDGER_FILE=str(runtime/'model-ledger.jsonl'),GIFTWISE_STYLE_DIRECTION_CHANNEL='rules',GIFTWISE_IMAGE_GENERATION='0',GIFTWISE_RETRIEVAL='domestic')
guard=(out/'network-guard.mjs').as_uri()
files=['web/tests/recommendation-grounding.test.mjs','web/tests/text-material-pipeline.test.mjs','web/tests/retrieval-audit-pipeline.test.mjs','web/tests/experience-presentation-a.test.mjs','web/tests/ui-actual-guide-sections.test.mjs','web/tests/ui-recommendation-without-images.test.mjs','web/tests/backend-async-image-a.test.mjs']
pattern='|'.join(['^无初始素材','^一条批次真实素材','^多个候选复用','^已知合法文本缓存','^工具无可用素材','^存在真实资料','^有素材却未引用','^伪造source/','^虚构来源域$','^商店来源$','^非HTTPS$','^缺观察时间$','^非法观察时间$','^非公开参考身份$','^缺标题$','^纯图标题无正文$','^空白摘要$','^default text adapter','^legacy reference image request','^unrelated cached material','^actual permitted merchant','^推荐网图已停用','^final sections reflect','^same final gift name','^纯体验无包装','^旧空包装','^实体方案完整','^体验附实体','^实体合理description','^所有章节为空','^AI图ready仅替换','^错误候选图片','^停推荐网图：(真实参考图|pending与|错绑/重复|选后AI|选后读取|错候选|离开选后|选择仍)','^text returns with persisted','^supplier failure retains','^owner/run/candidate isolation','^reading interrupted task'])
args=[node,'--import',guard,'--test','--test-concurrency=1','--test-reporter=tap']
args+=['--test-name-pattern='+pattern,*files] if mode=='offline' else [str(out/'combined-http.test.mjs')]
head=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}');before=git('status','--porcelain=v1','--untracked-files=no')
assert head=='eceef056ce80399b83c61f62860a32d0ead16e3d' and not before
preflight=None
if mode=='http':
 with socket.socket() as sock:
  sock.bind(('127.0.0.1',8932));preflight=dict(at_utc=utc(),host='127.0.0.1',port=8932,result='bind succeeded, released before own test server')
start=utc()
with (run/'stdout.tap').open('wb') as stdout,(run/'stderr.txt').open('wb') as stderr:
 p=subprocess.run(args,cwd=root,env=env,stdout=stdout,stderr=stderr,timeout=90)
finish=utc();after=git('status','--porcelain=v1','--untracked-files=no')
postflight=None
if mode=='http':
 with socket.socket() as sock:
  sock.bind(('127.0.0.1',8932));postflight=dict(at_utc=utc(),host='127.0.0.1',port=8932,result='released; bind succeeded after test child exited')
meta=dict(tested_code_sha=head,tested_tree=tree,evidence_commit='See remote delivery receipt / fixed URL; not the tested code SHA.',mode=mode,cwd=str(root),start_utc=start,end_utc=finish,exit_code=p.returncode,node_version=subprocess.check_output([node,'--version'],env=env).decode().strip(),python_version=sys.version,argv=args,command_windows=subprocess.list2cmdline(args),test_file_count=len(files) if mode=='offline' else 1,environment_whitelist_keys=sorted(env),environment_task_values={k:v for k,v in env.items() if k not in ['SystemRoot','WINDIR','COMSPEC','PATHEXT','PATH']},credential_environment_inheritance=False,tracked_before=before,tracked_after=after,port_preflight=preflight,port_postflight=postflight,artifact_hashes={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [run/'stdout.tap',run/'stderr.txt']})
(run/'execution.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(meta,ensure_ascii=False,indent=2));print((run/'stdout.tap').read_text(encoding='utf-8')[-4500:]);print('STDERR:',(run/'stderr.txt').read_text(encoding='utf-8'))
sys.exit(p.returncode)
