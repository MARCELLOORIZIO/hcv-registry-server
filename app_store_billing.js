const crypto = require('crypto');
const https = require('https');
const {
  AppStoreServerAPIClient,
  Environment,
  ReceiptUtility,
  SignedDataVerifier,
} = require('@apple/app-store-server-library');

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.sigillum.hcv';
const APPLE_APP_ID = Number(process.env.APPLE_APP_ID || 0);
const ISSUER_ID = process.env.APPLE_IAP_ISSUER_ID || '';
const KEY_ID = process.env.APPLE_IAP_KEY_ID || '';
const ENVIRONMENT_MODE = String(process.env.APPLE_IAP_ENVIRONMENT || 'AUTO').toUpperCase();
const TEST_MODE = process.env.NODE_ENV === 'test' && process.env.APPLE_BILLING_TEST_MODE === 'true';
const ALLOWED_PRODUCTS = new Set([
  process.env.APPLE_WEEKLY_PRODUCT_ID || 'com.sigillum.hcv.creator.weekly',
  process.env.APPLE_MONTHLY_PRODUCT_ID || 'com.sigillum.hcv.creator.monthly',
  process.env.APPLE_ANNUAL_PRODUCT_ID || 'com.sigillum.hcv.creator.annual',
]);

const ROOTS = [
  {
    url: 'https://www.apple.com/appleca/AppleIncRootCertificate.cer',
    sha256: 'b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024',
  },
  {
    url: 'https://www.apple.com/certificateauthority/AppleRootCA-G2.cer',
    sha256: 'c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050',
  },
  {
    url: 'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer',
    sha256: '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179',
  },
];

let rootCache;

function privateKey() {
  const base64 = process.env.APPLE_IAP_PRIVATE_KEY_BASE64 || '';
  if (base64) return Buffer.from(base64, 'base64');
  const raw = process.env.APPLE_IAP_PRIVATE_KEY || '';
  if (!raw) return Buffer.alloc(0);
  return Buffer.from(raw.replace(/\\n/g, '\n'), 'utf8');
}

