'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signSession, verifySession } = require('../src/security/session-token');

const secret = 'a-test-secret-that-is-definitely-longer-than-32-chars';

test('signed sessions round-trip and reject tampering', () => {
  const token = signSession({ userId: 'abc123', expiresAt: 2_000 }, secret);
  assert.equal(verifySession(token, secret, 1_000).userId, 'abc123');
  assert.equal(verifySession(`${token}x`, secret, 1_000), null);
});

test('expired sessions are rejected', () => {
  const token = signSession({ userId: 'abc123', expiresAt: 999 }, secret);
  assert.equal(verifySession(token, secret, 1_000), null);
});
