// 为旧Node HTTP回归提供浏览器自动持有同源cookie的行为；不修改原测试。
const original=globalThis.fetch;const cookies=new Map();
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.hostname!=='127.0.0.1')return original(input,options);
 const headers=new Headers(options.headers??input?.headers);if(!headers.has('cookie')&&cookies.has(url.origin))headers.set('cookie',cookies.get(url.origin));
 const response=await original(input,{...options,headers});const cookie=response.headers.get('set-cookie');if(cookie)cookies.set(url.origin,cookie.split(';')[0]);return response;
};
