'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('production_server.js', 'utf8');

const registerStart = source.indexOf(
  "if (req.method === 'POST' && url.pathname === '/api/auth/register')",
);
const registerEnd = source.indexOf(
  "if (req.method === 'POST' && url.pathname === '/api/auth/verify-email')",
  registerStart,
);
assert(registerStart >= 0 && registerEnd > registerStart, 'register route not found');
const registerRoute = source.slice(registerStart, registerEnd);

assert(
  registerRoute.includes('const serverCreatorId = crypto.randomUUID();'),
  'registration must generate Creator ID server-side',
);
assert(
  registerRoute.includes('creatorName, serverCreatorId, TERMS_VERSION'),
  'registration must persist the server-generated Creator ID',
);
assert(
  !registerRoute.includes('body.creatorId'),
  'registration must not trust a client-supplied Creator ID',
);

const envelopeStart = source.indexOf('async function accountEnvelope(');
const envelopeEnd = source.indexOf('\n}', envelopeStart);
assert(envelopeStart >= 0 && envelopeEnd > envelopeStart, 'account envelope not found');
const envelope = source.slice(envelopeStart, envelopeEnd + 2);
assert(
  envelope.includes("creatorId: account.creator_id || ''"),
  'authenticated account envelope must return its persisted Creator ID',
);

console.log('creator_identity_isolation_test: PASS');
