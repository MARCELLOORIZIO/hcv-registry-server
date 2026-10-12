'use strict';
const http=require('node:http');
// Strict, disabled-until-wired HTTP transport for the existing MCP dispatcher.
// The production Registry never imports this file. A deployment must supply
// authenticated principal lookup and consent-bound storage adapters separately.
function createSigillumMcpHttpServer({dispatch,host='127.0.0.1',port=0,maxBodyBytes=16384}){
 if(typeof dispatch!=='function'||!Number.isInteger(port)||port<0||port>65535||
    !Number.isInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>65536)
  throw new TypeError('MCP_HTTP_CONFIGURATION_INVALID');
 if(host!=='127.0.0.1'&&host!=='::1')throw new Error('MCP_PUBLIC_BIND_FORBIDDEN_WITHOUT_EXTERNAL_AUTH');
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.url!=='/mcp'||req.method!=='POST'){
   res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'NOT_FOUND'}));return;
  }
  if(!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(String(req.headers.authorization||''))){
   res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'MCP_AUTH_REQUIRED'}));return;
  }
  if(req.headers.origin){
   res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'MCP_BROWSER_ORIGIN_FORBIDDEN'}));return;
  }
  const pieces=[];let size=0;
  try{
   for await(const chunk of req){
    size+=chunk.length;if(size>maxBodyBytes)throw Error('REQUEST_TOO_LARGE');
    pieces.push(chunk);
   }
   const message=JSON.parse(Buffer.concat(pieces).toString('utf8'));
   const reply=await dispatch(message,{authorization:req.headers.authorization});
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
   res.end(reply===null?'':JSON.stringify(reply));
  }catch(e){
   const code=e.message==='REQUEST_TOO_LARGE'?413:400;
   res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({error:code===413?'REQUEST_TOO_LARGE':'MCP_REQUEST_INVALID'}));
  }
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve(server.address());});})};
}
module.exports={createSigillumMcpHttpServer};
