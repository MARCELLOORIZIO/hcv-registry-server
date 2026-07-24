'use strict';

const crypto = require('crypto');

function parseStripeSignature(headerValue) {
  const result = { t: null, v1: [] };
  for (const part of String(headerValue || '').split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't') result.t = value;
    if (key === 'v1') result.v1.push(value);
  }
  return result;
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const error = new Error('STRIPE_WEBHOOK_SECRET_MISSING');
    error.statusCode = 501;
    throw error;
  }
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.t || parsed.v1.length === 0) {
    const error = new Error('STRIPE_SIGNATURE_MISSING');
    error.statusCode = 400;
    throw error;
  }
  const timestamp = Number(parsed.t);
  const tolerance = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS || 300);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > tolerance) {
    const error = new Error('STRIPE_SIGNATURE_TIMESTAMP_INVALID');
    error.statusCode = 400;
    throw error;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parsed.t}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const valid = parsed.v1.some((candidate) => {
    try {
      const actualBuffer = Buffer.from(candidate, 'hex');
      return actualBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
    } catch (_) {
      return false;
    }
  });
  if (!valid) {
    const error = new Error('STRIPE_SIGNATURE_INVALID');
    error.statusCode = 400;
    throw error;
  }
  return JSON.parse(rawBody);
}

module.exports = { verifyStripeWebhook };
