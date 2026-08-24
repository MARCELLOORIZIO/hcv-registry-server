'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { signedPayloadFromRawCertificate } = require('./hcv_signature_canonical');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });

const signedCanonical = '{"format":"HCV_CERTIFICATE","version":2,"sessionId":"s","createdAt":"2026-08-16T00:00:00.000Z","meta":{"hcvId":"HCV-0123456789ABCDEF"},"content":{"type":"video","confidence":1.0},"claims":{},"rootHash":"root","chain":[]}';
const signature = crypto.sign('RSA-SHA256', Buffer.from(signedCanonical, 'utf8'), privateKey).toString('base64');
const modulus = Buffer.from(jwk.n, 'base64url').toString('base64');
const exponent = Buffer.from(jwk.e, 'base64url').toString('base64');

const raw = `{
  "format": "HCV_CERTIFICATE",
  "version": 2,
  "sessionId": "s",
  "createdAt": "2026-08-16T00:00:00.000Z",
  "meta": {"hcvId": "HCV-0123456789ABCDEF"},
  "content": {"type": "video", "confidence": 1.0},
  "claims": {},
  "rootHash": "root",
  "chain": [],
  "signatureAlgorithm": "RSA-SHA256-HCV-V2",
  "signature": "${signature}",
  "publicKey": {"modulus": "${modulus}", "exponent": "${exponent}"}
}`;

const parsed = JSON.parse(raw);
const signed = { ...parsed };
delete signed.signatureAlgorithm;
delete signed.signature;
delete signed.publicKey;
const jsCanonical = JSON.stringify(signed);
assert.notStrictEqual(jsCanonical, signedCanonical, 'JS stringify should demonstrate the 1.0 -> 1 mismatch');

const recovered = signedPayloadFromRawCertificate(raw);
assert.strictEqual(recovered, signedCanonical, 'lexical canonicalization must reproduce the app-signed bytes exactly');
assert.strictEqual(
  crypto.verify('RSA-SHA256', Buffer.from(recovered, 'utf8'), publicKey, Buffer.from(signature, 'base64')),
  true,
  'recovered canonical payload must verify with the certificate public key',
);

const tampered = raw.replace('"confidence": 1.0', '"confidence": 0.9');
const recoveredTampered = signedPayloadFromRawCertificate(tampered);
assert.strictEqual(
  crypto.verify('RSA-SHA256', Buffer.from(recoveredTampered, 'utf8'), publicKey, Buffer.from(signature, 'base64')),
  false,
  'tampering must still invalidate the signature',
);

console.log('HCV Dart-compatible canonical signature test: PASS');
