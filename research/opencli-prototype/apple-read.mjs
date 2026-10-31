import { pathToFileURL } from 'node:url';
const root=process.env.OPENCLI_PACKAGE_ROOT;
if(!root)throw new Error('OPENCLI_PACKAGE_ROOT_REQUIRED');
const {CDPBridge}=await import(pathToFileURL(root+'/dist/src/browser/cdp.js'));
const bridge=new CDPBridge();
const timer=setTimeout(()=>process.exit(2),20000);
try {
 const page=await bridge.connect({cdpEndpoint:'http://127.0.0.1:19359',timeout:5});
 await page.goto('https://www.apple.com.cn/shop/buy-airtag/airtag');
 const text=await page.evaluate('document.body.innerText');
 const products=[];
 for(const quantity of [1,4]) {
  const pattern=new RegExp(quantity+' 件装\\s+RMB ([0-9,]+(?:\\.[0-9]{1,2})?)');const match=text.match(pattern);
  if(match)products.push({name:'AirTag',variant:quantity+' 件装（未选镌刻）',quantity,currency:'CNY',price_amount:match[1].replaceAll(',',''),price_conditions:[],page_kind:'detail',source_url:'https://www.apple.com.cn/shop/buy-airtag/airtag',evidence_ref:'apple-airtag-'+quantity,observed_excerpt:match[0]});
 }
 console.log(JSON.stringify({source:'browser_observed',observed_at:new Date().toISOString(),products,warnings:['页面观察价，非结算/库存/送达保证；需要兼容Apple设备；图片使用权未核实，未转载']}));
} catch {console.log(JSON.stringify({error:'PUBLIC_PRODUCT_READ_FAILED'}));process.exitCode=2;}
finally {clearTimeout(timer);await bridge.close();}
