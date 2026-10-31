import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync, appendFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root='[REDACTED:HOST_ABSOLUTE_PATH]';
const out='[REDACTED:HOST_ABSOLUTE_PATH]';
const env={};
for(const key of ['Path','PATH','SystemRoot','SYSTEMROOT','WINDIR','windir','COMSPEC','ComSpec','PATHEXT']) if(process.env[key]) env[key]=process.env[key];
for(const name of ['temp','cache','home','appdata','localappdata']) mkdirSync(join(out,name),{recursive:true});
Object.assign(env,{TEMP:join(out,'temp'),TMP:join(out,'temp'),TMPDIR:join(out,'temp'),USERPROFILE:join(out,'home'),APPDATA:join(out,'appdata'),LOCALAPPDATA:join(out,'localappdata'),XDG_CACHE_HOME:join(out,'cache'),npm_config_cache:join(out,'cache'),GW_MODE:'mock',GIFTWISE_RETRIEVAL:'unavailable',GIFTWISE_CATALOG_SCRAPE:'0',GIFTWISE_IMAGE_GENERATION:'0',GIFTWISE_LIVE_RETRIEVAL_TEST:'0',NODE_OPTIONS:'--import='+pathToFileURL(join(out,'offline-guard.mjs')).href});
const args=['--test','--test-concurrency=1','--test-timeout=30000','--test-reporter=tap','--test-name-pattern=停推荐网图：|三卡无网图：','web/tests/ui-results.test.mjs','web/tests/ui-recommendation-without-images.test.mjs'];
const sha=execFileSync('git',['-c',`safe.directory=${root}`,'rev-parse','HEAD'],{cwd:root,env,encoding:'utf8'}).trim();
writeFileSync(join(out,'targeted-environment.json'),JSON.stringify({sha,cwd:root,node:process.version,command:[process.execPath,...args],environment:env,scope:'Only changed no-network-image UI contracts and controlled selected-AI compatibility cases. No full regression. No model/image/collection calls.'},null,2));
writeFileSync(join(out,'network-attempts.jsonl'),'');
writeFileSync(join(out,'targeted-raw.txt'),'');
const started=Date.now();
const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of [child.stdout,child.stderr]) stream.on('data',data=>appendFileSync(join(out,'targeted-raw.txt'),data));
child.on('close',(code,signal)=>{
  const raw=readFileSync(join(out,'targeted-raw.txt'),'utf8');
  const result={exit_code:code,signal,duration_ms:Date.now()-started,network_attempts:readFileSync(join(out,'network-attempts.jsonl'),'utf8').trim().split('\n').filter(Boolean).length};
  for(const key of ['tests','pass','fail','skipped','cancelled']) result[key]=Number([...raw.matchAll(new RegExp('^# '+key+' (\\d+)','gm'))].at(-1)?.[1]);
  writeFileSync(join(out,'targeted-result.json'),JSON.stringify(result,null,2));
  console.log(raw);console.log(JSON.stringify(result));process.exitCode=code??1;
});



