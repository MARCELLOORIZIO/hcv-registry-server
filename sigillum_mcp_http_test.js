'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSigillumMcpHttpServer}=require('./sigillum_mcp_http');
async function fixture(){
 let calls=0;
 const {server,listen}=createSigillumMcpHttpServer({dispatch:async m=>{calls++;return {jsonrpc:'2.0',id:m.id,result:{tools:[]}};}});
 const addr=await listen();
 const url='http://127.0.0.1:'+addr.port+'/mcp';
 const close=()=>new Promise(resolve=>server.close(resolve));
 return {url,close,get calls(){return calls;}};
}
test('refuse a public network binding',()=>assert.throws(()=>createSigillumMcpHttpServer({dispatch:async()=>{},host:'0.0.0.0'}),/MCP_PUBLIC_BIND_FORBIDDEN/));
test('reject no bearer and browser origins without invoking dispatcher',async()=>{
 const s=await fixture();try{
  let r=await fetch(s.url,{method:'POST',body:'{}'});assert.equal(r.status,401);
  r=await fetch(s.url,{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(48),Origin:'https://example.com'},body:'{}'});assert.equal(r.status,403);
  assert.equal(s.calls,0);
 }finally{await s.close();}
});
test('authenticated loopback MCP request reaches dispatcher',async()=>{
 const s=await fixture();try{
  const r=await fetch(s.url,{method:'POST',headers:{Authorization:'Bearer '+'x'.repeat(48)},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(r.status,200);assert.equal((await r.json()).result.tools.length,0);assert.equal(s.calls,1);
 }finally{await s.close();}
});
