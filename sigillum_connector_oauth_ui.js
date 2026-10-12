'use strict';
const {ownerDeviceLoginHelpers}=require('./sigillum_owner_web_auth');
function connectorOAuthPage({flowId,clientId,nonce}){
 if(!/^[a-f0-9]{32}$/.test(flowId)||!/^[A-Za-z0-9+/=]+$/.test(nonce))throw Error('OAUTH_PAGE_INPUT_INVALID');
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collega SIGILLUM</title>
 <style nonce="${nonce}">body{font:17px/1.5 system-ui;color:#201040;background:#f2f7fb}main{max-width:600px;margin:40px auto;background:white;padding:28px;border-radius:16px}label{display:block;margin:16px 0}input:not([type=checkbox]){width:100%;box-sizing:border-box;padding:10px;font:inherit}button{font:inherit;padding:12px;background:#201040;color:white;border:0;border-radius:8px}#status{white-space:pre-wrap}code{overflow-wrap:anywhere}</style></head>
 <body><main><h1>Collega SIGILLUM a ChatGPT</h1><p>Client: <code>${escape(clientId)}</code></p>
 <p>Il collegamento permette a ChatGPT di richiedere un audit. La lettura degli originali richiede una tua approvazione separata, limitata agli HCV-ID scelti e valida per cinque minuti.</p>
 <form id="login"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Accedi a SIGILLUM</button></form>
 <section id="approval" hidden><label><input id="confirm" type="checkbox"> Autorizzo questo client a collegarsi al mio account SIGILLUM e a richiedere audit.</label><button id="connect">Conferma collegamento</button></section><p id="status" role="status"></p></main>
 <script nonce="${nonce}">'use strict';const flowId=${JSON.stringify(flowId)};
 ${ownerDeviceLoginHelpers}
 let ownerToken='';const $=id=>document.getElementById(id);
 async function api(path,body,token=''){
  const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Error(data.error||data.code||'Richiesta non riuscita');return data;
 }
 $('login').onsubmit=async e=>{e.preventDefault();const form=e.target;try{
  const key=await deviceKey(),jwk=await crypto.subtle.exportKey('jwk',key.publicKey);
  const publicKey={modulus:regularB64(jwk.n),exponent:regularB64(jwk.e)},encoder=new TextEncoder();
  const fp=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(publicKey))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const signedAt=new Date().toISOString(),statement=JSON.stringify({purpose:'SIGILLUM_AUTH_DEVICE_BINDING_V1',deviceKeyFingerprint:fp,signedAt});
  const signature=b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key.privateKey,encoder.encode(statement)));
  const payload={email:form.elements.email.value,password:form.elements.password.value,publicKey,deviceKeyFingerprint:fp,signedAt,signature};
  const data=await api('/api/auth/login',payload);payload.password='';ownerToken=data.token;
  $('login').hidden=true;$('approval').hidden=false;$('status').textContent='Verifica il client e conferma il collegamento.';
 }catch(error){ownerToken='';$('status').textContent=error.message+' — Se SIGILLUM richiede la conferma del dispositivo, completa la conferma già prevista dal tuo account e riprova.';}
 finally{form.elements.password.value='';}};
 $('connect').onclick=async()=>{try{
  if(!$('confirm').checked)throw Error('Spunta prima il consenso al collegamento.');
  $('connect').disabled=true;
  const data=await api('/connector/oauth/consent',{flowId,confirm:true},ownerToken);ownerToken='';location.assign(data.redirectUrl);
 }catch(error){$('connect').disabled=false;$('status').textContent=error.message;}};
 window.addEventListener('pagehide',()=>{ownerToken='';});
 </script></body></html>`;
}
module.exports={connectorOAuthPage};
