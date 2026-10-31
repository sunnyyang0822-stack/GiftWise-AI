import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const p=path.dirname(fileURLToPath(import.meta.url));
const env={};for(const k of ['SystemRoot','WINDIR','Path','PATHEXT','ComSpec'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{GW_MODE:'mock',GIFTWISE_RETRIEVAL:'unavailable',GIFTWISE_IMAGE_GENERATION:'0',GIFTWISE_STYLE_DIRECTION_CHANNEL:'rules',TEMP:p,TMP:p,USERPROFILE:p,APPDATA:p,LOCALAPPDATA:p,GW_LOCAL_DB:path.join(p,'runtime/.tmp/qa-missing.sqlite')});
// The repository's HTTP subtest hardcodes 8904. Never stop an occupant.
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(8904,'127.0.0.1',resolve);});await new Promise(r=>probe.close(r));
env.GW_PORT='8904';env.GW_HOST='127.0.0.1';
const r=spawnSync(process.execPath,['--test',path.join(p,'runtime/web/tests/backend-async-image-a.test.mjs')],{cwd:path.join(p,'runtime'),env,encoding:'utf8'});
fs.writeFileSync(path.join(p,'async-fixture-completed-check.txt'),r.stdout+r.stderr+'\nexit_code='+r.status+'\n');
process.stdout.write(r.stdout+r.stderr);process.exitCode=r.status;
