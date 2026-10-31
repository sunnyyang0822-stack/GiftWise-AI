import pathlib, json, hashlib, re, datetime, sys, subprocess
sys.stdout.reconfigure(encoding='utf-8')
out=pathlib.Path(r'E:\黑客松\.tmp\handoff-eceef056\qa-d'); pub=out/'publish';pub.mkdir(exist_ok=True)
old=pathlib.Path(r'E:\黑客松\.worktrees\backend-independent-review\.tmp')
qaold=pathlib.Path(r'E:\黑客松\.worktrees\integration-qa-42a1accc-20261031\.tmp')
root=pathlib.Path(r'E:\黑客松\.worktrees\independent-qa-eceef056-20261031')
def sha(b):return hashlib.sha256(b).hexdigest()
entries=[]
rules=[('key',re.compile(r'\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b')),
 ('session_cookie',re.compile(r'gw_task_session=[a-f0-9]{48}\.[a-f0-9]{64}')),
 ('authorization_value',re.compile(r'(?i)(?<=Bearer )[A-Za-z0-9._~+/-]{16,}')),
 ('owner_session_value',re.compile(r'''(?i)(?:(?:owner_scope|ownerScope|session_id|sessionId)["']?\s*[:=]\s*["'])[a-f0-9]{32,64}["']'''))]
def publish(source,destination,context=''):
 source=pathlib.Path(source);data=source.read_bytes();text=data.decode('utf-8-sig');counts={}
 for category,pattern in rules:
  text,n=pattern.subn('[REDACTED:'+category+']',text)
  if n:counts[category]=n
 # Preserve exact byte identity when no context or redaction is needed.
 result=(context+text).encode('utf-8') if context or counts else data
 target=pub/destination;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(result)
 entries.append(dict(published_path=destination,original_local_path=str(source),original_sha256=sha(data),published_sha256=sha(result),bytes=len(result),redaction_counts=counts,context_header_added=bool(context)))
publish(out/'independent-qa-eceef056.md','independent-qa-eceef056.md')
results=[]
for label in ['offline','http','http-attempt-2','http-attempt-3']:
 meta=json.loads((out/label/'execution.json').read_text(encoding='utf-8'))
 tap=(out/label/'stdout.tap').read_text(encoding='utf-8')
 summary={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|skipped|cancelled|suites|todo) (\d+)$',tap,re.M)}
 guards=[json.loads(x) for x in re.findall(r'^# QA_NETWORK_GUARD (.+)$',tap,re.M)]
 sources=[]
 for arg in meta['argv']:
  if arg.endswith('.test.mjs'):
   p=pathlib.Path(arg);p=p if p.is_absolute() else root/p
   # Failed HTTP attempts retain their matching source snapshots, not the corrected current file.
   if label=='http':p=out/'http/combined-http-attempt-1.test.mjs'
   elif label=='http-attempt-2':p=out/'http-attempt-2/combined-http.test.mjs'
   sources.append(dict(path=str(p),sha256=sha(p.read_bytes())))
 results.append(dict(label=label,exit_code=meta['exit_code'],tap_summary=summary,guard_events=guards,test_sources=sources))
(out/'results-index.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');publish(out/'results-index.json','results-index.json')
for label in ['offline','http','http-attempt-2','http-attempt-3']:
 for name in ['stdout.tap','stderr.txt','execution.json']:
  publish(out/label/name,'artifacts/'+label+'/'+name)
