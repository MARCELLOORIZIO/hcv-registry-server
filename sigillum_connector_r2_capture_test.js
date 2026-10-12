'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {captureVerifiedR2Image}=require('./sigillum_connector_r2_capture');
const id='HCV-D8FF76496D424CA5';
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2]);
function stream(bytes=png,type='image/png',declared=bytes.length){
 return async sink=>{sink.writeHead(200,{'content-type':type,'content-length':String(declared)});
 await new Promise((resolve,reject)=>sink.end(bytes,e=>e?reject(e):resolve()));};
}
test('capture actual bounded PNG stream',async()=>{
 const out=await captureVerifiedR2Image({streamReference:stream(),reference:{},hcvId:id});
 assert.equal(out.contentType,'image/png');assert.deepEqual(Buffer.from(out.bytes),png);
});
test('reject oversized declared length before transfer',async()=>{
 await assert.rejects(captureVerifiedR2Image({streamReference:stream(png,'image/png',9000000),reference:{},hcvId:id}),/CONNECTOR_IMAGE_SIZE_OR_TYPE_INVALID/);
});
test('reject invalid media signature',async()=>{
 await assert.rejects(captureVerifiedR2Image({streamReference:stream(Buffer.from('12345678')),reference:{},hcvId:id}),/CONNECTOR_IMAGE_SIGNATURE_INVALID/);
});
test('reject incorrect content length',async()=>{
 await assert.rejects(captureVerifiedR2Image({streamReference:stream(png,'image/png',12),reference:{},hcvId:id}),/CONNECTOR_IMAGE_TRUNCATED/);
});
