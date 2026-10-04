const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('server.js', 'utf8');

assert(!source.includes('<h1>HUMAN VERIFIED</h1>'));
assert(!source.includes('This media has an HCV registry certificate.'));
assert(!source.includes('SIGILLUM verifies provenance and integrity.'));
assert(source.includes('Legacy Registry compatibility service'));
assert(source.includes('https://sigillum-hcv.com'));
assert(source.includes('Registry presence is not a media-integrity verdict.'));

console.log('legacy_surface_hardening_test: PASS');
