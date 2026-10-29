'use strict';

const crypto = require('node:crypto');

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(payload, secret) {
  const body = encode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySession(token, secret, now = Date.now()) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.userId || !payload.expiresAt || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { signSession, verifySession };
