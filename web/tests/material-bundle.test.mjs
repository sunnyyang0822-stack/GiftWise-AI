import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdirSync,writeFileSync}from'node:fs';
import{syncBuiltinESMExports}from'node:module';
import{fileURLToPath}from'node:url';
import{join,resolve}from'node:path';
import{tmpdir}from'node:os';
import{REPO_ROOT}from'../server/localdb/db.mjs';
import{importMaterialBundle,MATERIAL_BUNDLE_MAX_BYTES}from'../server/retrieval/material-bundle.mjs';
const root=fileURLToPath(new URL('../../.tmp/material-bundle-tests/'+process.pid+'/',import.meta.url));mkdirSync(root,{recursive:true});let sequence=0;
const observed='2026-10-31T19:03:17.355Z';
const record=(patch={})=>({reference_id:'web_fixture_1',reference_kind:'public_reference',title:'公开咖啡角做法（离线测试）',summary:'受控匿名摘要：把杯具和托盘组合为日常使用的小角落。',source_url:'https://www.zhihu.com/question/123',source_platform:'web',purpose:'inspiration',observed_at:observed,material_kind:'search_snippet',...patch});
function bundle(records=[record()],extra={}){const directory=join(root,String(++sequence));mkdirSync(directory);writeFileSync(join(directory,'manifest.json'),JSON.stringify({version:1,records,...extra}));return directory;}

