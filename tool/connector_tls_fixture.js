'use strict';
// Loopback-only TLS fixture using a per-run self-signed certificate trusted ONLY
// by its own test fetch implementation. Never changes global TLS verification.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https');
const {execFileSync}=require('node:child_process');
async function connectorTlsFixture(handle){
 const tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'sigillum-mcp-tls-test-'));
 const key=path.join(tmp,'key.pem'),cert=path.join(tmp,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',key,'-out',cert,
  '-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 await fs.promises.chmod(key,0o600);
 const server=https.createServer({key:await fs.promises.readFile(key),cert:await fs.promises.readFile(cert)},handle);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const {Agent,fetch}=require('undici'),agent=new Agent({connect:{ca:await fs.promises.readFile(cert)}});
 return {server,origin:'https://127.0.0.1:'+server.address().port,
  request:async(p,options={})=>new Promise((resolve,reject)=>{
   const req=https.request({hostname:'127.0.0.1',port:server.address().port,path:p,ca:fs.readFileSync(cert),
    checkServerIdentity:(_hostname,peerCertificate)=>require('node:tls').checkServerIdentity('127.0.0.1',peerCertificate),...options},res=>{
    const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(parts)}));
   });req.on('error',reject);req.end(options.body);
  }),
  fetch:(url,options)=>fetch(url,{...options,dispatcher:agent}),close:async()=>{
   server.closeAllConnections();await Promise.all([agent.close(),new Promise(resolve=>server.close(resolve))]);
   await fs.promises.rm(tmp,{recursive:true,force:true});
  }};
}
module.exports={connectorTlsFixture};
