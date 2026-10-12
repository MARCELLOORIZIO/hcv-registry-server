'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createMcpCredentialStore}=require('./sigillum_mcp_credentials');
const h=x=>createHash('sha256').update(x).digest('hex');
test('short-lived credential is stored only by hash, resolvable and revocable',async()=>{
 const records=new Map(),now=new Date('2026-10-12T12:00:00Z');
 const pool={query:async(sql,args)=>{
   if(sql.includes('INSERT INTO')){records.set(args[0],{principal:args[1],expires_at:args[2],revoked_at:null});return {rows:[]};}
   if(sql.includes('SELECT principal'))return {rows:records.has(args[0])?[records.get(args[0])]:[]};
   if(sql.includes('UPDATE')){records.get(args[0]).revoked_at=now;return {rows:[]};}
   throw Error('Unexpected query');
 }};
 const store=createMcpCredentialStore({pool,now:()=>now});
 const issued=await store.provision({principal:'chatgpt:approved-test',ttlSeconds:300});
 assert.equal(records.has(issued.token),false);
 const digest=h(issued.token);
 assert.equal((await store.lookupTokenHash(digest)).principal,'chatgpt:approved-test');
 await store.revoke({tokenHash:digest});
 assert.equal((await store.lookupTokenHash(digest)).revoked,true);
});
test('reject credential provisioning outside allowed TTL',async()=>{
 const store=createMcpCredentialStore({pool:{query:async()=>({rows:[]})}});
 await assert.rejects(store.provision({principal:'valid',ttlSeconds:10}),/MCP_CREDENTIAL_SCOPE_INVALID/);
});
