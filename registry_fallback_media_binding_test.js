'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const fallback = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const guarded = fs.readFileSync(path.join(__dirname, 'registry_public_verify_guard.js'), 'utf8');
const pkg = require('./package.json');

// An accidental raw "node server.js" startup must never show a green
// authenticity badge for an HCV-ID-only lookup. The startup preloader has
// its own certificate-level provenance verification and no uploaded media.
assert.doesNotMatch(fallback, /HUMAN VERIFIED/);
assert.doesNotMatch(fallback, /This media has an HCV registry certificate\./);
assert.doesNotMatch(fallback, /SIGILLUM verifies provenance and integrity\. Powered by HCV Protocol\./);
assert.match(fallback, /REGISTRY RECORD FOUND/);
assert.match(fallback, /does not accept or compare the media file/);
assert.match(fallback, /A certificate lookup alone is not a verification of the viewed file/);
assert.match(pkg.scripts.start, /--require \.\/registry_public_verify_guard\.js/);
assert.match(guarded, /does not by itself verify a separate copy of the media file/);

console.log('registry_fallback_media_binding_test: PASS');
