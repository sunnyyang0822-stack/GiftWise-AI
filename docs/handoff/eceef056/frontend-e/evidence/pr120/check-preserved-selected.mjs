import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='[REDACTED:HOST_ABSOLUTE_PATH]',out='[REDACTED:HOST_ABSOLUTE_PATH]',base='008415e09d1c5203d7bf7bbed54c2382c4cac1f1';
const normalize=s=>s.replace(/\r\n/g,'\n');
const original=file=>normalize(execFileSync('git',['-c',`safe.directory=${root}`,'show',`${base}:${file}`],{cwd:root,encoding:'utf8'}));
const current=async file=>normalize(await readFile(`${root}/${file}`,'utf8'));
const between=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,`Missing source markers: ${start}`);return text.slice(a,b);};
const result={base,comparisons:{}};
for(const file of ['web/public/js/media-view.js','web/public/js/recommendation-media.js','web/public/styles.css','web/public/landing.css']){assert.equal(await current(file),original(file));result.comparisons[file]='unchanged (normalized LF)';}
const before=original('web/public/js/results-view.js'),after=await current('web/public/js/results-view.js');
for(const [name,start,end]of[
 ['selected_ai_poll','  /* ------------------------------------------ 图片任务轮询','  function requestChips('],
 ['selected_guide_and_summary','  /* ------------------------------------------------- 选定之后的呈现 */','  /* ------------------------------------- 结果页内的等待'],
 ['selected_loading_frame','  function renderPresentationLoading(','  /* ---------------------------------------------------------- 收束页 */']
]){assert.equal(between(after,start,end),between(before,start,end));result.comparisons[name]='unchanged (normalized LF)';}
assert.equal(between(await current('web/public/app.js'),'async function selectCandidate(','/* ------------------------------------------------------------------ 组装 */'),between(original('web/public/app.js'),'async function selectCandidate(','/* ------------------------------------------------------------------ 组装 */'));result.comparisons.selected_POST='unchanged (normalized LF)';
await writeFile(`${out}/selected-preservation-check.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
