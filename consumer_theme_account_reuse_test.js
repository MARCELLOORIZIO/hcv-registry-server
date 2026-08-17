'use strict';

const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('production_server.js', 'utf8');

assert(source.includes('--cyan:#1FC7D4'), 'approved cyan legal palette missing');
assert(source.includes('--purple:#7645D9'), 'approved purple legal palette missing');
assert(source.includes('--ink:#280D5F'), 'approved text palette missing');
assert(source.includes('emailReusable: true'), 'delete response must declare reusable email');
assert(
  source.includes("await pool.query('DELETE FROM accounts WHERE id=$1'"),
  'account row must still be deleted so the same email can register again',
);

console.log('Consumer theme and reusable-email deletion contract OK');
