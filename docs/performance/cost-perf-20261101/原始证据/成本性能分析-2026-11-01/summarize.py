"""stdlib only; python summarize.py. No network, no credentials, no service calls."""
import pathlib, json, csv, statistics, hashlib, zipfile, datetime, sys
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
rows=lambda p:[json.loads(x) for x in p.read_text(encoding='utf8').splitlines() if x.strip()]
dump=lambda p,v:p.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf8')
R=sorted(d for d in (P/'runs').iterdir() if (d/'http.json').exists())[-1]
samples=rows(R/'samples.jsonl'); http=load(R/'http.json'); media=rows(R/'media.jsonl'); disk=load(R/'disk.json')
stats=lambda v:{'n':len(v),'min':min(v),'median':statistics.median(v),'max':max(v)}
phase=[]
for key in dict.fromkeys(x['phase'] for x in samples):
 v=[x for x in samples if x['phase']==key];first=samples.index(v[0]);last=samples.index(v[-1]);end=samples[min(last+1,len(samples)-1)]
 cpu=lambda x:sum(x['cpu_us'].values())
 wall=(datetime.datetime.fromisoformat(end['at'])-datetime.datetime.fromisoformat(v[0]['at'])).total_seconds()
 delta=(cpu(end)-cpu(v[0]))/1e6
 phase.append({'phase':key,'samples':len(v),'rss_bytes':stats([x['rss'] for x in v]),'wall_seconds':wall,'cpu_seconds':delta,'cpu_one_core_percent':100*delta/wall if wall else None})
changed={k:v-disk['before'].get(k,0) for k,v in disk['after'].items() if v!=disk['before'].get(k,0)}
categories={k:sum(v for path,v in changed.items() if '/'+k+'/' in path.replace(chr(92),'/')) for k in ['assets','tasks']}
summary={'run':R.name,'phase':phase,'windows':load(R/'windows-process.json'),'http_recommend_ms':stats([x['recommend_ms'] for x in http]),'http_present_ms':stats([x['present_ms'] for x in http]),'http_all_200':all(x['recommend_http']==x['present_http']==200 and x['candidate_count']==3 for x in http),'http_input_bytes':stats([x['input_bytes'] for x in http]),'media_text_ms':stats([x['text_ms'] for x in media]),'media_ready_ms':stats([x['terminal_ms'] for x in media if x['status']=='ready']),'media_failure_ms':stats([x['terminal_ms'] for x in media if x['status']=='failed']),'disk_bytes':categories,'disk_total_bytes':sum(changed.values()),'telemetry_and_client_record_bytes':sum(f.stat().st_size for f in R.iterdir() if f.is_file()),'blocked_external_fetches':len(rows(R/'network-blocked.jsonl')) if (R/'network-blocked.jsonl').exists() else 0,'fixture_errors':rows(R/'errors.jsonl') if (R/'errors.jsonl').exists() else []}
dump(P/'resource-summary.json',summary)
# Official catalog prices. Cache discount absent: all prompt tokens at public input rate.
catalog=load(P/'official-model-catalog.json')
def find(o):
 if isinstance(o,dict):
  if o.get('Name')=='deepseek-v4.1-flash-1017':return o
  for v in o.values():
   r=find(v)
   if r:return r
 if isinstance(o,list):
  for v in o:
   r=find(v)
   if r:return r
