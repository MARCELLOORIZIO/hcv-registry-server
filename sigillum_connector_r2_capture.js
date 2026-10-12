'use strict';
const {Writable}=require('node:stream');
const VALID_TYPES=new Set(['image/png','image/jpeg']);
const MAX_REFERENCE_BYTES=8*1024*1024;
// Bounded in-process adapter for the existing streamR2Reference(res,reference,hcvId)
// which already uses materializeReference AES-GCM + SHA256 integrity verification.
// Never exposes the temporary decrypted path or provider credentials.
async function captureVerifiedR2Image({streamReference,reference,hcvId,maxBytes=MAX_REFERENCE_BYTES}){
 if(typeof streamReference!=='function'||!reference||!/^HCV-[A-F0-9]{16}$/.test(hcvId)||
    !Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_REFERENCE_BYTES)
   throw Error('CONNECTOR_CAPTURE_INPUT_INVALID');
 let length=0,headers=null;
 const pieces=[];
 const sink=new Writable({
   write(chunk,encoding,done){
     length+=chunk.length;
     if(length>maxBytes)return done(Error('CONNECTOR_IMAGE_TOO_LARGE'));
     pieces.push(Buffer.from(chunk));done();
   }
 });
 sink.writeHead=(code,values)=>{
   if(code!==200||headers)throw Error('CONNECTOR_STREAM_HEADERS_INVALID');
   const type=String(values['content-type']||'');
   const declared=Number(values['content-length']);
   if(!VALID_TYPES.has(type)||!Number.isSafeInteger(declared)||declared<1||declared>maxBytes)
     throw Error('CONNECTOR_IMAGE_SIZE_OR_TYPE_INVALID');
   headers={type,declared};
 };
 await streamReference(sink,reference,hcvId);
 if(!headers||length!==headers.declared)throw Error('CONNECTOR_IMAGE_TRUNCATED');
 const bytes=Buffer.concat(pieces);
 if(headers.type==='image/png'){
   if(bytes.length<8||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
     throw Error('CONNECTOR_IMAGE_SIGNATURE_INVALID');
 }else if(bytes.length<3||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)
   throw Error('CONNECTOR_IMAGE_SIGNATURE_INVALID');
 return {bytes:new Uint8Array(bytes),contentType:headers.type};
}
module.exports={captureVerifiedR2Image,MAX_REFERENCE_BYTES};