test('anonymous text bundles import through an injected cache while preserving source and original observation time',async()=>{
 let saved;const result=await importMaterialBundle(bundle(),{cache:{put:async records=>{saved=records;}}});assert.equal(result.status,'ready');assert.equal(result.records_imported,1);assert.equal(result.cache_status,'saved');assert.equal(saved[0].source_url,'https://www.zhihu.com/question/123');assert.equal(saved[0].observed_at,observed);assert.equal(saved[0].material_kind,'search_snippet');assert.equal(saved[0].has_summary,true);assert.equal(saved[0].is_full_article,false);assert.ok(!('image_id' in saved[0]));assert.ok(!('product_id' in saved[0]));assert.ok(!('price_amount' in saved[0]));
});
test('import can return safe records without a cache and retains honest title-only material',async()=>{
 const result=await importMaterialBundle(bundle([record({summary:null,has_summary:true})]));assert.equal(result.status,'ready');assert.equal(result.cache_status,'not_requested');assert.equal(result.records_imported,1);assert.equal(result.records[0].summary,null);assert.equal(result.records[0].has_summary,false);assert.equal(result.records[0].material_kind,'search_result_title');assert.equal(result.records[0].observed_at,observed);
});
test('only safe fields reach cache: user/query/auth/body/image payloads are omitted rather than exported',async()=>{
 const input=record({query_params:{keyword:'private query'},owner:'owner-private',token:'fake-private-token',raw_text:'private original text',body:'full body must not enter cache',image_url:'https://example.test/private.jpg',image_validation:{ok:true}});let saved;
 const result=await importMaterialBundle(bundle([input]),{cache:{put:records=>{saved=records;}}});assert.equal(result.status,'partial');assert.equal(result.records_imported,1);assert.ok(result.rejected.some(r=>r.code==='RECORD_FIELDS_DROPPED'));
 const json=JSON.stringify({result,saved});for(const fragment of ['private query','owner-private','fake-private-token','private original text','full body must not enter cache','private.jpg'])assert.ok(!json.includes(fragment));assert.ok(!('image_url' in saved[0]));
});
test('commerce/private/authentication sources and unsafe text cannot enter accepted material',async()=>{
 const invalids=['https://item.jd.com/1.html','https://amazon.com/product/1','https://127.0.0.1/private','https://www.zhihu.com/account/settings','https://www.zhihu.com/question/123?token=private','https://user:password@www.zhihu.com/question/123'];
 const records=invalids.map((source_url,i)=>record({reference_id:'bad_'+i,source_url}));records.push(record({reference_id:'unsafe',summary:'authorization: Bearer do-not-export'}),record({reference_id:'full',is_full_article:true}),record());
 const result=await importMaterialBundle(bundle(records));assert.equal(result.records_imported,1);assert.equal(result.records[0].reference_id,'web_fixture_1');assert.equal(result.rejected.length,8);assert.ok(!JSON.stringify(result).includes('do-not-export'));
});
test('manifest schema, byte/record limits and strict JSON reject before any cache write',async()=>{
 let writes=0;const cache={put:()=>{writes++;}};
 const tooMany=await importMaterialBundle(bundle(Array.from({length:81},(_,i)=>record({reference_id:'r_'+i}))),{cache});assert.equal(tooMany.rejected[0].code,'BUNDLE_SCHEMA_INVALID');
 const imageBundle=await importMaterialBundle(bundle([record()],{images:[]}),{cache});assert.equal(imageBundle.rejected[0].code,'BUNDLE_SCHEMA_INVALID');
 const large=bundle();writeFileSync(join(large,'manifest.json'),'x'.repeat(MATERIAL_BUNDLE_MAX_BYTES+1));assert.equal((await importMaterialBundle(large,{cache})).rejected[0].code,'BUNDLE_TOO_LARGE');
 const duplicate=bundle();writeFileSync(join(duplicate,'manifest.json'),'{"version":1,"version":1,"records":[]}');assert.equal((await importMaterialBundle(duplicate,{cache})).rejected[0].code,'BUNDLE_JSON_INVALID');assert.equal(writes,0);
});
test('outside-project paths and simulated junction markers are rejected before reading contents',async()=>{
 let writes=0;const outside=await importMaterialBundle(resolve(REPO_ROOT,'..','outside-material-bundle'),{cache:{put:()=>{writes++;}}});assert.equal(outside.rejected[0].code,'BUNDLE_PATH_OUTSIDE_PROJECT');
 // This host cannot create a physical Windows junction (EISDIR); drive the fs marker branch explicitly.
 const link=bundle(),original=fs.lstatSync;
 try{fs.lstatSync=(path,...args)=>resolve(path)===resolve(link)?{isSymbolicLink:()=>true}:original(path,...args);syncBuiltinESMExports();const linked=await importMaterialBundle(link,{cache:{put:()=>{writes++;}}});assert.equal(linked.rejected[0].code,'BUNDLE_LINK_NOT_ALLOWED');}
 finally{fs.lstatSync=original;syncBuiltinESMExports();}
 assert.equal(writes,0);
});
test('ambiguous duplicate references and invalid observation dates do not overwrite good material',async()=>{
 const result=await importMaterialBundle(bundle([record(),record({source_url:'https://www.zhihu.com/question/456'}),record({reference_id:'bad_date',observed_at:'unknown'}),record({reference_id:'good_other',source_url:'https://www.zhihu.com/question/789'})]));assert.equal(result.records_imported,1);assert.equal(result.records[0].reference_id,'good_other');assert.equal(result.rejected.filter(r=>r.code==='DUPLICATE_REFERENCE_ID').length,2);assert.ok(result.rejected.some(r=>r.code==='RECORD_OBSERVATION_INVALID'));
});
test('cache failures are safe and leave returned text available for caller-controlled retry',async()=>{
 const result=await importMaterialBundle(bundle(),{cache:{put:async()=>{throw Error('cookie=fake-private-error');}}});assert.equal(result.status,'partial');assert.equal(result.cache_status,'failed');assert.equal(result.records_imported,0);assert.equal(result.records.length,1);assert.equal(result.records[0].observed_at,observed);assert.ok(result.rejected.some(r=>r.code==='CACHE_WRITE_FAILED'));assert.ok(!JSON.stringify(result).includes('fake-private-error'));
 let writes=0;const empty=await importMaterialBundle(bundle([]),{cache:{put:()=>{writes++;}}});assert.equal(empty.status,'unavailable');assert.equal(writes,0);
});

test('a cache failure receipt is not advertised as a saved import',async()=>{const result=await importMaterialBundle(bundle(),{cache:{put:()=>({status:'unavailable',error_code:'MATERIAL_CACHE_WRITE_FAILED'})}});assert.equal(result.cache_status,'failed');assert.equal(result.records_imported,0);assert.equal(result.records.length,1);});

test('the source-tree import boundary is independent of the process working directory',async()=>{
 const directory=bundle(),previous=process.cwd();
 try{process.chdir(tmpdir());const result=await importMaterialBundle(directory);assert.equal(result.status,'ready');assert.equal(result.records_imported,1);assert.equal(result.records[0].observed_at,observed);}
 finally{process.chdir(previous);}
});
