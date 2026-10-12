'use strict';
const {ownerDeviceLoginHelpers}=require('./sigillum_owner_web_auth');
function auditPage({mode,requestId,nonce}) {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SIGILLUM · Audit privato</title><style nonce="${nonce}">body{font:17px/1.5 system-ui;background:#f2f7fb;color:#201040;margin:0}main{max-width:760px;margin:32px auto;padding:24px;background:white;border-radius:18px}input,textarea,button{font:inherit;padding:12px;margin:8px 0;box-sizing:border-box}input:not([type=checkbox]),textarea{width:100%}button{background:#201040;color:white;border:0;border-radius:8px;cursor:pointer}button:disabled{opacity:.5}label{display:block}img{display:block;max-width:100%;height:auto;margin:18px 0}code{overflow-wrap:anywhere}#status{white-space:pre-wrap}.error{color:#a00000}</style></head><body><main><h1>Audit privato SIGILLUM</h1><p>Lettura dei soli originali approvati. Nessuna modifica ai file. La delega scade dopo cinque minuti e ogni fotografia può essere letta una sola volta.</p><section id="create" hidden><label>HCV-ID, uno per riga<textarea id="ids" rows="3">HCV-D8FF76496D424CA5\nHCV-255DEE0995364F99</textarea></label><button id="request">Richiedi audit</button></section><section id="browser" hidden><p id="approval"></p><p id="fingerprint"></p><button id="refresh">Verifica approvazione</button><div id="photos"></div></section><section id="owner" hidden><p>Accedi al tuo account SIGILLUM per controllare e approvare la richiesta. La tua sessione non viene trasferita al browser di audit.</p><form id="login"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Accedi</button></form><div id="scope"></div><label id="consentLabel" hidden><input id="consent" type="checkbox"> Autorizzo questo browser a leggere esclusivamente gli HCV-ID elencati, per cinque minuti, per l’analisi dei display nelle fotografie.</label><button id="approve" hidden>Autorizza audit</button><button id="revoke" hidden>Revoca audit</button></section><p id="status" role="status"></p></main><script nonce="${nonce}">const mode=${JSON.stringify(mode)}, requestId=${JSON.stringify(requestId)};
`;
  return html + String.raw`
'use strict';
const $ = id => document.getElementById(id);
const root = '/api/verified-originals/audit/requests/';
let ownerToken = '', approvedScope = null;
function status(value,error=false){$('status').textContent=value;$('status').className=error?'error':'';}
async function api(path,method='GET',body,token='') {
  const response = await fetch(path,{method,credentials:'same-origin',cache:'no-store',
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data = await response.json();
  if(!response.ok)throw new Error(data.error || data.code || data.message || 'Richiesta non riuscita');
  return data;
}
function link(path,text){const a=document.createElement('a');a.href=path;a.textContent=text;return a;}
if(mode==='new'){
  $('create').hidden=false;
  const createRequest=async()=>{try{
    $('request').disabled=true;
    const hcvIds=$('ids').value.split(/\s+/).filter(Boolean);
    const result=await api('/api/verified-originals/audit/requests','POST',{hcvIds});
    location.assign(result.browserPath);
  }catch(e){$('request').disabled=false;status(e.message,true);}};
  $('request').onclick=createRequest;
  // A one-time browser-local launch hint: the fragment is not sent to the
  // backend in HTTP requests. It only creates a PENDING grant, never approval.
  const match=/^#start=(HCV-[A-F0-9]{16}(?:,HCV-[A-F0-9]{16}){0,24})$/.exec(location.hash);
  if(match){
    const ids=match[1].split(',');
    if(new Set(ids).size===ids.length){
      $('ids').value=ids.join('\n');
      history.replaceState(null,'',location.pathname);
      void createRequest();
    }
  }
}
if(mode==='browser'){
  $('browser').hidden=false;
  $('approval').append('Apri questa pagina sull’iPhone: ',link('/audit/approve/'+requestId,location.origin+'/audit/approve/'+requestId));
  $('refresh').onclick=async()=>{try{
    const scope=await api(root+requestId);
    $('fingerprint').textContent='Richiesta '+requestId.slice(0,12)+' · Browser '+scope.browserFingerprint+' · '+scope.hcvIds.join(', ');
    status(scope.state==='PENDING'?'In attesa dell’approvazione del proprietario.':scope.state);
    if(scope.state!=='APPROVED')return;
    $('refresh').disabled=true;
    for(const id of scope.hcvIds){
      const authorization=await api(root+requestId+'/'+id+'/read-authorization','POST',{});
      const response=await fetch(authorization.readPath,{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error('Lettura negata: '+response.status);
      const blob=await response.blob();
      const image=document.createElement('img'); image.alt='Originale protetto '+id;
      image.src=URL.createObjectURL(blob); image.dataset.hcvId=id;
      const title=document.createElement('h2');title.textContent=id;
      $('photos').append(title,image);
      image.onload=()=>{image.dataset.loaded='true';};
    }
    status('Originali ricevuti. La lettura è stata registrata.');
  }catch(e){status(e.message,true);}};
}
${ownerDeviceLoginHelpers}
if(mode==='approve'){
  $('owner').hidden=false;
  $('login').onsubmit=async e=>{e.preventDefault();try{
    const form=e.target, key=await deviceKey(), jwk=await crypto.subtle.exportKey('jwk',key.publicKey);
    const publicKey={modulus:regularB64(jwk.n),exponent:regularB64(jwk.e)};
    const encoder=new TextEncoder();
    const fp=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(publicKey))))).map(v=>v.toString(16).padStart(2,'0')).join('');
    const signedAt=new Date().toISOString();
    const statement=JSON.stringify({purpose:'SIGILLUM_AUTH_DEVICE_BINDING_V1',deviceKeyFingerprint:fp,signedAt});
    const signature=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,encoder.encode(statement)));
    const payload={email:form.elements.email.value,password:form.elements.password.value,publicKey,deviceKeyFingerprint:fp,signedAt,signature};
    const result=await api('/api/auth/login','POST',payload);payload.password='';form.elements.password.value='';
    ownerToken=result.token;
    approvedScope=await api(root+requestId+'/owner-scope','GET',undefined,ownerToken);
    const connector=approvedScope.requesterType==='CONNECTOR';
    $('scope').textContent='Richiesta '+requestId.slice(0,12)+' · '+(connector?'Connettore '+approvedScope.connectorFingerprint:'Browser '+approvedScope.browserFingerprint)+' · HCV-ID: '+approvedScope.hcvIds.join(', ');
    if(connector){
      $('consentLabel').lastChild.textContent=' Autorizzo il connettore identificato sopra a ricevere in ChatGPT esclusivamente gli originali degli HCV-ID elencati, per cinque minuti e una sola lettura per fotografia.';
    }
    $('login').hidden=true;$('consentLabel').hidden=false;$('approve').hidden=false;
    status('Verifica gli HCV-ID, poi spunta l’autorizzazione e premi Autorizza audit.');
  }catch(error){e.target.elements.password.value='';status(error.message+'\nSe è richiesto un nuovo dispositivo, confermalo nell’email SIGILLUM, poi torna a questa pagina e premi nuovamente Accedi.',true);}};
  $('approve').onclick=async()=>{try{
    if(!$('consent').checked)throw new Error('Spunta prima l’autorizzazione esplicita.');
    const result=await api(root+requestId+'/approve','POST',{confirm:true,hcvIds:approvedScope.hcvIds,scopeDigest:approvedScope.scopeDigest},ownerToken);
    $('approve').hidden=true;$('consentLabel').hidden=true;$('revoke').hidden=false;
    status('Audit autorizzato fino a '+new Date(result.expiresAt).toLocaleTimeString()+'. Torna alla conversazione; '+(approvedScope.requesterType==='CONNECTOR'?'il connettore':'il browser di audit')+' può ora recuperare gli originali.');
  }catch(e){status(e.message,true);}};
  $('revoke').onclick=async()=>{try{
    await api(root+requestId+'/revoke','POST',{},ownerToken);status('Audit revocato.');$('revoke').hidden=true;ownerToken='';
  }catch(e){status(e.message,true);}};
}
window.addEventListener('pagehide',()=>{ownerToken='';document.querySelectorAll('img').forEach(img=>URL.revokeObjectURL(img.src));});
</script></body></html>`;
}
module.exports={auditPage};
