'use strict';
// Shared non-extractable browser device identity used by the existing owner audit
// and experimental OAuth consent. Reuses the same IndexedDB enrollment.
const ownerDeviceLoginHelpers=String.raw`
// The owner's RSA key remains non-extractable in IndexedDB, as required by
// the existing device enrollment flow. Password and Bearer session are never stored.
async function deviceKey(){
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('sigillum-audit-owner-device',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
    const existing=await new Promise((resolve,reject)=>{const r=db.transaction('keys').objectStore('keys').get('rsa');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    if(existing)return existing;
    const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
    await new Promise((resolve,reject)=>{const tx=db.transaction('keys','readwrite');tx.objectStore('keys').put(key,'rsa');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return key;
  }finally{db.close();}
}
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const regularB64=value=>{let s=value.replace(/-/g,'+').replace(/_/g,'/');return s+'='.repeat((4-s.length%4)%4);};
`;
module.exports={ownerDeviceLoginHelpers};
