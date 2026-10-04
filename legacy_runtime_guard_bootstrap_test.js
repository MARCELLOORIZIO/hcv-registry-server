const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('server.js', 'utf8');
const httpGuard = source.indexOf("require('./registry_http_guard')");
const publicGuard = source.indexOf("require('./registry_public_verify_guard')");
const httpImport = source.indexOf("const http = require('http')");

assert(httpGuard >= 0);
assert(publicGuard >= 0);
assert(httpImport >= 0);
assert(httpGuard < httpImport);
assert(publicGuard < httpImport);

console.log('legacy_runtime_guard_bootstrap_test: PASS');
