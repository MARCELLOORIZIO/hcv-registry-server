'use strict';

function entitlementError(code, statusCode) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function configuredStatusUrl(env = process.env) {
  const raw = String(env.SIGILLUM_ENTITLEMENT_STATUS_URL || '').trim();
  if (!raw) throw entitlementError('ENTITLEMENT_SERVICE_NOT_CONFIGURED', 503);
  let url;
  try { url = new URL(raw); } catch (_) {
    throw entitlementError('ENTITLEMENT_SERVICE_NOT_CONFIGURED', 503);
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !localhost) {
    throw entitlementError('ENTITLEMENT_SERVICE_NOT_CONFIGURED', 503);
  }
  return url;
}

function allowedProducts(env = process.env) {
  const raw = String(env.SIGILLUM_VIEW_PRODUCT_IDS || '').trim();
  if (!raw) return null;
  const values = raw.split(',').map(v => v.trim()).filter(Boolean);
  return values.length ? new Set(values) : null;
}

async function requireActiveViewEntitlement(
  authorization,
  {fetchImpl = fetch, env = process.env} = {},
) {
  const token = String(authorization || '');
  if (!token.startsWith('Bearer ') || token.length <= 7) {
    throw entitlementError('AUTH_REQUIRED', 401);
  }

  const url = configuredStatusUrl(env);
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  timeout.unref?.();
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: token,
        accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (_) {
    throw entitlementError('ENTITLEMENT_SERVICE_UNAVAILABLE', 503);
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try { payload = await response.json(); } catch (_) {}

  if (response.status === 401 || response.status === 403) {
    throw entitlementError('AUTH_REQUIRED', 401);
  }
  if (!response.ok) {
    if (response.status === 402) {
      throw entitlementError('SUBSCRIPTION_REQUIRED', 402);
    }
    throw entitlementError('ENTITLEMENT_SERVICE_UNAVAILABLE', 503);
  }
  if (!payload || payload.status !== 'active') {
    throw entitlementError('SUBSCRIPTION_REQUIRED', 402);
  }

  const products = allowedProducts(env);
  const productId = String(payload.productId || '');
  if (products && !products.has(productId)) {
    throw entitlementError('SUBSCRIPTION_REQUIRED', 402);
  }

  return {
    status: 'active',
    productId,
    expiresAt: payload.expiresAt || null,
  };
}

module.exports = {
  configuredStatusUrl,
  allowedProducts,
  requireActiveViewEntitlement,
};
