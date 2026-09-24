'use strict';

const assert = require('node:assert/strict');
const {
  configuredStatusUrl,
  requireActiveViewEntitlement,
} = require('./verified_originals_entitlement');

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; },
  };
}

async function run() {
  assert.throws(
    () => configuredStatusUrl({}),
    /ENTITLEMENT_SERVICE_NOT_CONFIGURED/,
  );
  assert.throws(
    () => configuredStatusUrl({SIGILLUM_ENTITLEMENT_STATUS_URL:'http://evil.test/status'}),
    /ENTITLEMENT_SERVICE_NOT_CONFIGURED/,
  );

  const env = {
    SIGILLUM_ENTITLEMENT_STATUS_URL:
      'https://billing.sigillum.example/api/billing/status',
    SIGILLUM_VIEW_PRODUCT_IDS:
      'com.sigillum.hcv.creator.weekly,com.sigillum.hcv.creator.monthly,com.sigillum.hcv.creator.annual',
  };

  let seenAuth = '';
  const active = await requireActiveViewEntitlement(
    'Bearer session-token',
    {
      env,
      fetchImpl: async (_url, options) => {
        seenAuth = options.headers.authorization;
        return response(200, {
          status:'active',
          productId:'com.sigillum.hcv.creator.monthly',
          expiresAt:'2026-10-24T00:00:00Z',
        });
      },
    },
  );
  assert.equal(seenAuth, 'Bearer session-token');
  assert.equal(active.status, 'active');

  await assert.rejects(
    requireActiveViewEntitlement('Bearer free-user', {
      env,
      fetchImpl: async () => response(200, {status:'inactive'}),
    }),
    error => error.statusCode === 402 &&
      error.message === 'SUBSCRIPTION_REQUIRED',
  );

  await assert.rejects(
    requireActiveViewEntitlement('Bearer wrong-plan', {
      env,
      fetchImpl: async () => response(200, {
        status:'active',
        productId:'some.other.product',
      }),
    }),
    error => error.statusCode === 402 &&
      error.message === 'SUBSCRIPTION_REQUIRED',
  );

  await assert.rejects(
    requireActiveViewEntitlement('', {env}),
    error => error.statusCode === 401 && error.message === 'AUTH_REQUIRED',
  );

  await assert.rejects(
    requireActiveViewEntitlement('Bearer token', {
      env,
      fetchImpl: async () => { throw new Error('network'); },
    }),
    error => error.statusCode === 503 &&
      error.message === 'ENTITLEMENT_SERVICE_UNAVAILABLE',
  );

  console.log(
    'verified_originals_entitlement_test: PASS — server-side active subscription required',
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