for source,destination in [
 (out/'http/network-guard-attempt-1.mjs','artifacts/offline/network-guard-used.mjs'),
 (out/'http/network-guard-attempt-1.mjs','artifacts/http/network-guard-used.mjs'),
 (out/'http/combined-http-attempt-1.test.mjs','artifacts/http/probe-used.test.mjs'),
 (out/'http/run-qa-attempt-1.py','artifacts/http/runner-used.py'),
 (out/'http-attempt-2/network-guard.mjs','artifacts/http-attempt-2/network-guard-used.mjs'),
 (out/'http-attempt-2/combined-http.test.mjs','artifacts/http-attempt-2/probe-used.test.mjs'),
 (out/'http-attempt-2/run-qa.py','artifacts/http-attempt-2/runner-used.py'),
 (out/'network-guard.mjs','artifacts/http-attempt-3/network-guard-used.mjs'),
 (out/'combined-http.test.mjs','artifacts/http-attempt-3/probe-used.test.mjs'),
 (out/'run-qa.py','artifacts/http-attempt-3/runner-used.py')]:publish(source,destination)
history=[
 (115,'dd51324a67832991c11cb76d3d039d35656a3128','pr115-final-review/pr115-independent-review.md','5724681740','实际指南章节；当时仅复用10/10，开发输出工作树HEAD为008，相关源码匹配。'),
 (117,'cacfe958aa8dbf6fcdda51c6bc8754d503291067','pr117-final-review/pr117-independent-review.md','5724692556','可选包装与内容决定章节；35/35含旧25+新10。旧启动/过滤失败仍保留。'),
 (120,'6d162dfd41ea6c08f1110112d8869a2fd9bbe879','pr120-final-review/pr120-independent-review.md','5724742176','推荐文字无图，选后AI仍接线；非阻断diff-check EOF空白差异保留。'),
 (121,'db5e74df236983c979093b0e40c279686f0aa055','pr121-final-review/review.md','5724780375','文字素材/缓存/有界HTTP/取消推荐补图；28.393s仅早于最终增量的一次暖素材模块样本。'),
 (83,'26df1432218a15f49f3de1a796dc19d3d63da287','pr83-independent-review.md','5724187752','选后异步后端；旧一次真实Seedream图和受控文字，不是最终ecee真图或真实文字闭环。'),
 (84,'e2899a1c0789fa929b39de3a26ede77458f52c36','pr84-independent-review.md','5724195494','选后前端只读poll/失效；旧Chrome回放复用83原图，非新增真实供应商。'),
 (95,'1447b4233773e28bfbdd50636eb6af148166536f','frontend-final-102-95/pr95-independent-review.md','5724463591','本地字体扩展；不证明所有字形或最终Linux字体环境。'),
 (102,'1db4949bf7edee0d6c617a6b71958747ea325587','frontend-final-102-95/pr102-independent-review.md','5724463329','选后版式/骨架；原浏览器与素材回放的时点和旧失败均保留，空章后续已由115改变。')]
index=['# 历史独立复核索引','', '以下均为历史独立 Agent 复核，非另一位人类账户批准。适用各自完整SHA；本次未重跑历史测试、浏览器、供应商。后续更改优先，不能将旧报告的当时状态当作当前冻结服务状态。','', '| PR | 受审完整SHA | 原正式复核 | 范围/局限 |','| --- | --- | --- | --- |']
for number,head,rel,review_id,scope in history:
 header=f'> 发布副本：历史 PR#{number}，受审代码 `{head}`。独立 Agent 复核，非另一位人类账户批准；不是最终 eceef056 的新增执行证据。历史服务/合并状态和已被后续改动替代的说明不代表当前状态。原文SHA256与发布SHA256见 publication-manifest.json。\n\n'
 publish(old/rel,f'history/pr{number}-independent-review.md',header)
 url=f'https://github.com/sunnyyang0822-stack/GiftWise-AI/pull/{number}#pullrequestreview-{review_id}'
 index.append(f'| #{number} | `{head}` | [COMMENT]({url}) | {scope} |')