function configured() {
  return TEST_MODE || Boolean(ISSUER_ID && KEY_ID && privateKey().length && BUNDLE_ID);
}

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: 10000 }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 3) {
        response.resume();
        resolve(fetchBuffer(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`APPLE_ROOT_CA_HTTP_${response.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(new Error('APPLE_ROOT_CA_TOO_LARGE'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout', () => request.destroy(new Error('APPLE_ROOT_CA_TIMEOUT')));
    request.on('error', reject);
  });
}

async function loadRoots() {
  if (!rootCache) {
    rootCache = Promise.all(ROOTS.map(async root => {
      const bytes = await fetchBuffer(root.url);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== root.sha256) throw new Error('APPLE_ROOT_CA_FINGERPRINT_MISMATCH');
      return bytes;
    })).catch(error => {
      rootCache = undefined;
      throw error;
    });
  }
  return rootCache;
}

function environmentCandidates() {
  if (ENVIRONMENT_MODE === 'PRODUCTION') return [Environment.PRODUCTION];
  if (ENVIRONMENT_MODE === 'SANDBOX') return [Environment.SANDBOX];
  return [Environment.PRODUCTION, Environment.SANDBOX];
}

function client(environment) {
  if (!configured()) throw Object.assign(new Error('APPLE_BILLING_NOT_CONFIGURED'), { statusCode: 503 });
  return new AppStoreServerAPIClient(privateKey(), KEY_ID, ISSUER_ID, BUNDLE_ID, environment);
}

async function verifier(environment) {
  const roots = await loadRoots();
  if (environment === Environment.PRODUCTION && !APPLE_APP_ID) {
    throw Object.assign(new Error('APPLE_APP_ID_REQUIRED'), { statusCode: 503 });
  }
  return new SignedDataVerifier(
    roots,
    true,
    environment,
    BUNDLE_ID,
    environment === Environment.PRODUCTION ? APPLE_APP_ID : undefined,
  );
}

function normalizedStatus(status) {
  switch (Number(status)) {
    case 1: return 'active';
    case 2: return 'expired';
    case 3: return 'billing_retry';
    case 4: return 'grace';
    case 5: return 'revoked';
    default: return 'inactive';
  }
}

function assertProduct(productId, expectedProductId) {
  if (!ALLOWED_PRODUCTS.has(productId)) throw Object.assign(new Error('APPLE_PRODUCT_NOT_ALLOWED'), { statusCode: 422 });
  if (expectedProductId && productId !== expectedProductId) {
    throw Object.assign(new Error('APPLE_PRODUCT_MISMATCH'), { statusCode: 422 });
  }
}

function normalizeDecoded(decoded, environment, status) {
  const productId = String(decoded.productId || '');
  assertProduct(productId);
  const expiresMs = Number(decoded.expiresDate || 0);
  const revoked = Boolean(decoded.revocationDate);
  const derivedStatus = status || (revoked ? 'revoked' : (expiresMs > Date.now() ? 'active' : 'expired'));
  return {
    provider: 'app_store',
    environment: environment === Environment.PRODUCTION ? 'Production' : 'Sandbox',
    status: derivedStatus,
    productId,
    transactionId: String(decoded.transactionId || ''),
    originalTransactionId: String(decoded.originalTransactionId || decoded.transactionId || ''),
    expiresAt: expiresMs ? new Date(expiresMs).toISOString() : null,
    purchaseDate: decoded.purchaseDate ? new Date(Number(decoded.purchaseDate)).toISOString() : null,
    revocationDate: decoded.revocationDate ? new Date(Number(decoded.revocationDate)).toISOString() : null,
    verifiedAt: new Date().toISOString(),
  };
}

function transactionIdFromInput(transactionId, receiptData) {
  const direct = String(transactionId || '').trim();
  if (direct) return direct;
  const receipt = String(receiptData || '').trim();
  if (!receipt) return '';
  try {
    return new ReceiptUtility().extractTransactionIdFromAppReceipt(receipt) || '';
  } catch (_) {
    return '';
  }
}

async function verifyPurchase({ transactionId, receiptData, expectedProductId }) {
  if (TEST_MODE) {
    const productId = expectedProductId || [...ALLOWED_PRODUCTS][0];
    assertProduct(productId, expectedProductId);
    const tx = String(transactionId || 'TEST-TRANSACTION');
    return {
      provider: 'app_store', environment: 'Sandbox', status: 'active', productId,
      transactionId: tx, originalTransactionId: `ORIGINAL-${tx}`,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      purchaseDate: new Date().toISOString(), revocationDate: null,
      verifiedAt: new Date().toISOString(),
    };
  }
  if (!configured()) throw Object.assign(new Error('APPLE_BILLING_NOT_CONFIGURED'), { statusCode: 503 });
  const tx = transactionIdFromInput(transactionId, receiptData);
  if (!tx) throw Object.assign(new Error('APPLE_TRANSACTION_ID_REQUIRED'), { statusCode: 400 });
  let lastError;
  for (const environment of environmentCandidates()) {
    try {
      const response = await client(environment).getTransactionInfo(tx);
      if (!response.signedTransactionInfo) throw new Error('APPLE_SIGNED_TRANSACTION_MISSING');
      const decoded = await (await verifier(environment)).verifyAndDecodeTransaction(response.signedTransactionInfo);
      assertProduct(String(decoded.productId || ''), expectedProductId);
      return normalizeDecoded(decoded, environment);
    } catch (error) {
      lastError = error;
    }
  }
  const wrapped = Object.assign(new Error('APPLE_TRANSACTION_VERIFICATION_FAILED'), { statusCode: 422, cause: lastError });
  throw wrapped;
}

async function refreshSubscription(anyTransactionId, expectedProductId = '') {
  if (TEST_MODE) return verifyPurchase({ transactionId: anyTransactionId, expectedProductId });
  if (!configured()) throw Object.assign(new Error('APPLE_BILLING_NOT_CONFIGURED'), { statusCode: 503 });
  let lastError;
  for (const environment of environmentCandidates()) {
    try {
      const response = await client(environment).getAllSubscriptionStatuses(String(anyTransactionId));
      const verify = await verifier(environment);
      const candidates = [];
      for (const group of response.data || []) {
        for (const item of group.lastTransactions || []) {
          if (!item.signedTransactionInfo) continue;
          const decoded = await verify.verifyAndDecodeTransaction(item.signedTransactionInfo);
          const productId = String(decoded.productId || '');
          if (!ALLOWED_PRODUCTS.has(productId)) continue;
          if (expectedProductId && productId !== expectedProductId) continue;
          candidates.push(normalizeDecoded(decoded, environment, normalizedStatus(item.status)));
        }
      }
      if (!candidates.length) throw new Error('APPLE_SUBSCRIPTION_NOT_FOUND');
      candidates.sort((a, b) => Date.parse(b.expiresAt || 0) - Date.parse(a.expiresAt || 0));
      return candidates[0];
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error('APPLE_SUBSCRIPTION_REFRESH_FAILED'), { statusCode: 502, cause: lastError });
}

async function verifyNotification(signedPayload) {
  if (!configured() || TEST_MODE) throw Object.assign(new Error('APPLE_BILLING_NOT_CONFIGURED'), { statusCode: 503 });
  let lastError;
  for (const environment of environmentCandidates()) {
    try {
      const verify = await verifier(environment);
      const decodedNotification = await verify.verifyAndDecodeNotification(String(signedPayload || ''));
      const signedTransaction = decodedNotification?.data?.signedTransactionInfo;
      if (!signedTransaction) {
        return { notificationType: decodedNotification.notificationType || '', subscription: null };
      }
      const decodedTransaction = await verify.verifyAndDecodeTransaction(signedTransaction);
      const appleStatus = decodedNotification?.data?.status;
      return {
        notificationType: decodedNotification.notificationType || '',
        subtype: decodedNotification.subtype || '',
        subscription: normalizeDecoded(decodedTransaction, environment, appleStatus ? normalizedStatus(appleStatus) : undefined),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error('APPLE_NOTIFICATION_INVALID'), { statusCode: 401, cause: lastError });
}

module.exports = {
  configured,
  verifyPurchase,
  refreshSubscription,
  verifyNotification,
  allowedProducts: ALLOWED_PRODUCTS,
};