model=find(catalog); assert model
prices={x['ChargeItem']:float(x['Price']) for x in model['PriceSummary']}
assert prices['input']==2 and prices['output_text_tokens']==8
dump(P/'price-extract.json',{'checked_date_asia_shanghai':'2026-11-01','url':'https://api.ucloud.cn/?Action=ListCModelCenterModels','model':model,'cache_rate':'not_public_in_catalog; conservative full input rate','image':{'model':'doubao-seedream-4.5','cny_per_successful_image':0.25,'price_url':'https://www.compshare.cn/docs/modelverse/price','billing_url':'https://www.compshare.cn/docs/modelverse/models/image_api/doubao-seedream','failure_rule':'charge successful generated_images, client timeout unknown reserves one successful image'}})
ledger=rows(P/'evidence/runtime-c/evidence/model-ledger.jsonl')
totals={k:sum(x['usage'][k] for x in ledger) for k in ['prompt_tokens','completion_tokens','total_tokens']}
totals['cached_tokens']=sum(x['usage'].get('prompt_tokens_details',{}).get('cached_tokens',0) for x in ledger)
totals['reasoning_tokens_in_completion']=sum(x['usage'].get('completion_tokens_details',{}).get('reasoning_tokens',0) for x in ledger)
totals['elapsed_ms_sum']=sum(x['elapsed_ms'] for x in ledger)
totals['budget_cny_without_cache_discount']=(totals['prompt_tokens']*2+totals['completion_tokens']*8)/1e6
totals['version']='historical e7580ea + dirty; not final SHA';totals['unattributed']='no request/run ids in ledger; do not infer E2E solely from timestamps'
dump(P/'historical-usage-summary.json',totals)
stages=[('parse_assumption',1,2750,450),('exclusion_assumption',1,1500,400),('recommend_historical_tool_path',3,totals['prompt_tokens'],totals['completion_tokens']),('direction_assumption',1,350,600),('present_assumption',1,2600,1200)]
with (P/'stage-assumptions.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['stage','logical_calls','prompt_tokens','completion_tokens','budget_cny','evidence']);
 for name,n,i,o in stages:w.writerow([name,n,i,o,(i*2+o*8)/1e6,'历史usage' if 'historical' in name else '推算假设'])
i=sum(x[2] for x in stages);o=sum(x[3] for x in stages);c=len(stages)+2
cases=[('typical_success',c,i,o,1,1,'7逻辑文本调用；含解析与1次排除识别；推荐3轮；选1项'),('no_optional_parse_or_exclusion',c-2,i-4250,o-850,1,1,'结构化输入且无排除原文；其余同典型'),('business_revision_once',c+1,i+8500,o+3500,1,1,'推荐业务修订1次；其后独立复核；非呈现模拟修订'),('format_retry_once',c+1,i+2600,o+1200,1,1,'呈现JSON格式失败额外1次；假定两次均达到该用量'),('one_transport_retry_unknown',c+1,i+7500,o+2500,1,1,'推荐一次传输重试；假定失联尝试也执行满额；逻辑调用仍7/物理8'),('all_text_default_3_attempts',c*3,i*3,o*3,1,1,'每逻辑调用3次尝试均计满；压力预算假设，非精确硬上限'),('image_execution_unknown',c,i,o,0,1,'已提交但客户端不知供应商结果；图片预算预留0至1张；实付未知'),('image_confirmed_generated_images_zero',c,i,o,0,0,'仅供应商明确generated_images=0才按官方规则记0图费；文本仍计'),('all_three_selected_sequentially',c+2,i+5200,o+2400,3,3,'同run分别选择3个合格候选；已选项重放不再生成'),('hundred_task_mix_per_task',None,None,None,None,None,'见mixed-100.json，非流量预测')]
out=[]
for name,n,prompt,completion,lo,hi,note in cases[:-1]:
 text=(prompt*2+completion*8)/1e6
 out.append({'scenario':name,'evidence':'推算','attempt_equivalents':n,'prompt_tokens':prompt,'completion_tokens':completion,'input_cny_per_million':2,'output_cny_per_million':8,'image_cny_per_success':0.25,'charged_image_min':lo,'charged_image_max':hi,'text_budget_cny':round(text,6),'task_min_cny':round(text+lo*.25,6),'task_max_cny':round(text+hi*.25,6),'hundred_min_cny':round(100*(text+lo*.25),6),'hundred_max_cny':round(100*(text+hi*.25),6),'paid_cny':'未测','notes':note})
with (P/'budget.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=out[0].keys());w.writeheader();w.writerows(out)
mix={'typical_success':80,'business_revision_once':10,'image_execution_unknown':10}
dump(P/'mixed-100.json',{'counts':mix,'budget_min_cny':round(sum(next(x for x in out if x['scenario']==k)['task_min_cny']*v for k,v in mix.items()),6),'budget_max_cny':round(sum(next(x for x in out if x['scenario']==k)['task_max_cny']*v for k,v in mix.items()),6),'paid_cny':'未测','not_a_failure_rate_estimate':True})
if '--data-only' in sys.argv:
 assert summary['http_all_200'] and summary['media_ready_ms']['n']==8 and summary['media_failure_ms']['n']==2 and not summary['fixture_errors']
 print('data-only: resource/budget calculations and fixture assertions passed; archives/runtime not rechecked')
 raise SystemExit(0)
commits={sha:load(P/f'commit-{sha}.json')['tree']['sha'] for sha in ['15e29edcc150c3a4a8a9ba04e9f0c8a2bb614879','eceef056ce80399b83c61f62860a32d0ead16e3d']}
assert len(set(commits.values()))==1
z=zipfile.ZipFile(P/'source.zip');mismatch=[];checked=0
for entry in z.infolist():
 parts=pathlib.PurePosixPath(entry.filename).parts[1:]
 if parts and parts[0] in ['web','validator','workflow','tests'] and not entry.is_dir():
  f=P/'runtime'/pathlib.Path(*parts);checked+=1
  if f.read_bytes()!=z.read(entry):mismatch.append(str(f))
assert not mismatch
dump(P/'provenance.json',{'analysis_sha':list(commits)[0],'tree_comparison':commits,'source_zip_comment':z.comment.decode(),'runtime_pristine_files_checked':checked,'mismatches':mismatch,'handoff_evidence_sha':'147e45a60f7a7fc9f2cc8c7e9d8146af3dc5f405','sha256':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [P/'source.zip',P/'handoff.zip',P/'official-model-catalog.json',P/'official-price.html',P/'official-image-api.html']}})
assert summary['http_all_200'] and summary['media_ready_ms']['n']==8 and summary['media_failure_ms']['n']==2 and not summary['fixture_errors'] and summary['blocked_external_fetches']==0
print(json.dumps({'resources':summary,'usage':totals,'budgets':out,'mix':load(P/'mixed-100.json'),'provenance':load(P/'provenance.json')},ensure_ascii=False,indent=2))