index+=['','旧全量仅索引：受测 `42a1accc7159cae6ee4c6e11e7e170ad02eb1a81`，363 tests / 349 pass / 12 fail / 2 skip / exit1。它不是ecee结果；本次51+1不覆盖全部旧失败。','', '原始根：`E:\\黑客松\\.worktrees\\integration-qa-42a1accc-20261031\\.tmp`。不大量复制旧全量输出；hash索引如下：','']
for name in ['integration-qa-report.md','qa-run-environment.json','qa-run-result.json','qa-failures.json','web-full-raw.txt','web-full-stderr.txt','qa-final-state-manifest.json']:
 p=qaold/name;index.append(f'- `{name}` SHA256 `{sha(p.read_bytes())}`')
(out/'history-index.md').write_text('\n'.join(index)+'\n',encoding='utf-8');publish(out/'history-index.md','history/index.md')
commands=['# 精确命令与原始执行记录','', '受测代码 eceef056ce80399b83c61f62860a32d0ead16e3d，证据commit见PM远端回执。以下命令包含过滤表达式，必须使用execution.json内argv或启动器，不能把竖线当shell管道。脚本中的本地工作树/输出路径是本次原始配置；跨设备应显式改为对应项目内目录，并重新记录受测SHA。旧工作树不能作为运行依赖。','', 'Node子进程环境用Python subprocess env白名单重建，不继承真实凭据。每组完整环境键和值、起止UTC、真实Node退出码在artifacts/<组>/execution.json。当前根runner用于复现；离线执行当时的guard副本另保留。','']
for label in ['offline','http','http-attempt-2','http-attempt-3']:
 meta=json.loads((out/label/'execution.json').read_text(encoding='utf-8'));commands += [f'## {label}', '', '```text',meta['command_windows'],'```','',f"cwd={meta['cwd']}; exit={meta['exit_code']}; UTC={meta['start_utc']} → {meta['end_utc']}",'']
(out/'commands.md').write_text('\n'.join(commands),encoding='utf-8');publish(out/'commands.md','commands.md')
for name in ['run-qa.py','network-guard.mjs','combined-http.test.mjs','prepare-publication.py']:publish(out/name,'tools/'+name)
git=lambda *a:subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),*a],cwd=root).decode().strip()
state=dict(at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),tested_code_sha=git('rev-parse','HEAD'),tested_tree=git('rev-parse','HEAD^{tree}'),tracked_status=git('status','--porcelain=v1','--untracked-files=no'),branch=git('rev-parse','--abbrev-ref','HEAD'),runtime_ledger_files=list(str(p) for p in (root/'.tmp').glob('independent-final-*/model-ledger.jsonl')),evidence_commit='Not yet committed. See PM remote delivery receipt / fixed URL.')
(out/'final-code-state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8');publish(out/'final-code-state.json','final-code-state.json')
assert state['tracked_status']=='' and state['branch']=='HEAD'
manifest=dict(tested_code_sha=state['tested_code_sha'],tested_tree=state['tested_tree'],evidence_commit='Not yet committed. See PM remote delivery receipt / fixed URL.',scope='Selected text only; no DB/media task/session/profile/credential/env files copied.',manual_review='Selected reports contain reviewer prose and explicitly synthetic fixture examples, not private user quotations. Raw TAP logs and execution metadata contain no emitted owner IDs/session cookies. Source code variable names for Cookie/owner are not credential values. Historical public task IDs and content hashes are evidence identifiers, not session authentication.',self_hash_rule='This manifest excludes itself to avoid self-reference; its hash is sent separately to PM.',artifacts=entries,total_redactions=sum(sum(e['redaction_counts'].values()) for e in entries),published_file_count_excluding_this_manifest=len(entries))
(pub/'publication-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
assert len(list(pub.rglob('*')))>len(entries)
for e in entries:
 assert sha((pub/e['published_path']).read_bytes())==e['published_sha256']
 assert sha(pathlib.Path(e['original_local_path']).read_bytes())==e['original_sha256']
print(json.dumps(dict(publication_root=str(pub),files=len(entries)+1,redactions=manifest['total_redactions'],manifest_sha256=sha((pub/'publication-manifest.json').read_bytes()),state=state),ensure_ascii=False,indent=2))
