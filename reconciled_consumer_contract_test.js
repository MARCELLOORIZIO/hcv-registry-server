'use strict';

const fs = require('fs');
const assert = require('assert');

const server = fs.readFileSync('production_server.js', 'utf8');
const legal = fs.readFileSync('legal_documents.js', 'utf8');

for (const token of ['--cyan:#1FC7D4', '--purple:#7645D9', '--ink:#280D5F']) {
  assert(legal.includes(token), `approved 18-Aug legal palette missing: ${token}`);
}
assert(server.includes('emailReusable: true'), 'delete response must declare reusable email');
assert(
  server.includes("await client.query('DELETE FROM accounts WHERE id=$1'") ||
    server.includes("await pool.query('DELETE FROM accounts WHERE id=$1'"),
  'account row must still be deleted so the same email can register again',
);
assert(
  legal.includes("const SUPPORTED_LANGUAGES = ['it', 'en', 'es', 'ru'];"),
  'consumer theme must preserve multilingual 18-Aug legal architecture',
);

console.log('Reconciled consumer/legal contract OK');
