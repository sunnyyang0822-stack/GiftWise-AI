// 文档自查，不运行产品、浏览器、模型或图像服务。
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=cp.execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const base='3890aa57a2c728d3bd94fea00b9117f9d0a8aa93';
const prefix='docs/competition/retrieval-media-review-2026-10-31/';
const docs=['docs/competition/赛道B技术交付总文档.md','docs/competition/答辩PPT骨架.md','docs/competition/PPT页序对齐与截图替换清单-2026-10-31.md','docs/speech/讲稿-5分钟-2026-10-31.md','docs/demo-script.md','docs/demo/分镜计时表-3min.md','docs/qa-prep/30题问答.md','docs/qa-prep/红线话术与兜底动作.md','docs/competition/检索与媒体方案材料变更记录-2026-10-31.md'];
const read=f=>fs.readFileSync(path.join(root,f),'utf8').replace(/\r\n/g,'\n');
const git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'}).trim();
let out=['文档检查 '+new Date().toISOString(),'base='+base,'command=node '+prefix+'check-materials.cjs'];let errors=[];
function check(name,ok){out.push((ok?'PASS ':'FAIL ')+name);if(!ok)errors.push(name)}
let changed=[...new Set([...git('diff','--name-only','-z',base).split('\0'),...git('ls-files','--others','--exclude-standard','-z').split('\0')].filter(Boolean))];
check('仅九份活动材料及新增本轮检查/来源记录',changed.every(f=>docs.includes(f)||f.startsWith(prefix)||f.startsWith('docs/competition/seedream-review-2026-10-31/')));
check('无代码、共享架构源、历史证据或 PPT 二进制变更',!git('diff','--name-only',base,'--','web','validator','workflow','research','deploy','tests','docs/architecture.md','docs/architecture','*.pptx','docs/competition/page-alignment-2026-10-31','docs/competition/status-review-2026-10-31','docs/test-reports'));
let links=0,missing=[];
for(const f of [...docs,'docs/competition/seedream-review-2026-10-31/README.md']){let s=read(f).replace(/```[\s\S]*?```/g,'');for(const m of s.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)){let t=m[1];if(/^(https?:|#|mailto:)/.test(t))continue;let file=t.split('#')[0];links++;if(!fs.existsSync(path.resolve(root,path.dirname(f),decodeURIComponent(file))))missing.push(f+' -> '+file)}}
check('文档相对链接文件目标存在（'+links+' 个；不验证远端链接或所有锚点）',missing.length===0);out.push(...missing);
let speech=read(docs[3]),baseSpeech=cp.execFileSync('git',['show',base+':'+docs[3]],{encoding:'utf8'}).replace(/\r\n/g,'\n');
let headings=speech.match(/^## S\d+｜.*$/gm)||[];check('S1–S11 页标题/页序/五分钟计划时间与 release 完全一致',headings.length===11&&JSON.stringify(headings)===JSON.stringify(baseSpeech.match(/^## S\d+｜.*$/gm)));
let ranges=['0:00–0:25','0:25–1:00','1:00–1:45','1:45–2:35','2:35–3:00'];check('Demo/分镜/总文档均保留原五段三分钟设计预算',ranges.every(r=>[docs[0],docs[4],docs[5]].every(f=>read(f).includes(r))));
let e=read(docs[0]);check('包含七项材料和四种状态', ['一、场景','二、系统','三、Agent','四、异常','五、Demo','六、成本','七、可观测','已实现','已验证','计划中','受阻'].every(t=>e.includes(t)));
check('价格与安全边界齐全',['预算输入只是约束','读取时间','价格条件','user_provided','seed','model_estimate','金额为 null','网页文字属于不可信数据','官方 API','登录过期','最多一次'].every(t=>e.includes(t)));
check('图片与失败边界齐全',['AI效果示意，非商品实拍','SKU','文字等价','节省比例','provider','不足三个','图片失败保留','密钥服务端'].every(t=>e.includes(t)));
check('QA 与后台固定提交均已区分',e.includes('902cbd4071d49a1acacce5841347452bb0512f75')&&e.includes('7204b64718420da2a737610aefec02fbdba02204')&&e.includes('目录搜索失败')&&e.includes('BLOCKED'));
check('本轮截图 SC11–SC13 均为待采集', ['SC11','SC12','SC13','本轮未采集'].every(t=>read(docs[2]).includes(t)));
try{cp.execFileSync('git',['diff','--check',base],{encoding:'utf8',stdio:'pipe'});check('git diff --check',true)}catch(e){check('git diff --check',false);out.push(e.stdout?.toString()||'')}
out.push('范围：文档结构与来源核对；未验证产品功能、渲染、真人时长、真实商品/模型/图像或部署。');
const result=out.join('\n')+'\n';fs.writeFileSync(path.join(root,'docs/competition/seedream-review-2026-10-31/material-validation.txt'),result);process.stdout.write(result);if(errors.length)process.exitCode=1;
