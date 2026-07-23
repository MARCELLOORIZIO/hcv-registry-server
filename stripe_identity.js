'use strict';

function stripeHeaders() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    const error = new Error('KYC_NOT_CONFIGURED');
    error.statusCode = 501;
    throw error;
  }
  return { Authorization: `Bearer ${key}` };
}

async function stripeRequest(path, { method = 'GET', body } = {}) {
  const headers = stripeHeaders();
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const response = await fetch(`https://api.stripe.com${path}`, { method, headers, body });
  const text = await response.text();
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch (_) {
    decoded = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(decoded?.error?.message || `STRIPE_HTTP_${response.status}`);
    error.statusCode = 502;
    throw error;
  }
  return decoded;
}

async function createVerificationSession({ accountId, creatorName, returnUrl }) {
  const params = new URLSearchParams();
  params.append('type', 'document');
  params.append('client_reference_id', accountId);
  params.append('options[document][require_live_capture]', 'true');
  params.append('options[document][require_matching_selfie]', 'true');
  params.append('metadata[accountId]', accountId);
  params.append('metadata[creatorName]', creatorName || '');
  params.append('return_url', returnUrl);
  return stripeRequest('/v1/identity/verification_sessions', {
    method: 'POST',
    body: params.toString(),
  });
}

async function retrieveVerificationSession(sessionId) {
  return stripeRequest(`/v1/identity/verification_sessions/${encodeURIComponent(sessionId)}`);
}

async function listVerificationSessions(accountId) {
  const query = new URLSearchParams({ client_reference_id: accountId, limit: '10' });
  return stripeRequest(`/v1/identity/verification_sessions?${query}`);
}

async function retrieveVerificationReport(reportId) {
  if (!reportId) return null;
  try {
    return await stripeRequest(`/v1/identity/verification_reports/${encodeURIComponent(reportId)}`);
  } catch (_) {
    return null;
  }
}

async function normalizeSession(session) {
  const reportId = typeof session.last_verification_report === 'string'
    ? session.last_verification_report
    : session.last_verification_report?.id;
  const report = await retrieveVerificationReport(reportId);
  const reportDocument = report?.document || {};
  const verifiedOutputs = session.verified_outputs || reportDocument.verified_outputs || {};
  const firstName = verifiedOutputs.first_name || reportDocument.first_name || reportDocument.name?.first_name || '';
  const lastName = verifiedOutputs.last_name || reportDocument.last_name || reportDocument.name?.last_name || '';
  const legalName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const country = verifiedOutputs.address?.country || reportDocument.address?.country || '';
  return {
    provider: 'stripe_identity',
    sessionId: session.id,
    accountId: session.client_reference_id || session.metadata?.accountId || '',
    status: session.status || 'unknown',
    url: session.url || '',
    lastError: session.last_error || null,
    verifiedOutputs: { legalName, firstName, lastName, country },
    verified: session.status === 'verified',
  };
}

async function findLatestSessionForAccount(accountId) {
  const list = await listVerificationSessions(accountId);
  const sessions = Array.isArray(list.data) ? list.data : [];
  if (sessions.length === 0) return null;
  sessions.sort((a, b) => Number(b.created || 0) - Number(a.created || 0));
  return normalizeSession(sessions[0]);
}

module.exports = {
  createVerificationSession,
  retrieveVerificationSession,
  normalizeSession,
  findLatestSessionForAccount,
};
