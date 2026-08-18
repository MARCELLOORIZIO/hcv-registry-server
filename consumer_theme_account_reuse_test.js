'use strict';

const fs = require('fs');
const assert = require('assert');

const productionSource = fs.readFileSync('production_server.js', 'utf8');
const legalSource = fs.existsSync('legal_documents.js')
  ? fs.readFileSync('legal_documents.js', 'utf8')
  : '';
const visualSource = `${productionSource}\n${legalSource}`;

assert(visualSource.includes('--cyan:#1FC7D4'), 'approved cyan legal palette missing');
assert(visualSource.includes('--purple:#7645D9'), 'approved purple legal palette missing');
assert(visualSource.includes('--ink:#280D5F'), 'approved text palette missing');
assert(productionSource.includes('emailReusable: true'), 'delete response must declare reusable email');
assert(
  productionSource.includes("await client.query('DELETE FROM accounts WHERE id=$1'") ||
    productionSource.includes("await pool.query('DELETE FROM accounts WHERE id=$1'"),
  'account row must still be deleted so the same email can register again',
);

console.log('Consumer theme and reusable-email deletion contract OK');