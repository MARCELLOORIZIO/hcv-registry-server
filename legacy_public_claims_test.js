const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('server.js', 'utf8');

assert(!source.includes('<h1>HUMAN VERIFIED</h1>'));
assert(!source.includes('This media has an HCV registry certificate.'));
assert(!source.includes('SIGILLUM verifies provenance and integrity.'));
assert(source.includes('<h1>HCV REGISTRY RECORD</h1>'));
assert(source.includes('No media file was compared by this page.'));
assert(source.includes('Registry presence is not a media-integrity verdict.'));
assert(source.includes('https://sigillum-hcv.com'));

console.log('legacy_public_claims_test: PASS');
