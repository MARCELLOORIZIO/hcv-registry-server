'use strict';

const fs = require('fs');
const assert = require('assert');

const server = fs.readFileSync('production_server.js', 'utf8');
const legal = fs.readFileSync('legal_documents.js', 'utf8');

assert(legal.includes('--cyan:#1FC7D4'), 'approved cyan legal palette missing');
assert(legal.includes('--purple:#7645D9'), 'approved purple legal palette missing');
assert(legal.includes('--ink:#280D5F'), 'approved text palette missing');
assert(server.includes('emailReusable: true'), 'delete response must declare reusable email');
assert(
  server.includes("await client.query('DELETE FROM accounts WHERE id=$1'") ||
    server.includes("await pool.query('DELETE FROM accounts WHERE id=$1'"),
  'account row must still be deleted so the same email can register again',
);

console.log('Consumer modular theme and reusable-email deletion contract OK');
