import { pathToFileURL } from 'node:url';
const root=process.env.OPENCLI_PACKAGE_ROOT;
if(!root)throw new Error('OPENCLI_PACKAGE_ROOT required');
const {CDPBridge}=await import(pathToFileURL(root+'/dist/src/browser/cdp.js'));
const bridge=new CDPBridge();
const timer=setTimeout(()=>{console.log(JSON.stringify({status:'blocked',reason:'CDP probe timeout'}));process.exit(2)},25000);
try {
 const page=await bridge.connect({cdpEndpoint:'http://127.0.0.1:19359',timeout:5});
 await page.goto('https://books.toscrape.com/');
 console.log(JSON.stringify({mode:'public_demo_browser',stage:'catalogue',text:await page.evaluate('document.body.innerText.slice(0,800)')}));
 const detail=await page.evaluate('Array.from(document.querySelectorAll("article h3 a")).find(a=>a.title.toLowerCase().includes("light"))?.href');
 if(!detail||!detail.startsWith('https://books.toscrape.com/catalogue/'))throw new Error('NO_MATCH');
 await page.goto(detail);
 console.log(JSON.stringify({stage:'detail',observed_at:new Date().toISOString(),data:await page.evaluate('({name:document.querySelector("h1")?.textContent,price:document.querySelector(".price_color")?.textContent,details:document.querySelector("table")?.innerText})')}));
} catch {console.log(JSON.stringify({status:'blocked',reason:'CDP navigation/read failed'}));process.exitCode=2;}
finally{clearTimeout(timer);await bridge.close();}
