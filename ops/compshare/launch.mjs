import {realpathSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
for(const name of ['LLM_BASE_URL','LLM_API_KEY','LLM_MODEL','IMAGE_API_KEY']) {
  if(!process.env[name]?.trim())throw Error('REQUIRED_SERVER_CONFIGURATION_MISSING');
}
if(process.env.GW_MODE!=='llm'||process.env.GIFTWISE_IMAGE_GENERATION!=='1'||process.env.GIFTWISE_RETRIEVAL!=='domestic')throw Error('DEPLOYMENT_MODE_INVALID');
for(const name of ['NODE_TEST_CONTEXT','GW_LLM_TEST_MODE','GW_LLM_LEDGER_ALLOW_REAL_RESET']) {
  if(process.env[name])throw Error('TEST_OR_LEDGER_RESET_MODE_FORBIDDEN');
}
process.env.GW_HOST='127.0.0.1';process.env.GW_PORT='8787';
process.env.GW_LOCAL_DB=join(root,'.local-db/giftwise.sqlite');
process.env.GW_LLM_LEDGER_FILE=join(root,'.tmp/llm-calls/ledger.jsonl');
process.chdir(realpathSync(root));
const {MODE}=await import('../../web/server/config.mjs');
if(MODE.current!=='llm')throw Error('REAL_MODE_REQUIRED');
const {openDb}=await import('../../web/server/localdb/db.mjs');
const db=openDb(process.env.GW_LOCAL_DB);db.close();
if(!existsSync(join(root,'.tmp/material-cache/materials.json'))) {
  const {mkdir,copyFile}=await import('node:fs/promises');
  const directory=join(root,'.tmp/imports/public-material');await mkdir(directory,{recursive:true});
  await copyFile(join(root,'ops/compshare/public-material-manifest.json'),join(directory,'manifest.json'));
  const {createMaterialCache}=await import('../../web/server/retrieval/material-cache.mjs');
  const {importMaterialBundle}=await import('../../web/server/retrieval/material-bundle.mjs');
  const receipt=await importMaterialBundle(directory,{cache:createMaterialCache()});
  if(receipt.status!=='ready'||receipt.records_imported!==3||receipt.cache_status!=='saved')throw Error('PUBLIC_MATERIAL_IMPORT_FAILED');
  console.log(JSON.stringify({event:'public_material_import',status:receipt.status,count:receipt.records_imported}));
}
console.log(JSON.stringify({event:'deployment_start' ,mode:MODE.current,node:process.version}));
await import('../../web/server/server.mjs');
