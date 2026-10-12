'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {createConnectorRuntime}=require('./sigillum_connector_runtime');
test('default startup never initializes OAuth, imports host or intercepts existing routes',async()=>{
 const r=createConnectorRuntime({verifiedOriginals:{createConnectorRemoteHost(){throw Error('must not activate');}},env:{}});
 assert.equal(r.enabled,false);await r.initSchema();assert.equal(await r.handle(),false);
});
test('activation requires explicit client, HTTPS and transport policy configuration',()=>{
 const base={SIGILLUM_CONNECTOR_ENABLED:'true',SIGILLUM_DELEGATED_AUDIT_ORIGIN:'https://registry.onrender.com',
  SIGILLUM_CONNECTOR_OAUTH_CLIENTS_JSON:'[{"clientId":"configured-client","redirectUris":["https://chatgpt.com/connector_platform_oauth_redirect"]}]'};
 assert.throws(()=>createConnectorRuntime({env:base}),/TLS_POLICY/);
 assert.throws(()=>createConnectorRuntime({env:{...base,SIGILLUM_CONNECTOR_TLS_MODE:'RENDER_EDGE'}}),/RENDER_EDGE_CONFIG/);
 let passed;
 const r=createConnectorRuntime({verifiedOriginals:{createConnectorRemoteHost:config=>{passed=config;return {initSchema:async()=>{},handle:async()=>true};}},
  env:{...base,SIGILLUM_CONNECTOR_TLS_MODE:'RENDER_EDGE',RENDER:'true',RENDER_EXTERNAL_HOSTNAME:'registry.onrender.com',RENDER_SERVICE_ID:'synthetic-service'}});
 assert.equal(r.enabled,true);assert.equal(passed.resource,'https://registry.onrender.com/connector/mcp');
 assert.equal(passed.isTrustedTransport({socket:{},headers:{host:'registry.onrender.com','x-forwarded-proto':'https'}}),true);
 assert.equal(passed.isTrustedTransport({socket:{},headers:{host:'attacker.invalid','x-forwarded-proto':'https'}}),false);
 assert.equal(passed.isTrustedTransport({socket:{},headers:{host:'registry.onrender.com','x-forwarded-proto':'http'}}),false);
});
test('prestart installer is idempotent and preserves Verified Originals routing',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sigillum-runtime-test-'));
 try{
  // Materialize the actual tracked checkout with the complete existing ordered
  // precheck pipeline, in isolation from the working tree and production.
  const archive=execFileSync('git',['archive','HEAD'],{maxBuffer:64*1024*1024});
  execFileSync('tar',['-x','-C',tmp],{input:archive});
  const commands=JSON.parse(fs.readFileSync('package.json','utf8')).scripts.precheck.split(' && ');
  for(const command of commands){
   const match=/^python3 (tool\/[^ ]+\.py)$/.exec(command);
   assert(match,'unexpected precheck command');
   if(match[1]==='tool/apply_sigillum_connector_runtime.py')continue;
   execFileSync('python3',[path.resolve(match[1])],{cwd:tmp,stdio:'pipe'});
  }
  const script=path.resolve('tool/apply_sigillum_connector_runtime.py');
  execFileSync('python3',[script],{cwd:tmp});const once=fs.readFileSync(path.join(tmp,'production_server.js'),'utf8');
  execFileSync('python3',[script],{cwd:tmp});const twice=fs.readFileSync(path.join(tmp,'production_server.js'),'utf8');
  assert.equal(once,twice);assert.equal((twice.match(/connectorRuntime.handle\(/g)||[]).length,1);
  assert(twice.includes('verifiedOriginals.handle(req, res, url)'));assert(twice.includes('await verifiedOriginals.initSchema();'));
  execFileSync(process.execPath,['--check',path.join(tmp,'production_server.js')]);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
