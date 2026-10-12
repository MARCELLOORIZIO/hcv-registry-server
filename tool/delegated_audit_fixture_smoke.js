'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixtures=require('./delegated_audit_fixture_images.json');
async function smoke(base){
 const root='/api/verified-originals/audit/requests',hcvIds=Object.keys(fixtures);
 const request=await fetch(base+root,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({hcvIds})});
 assert.equal(request.status,201);const data=await request.json(),cookie=request.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+root+'/'+data.requestId)).status,401);
 const headers={Origin:base,Cookie:cookie,'Content-Type':'application/json'};
 const before=await fetch(base+root+'/'+data.requestId+'/'+hcvIds[0]+'/read-authorization',{method:'POST',headers,body:'{}'});assert.equal(before.status,403);
 const approval=await fetch(base+'/fixture-approve',{method:'POST',headers,body:JSON.stringify({requestId:data.requestId})});assert.equal(approval.status,200);
 for(const id of hcvIds){
  const auth=await fetch(base+root+'/'+data.requestId+'/'+id+'/read-authorization',{method:'POST',headers,body:'{}'});assert.equal(auth.status,201);
  const path=(await auth.json()).readPath;
  assert.equal((await fetch(base+path)).status,401);
  const read=await fetch(base+path,{headers:{Cookie:cookie}});if(read.status!==200)throw new Error(await read.text());
  const bytes=Buffer.from(await read.arrayBuffer()),expected=Buffer.from(fixtures[id],'base64');
  assert.deepEqual(bytes,expected);assert.equal(read.headers.get('x-sigillum-fixture'),'synthetic-only');
  assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,403);
  console.log(JSON.stringify({hcvId:id,synthetic:true,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),decryptAndReplay:'PASS'}));
 }
 console.log('SYNTHETIC_TRANSPORT_ACCEPTANCE_PASS');
}
async function run(){
 let child;
 try{
  if(process.argv.includes('--spawn')){
   child=require('node:child_process').spawn(process.execPath,[require('node:path').join(__dirname,'delegated_audit_browser_fixture.js')],{env:{...process.env,SIGILLUM_AUDIT_FIXTURE_ONLY:'true',PORT:'8767'},stdio:['ignore','pipe','pipe']});
   await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('FIXTURE_START_TIMEOUT')),10000);
    child.stdout.on('data',data=>{if(data.toString().includes('SYNTHETIC_AUDIT_FIXTURE_READY')){clearTimeout(timeout);resolve();}});
    child.stderr.on('data',data=>process.stderr.write(data));
    child.on('exit',code=>{clearTimeout(timeout);reject(new Error('FIXTURE_EXIT_'+code));});
   });
  }
  await smoke(process.env.AUDIT_FIXTURE_BASE_URL||'http://127.0.0.1:8767');
 }finally{if(child)child.kill('SIGTERM');}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
