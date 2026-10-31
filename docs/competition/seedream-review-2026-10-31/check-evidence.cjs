// 仅离线读取证据，不发出模型或网络请求。
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const dir=__dirname,read=f=>fs.readFileSync(path.join(dir,f));
const req=JSON.parse(read('request.json')),res=JSON.parse(read('result.json')),manifest=JSON.parse(read('manifest.json'));
let lines=['Seedream 复制件离线检查 '+new Date().toISOString()],fail=0;
function check(n,ok){lines.push((ok?'PASS ':'FAIL ')+n);if(!ok)fail++}
check('请求模型与返回模型分别记录',req.model==='doubao-seedream-4.5'&&res.model==='doubao-seedream-4-5-251128');
check('纯文字请求无参考图字段',!Object.keys(req).some(k=>/image|reference/i.test(k)&&k!=='sequential_image_generation'));
const allowedReq=['model','prompt','size','sequential_image_generation','stream','response_format','watermark'],allowedRes=['status','model','elapsed_seconds','usage','images'];
check('JSON 仅含审阅过的字段，无密钥/认证字段',Object.keys(req).every(k=>allowedReq.includes(k))&&Object.keys(res).every(k=>allowedRes.includes(k))&&!/api[_-]?key|authorization|bearer\s|sk-[A-Za-z0-9]/i.test(read('request.json')+read('result.json')));
check('单次耗时/usage 原记录一致',res.elapsed_seconds===8.813&&res.usage.generated_images===1&&res.usage.output_tokens===15552&&res.images.length===1);
for(const f of manifest.files){const b=read(f.file);check(f.file+' 字节数及SHA256匹配',b.length===f.bytes&&crypto.createHash('sha256').update(b).digest('hex')===f.sha256)}
let jpg=read('packaging-scene-1.jpg'),width=0,height=0;
if(jpg[0]===255&&jpg[1]===216){let i=2;while(i<jpg.length-9){if(jpg[i++]!==255)break;while(jpg[i]===255)i++;let marker=jpg[i++];if(marker===217||marker===218)break;let len=jpg.readUInt16BE(i);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){height=jpg.readUInt16BE(i+3);width=jpg.readUInt16BE(i+5);break}i+=len;}}
check('JPEG 图片头实际尺寸2304×1728',width===2304&&height===1728);
check('原记录图像哈希与尺寸匹配',res.images[0].sha256===crypto.createHash('sha256').update(jpg).digest('hex')&&res.images[0].size===width+'x'+height);
lines.push('边界：这些检查不证明视觉通过、参考图/SKU保持、产品接线、独立QA、部署、全站性能或费用。');
let out=lines.join('\n')+'\n';fs.writeFileSync(path.join(dir,'validation.txt'),out);process.stdout.write(out);process.exitCode=fail?1:0;
