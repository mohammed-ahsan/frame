'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateLimits, currentWindow, quotaSnapshot } = require('../src/domain/limits');

test('referrals raise the hourly limit only up to the configured cap', () => {
  assert.deepEqual(calculateLimits({ baseHourlyLimit: 6, maxReferralBonus: 4, acceptedReferralCount: 20 }), {
    baseHourlyLimit: 6,
    referralBonus: 4,
    hourlyLimit: 10,
  });
});

test('hourly windows align to the top of the UTC hour', () => {
  const window = currentWindow(new Date('2026-10-29T14:37:12.000Z'));
  assert.equal(window.start.toISOString(), '2026-10-29T14:00:00.000Z');
  assert.equal(window.end.toISOString(), '2026-10-29T15:00:00.000Z');
});

test('quota remaining never becomes negative', () => {
  const snapshot = quotaSnapshot({
    used: 12,
    limits: { baseHourlyLimit: 6, referralBonus: 2, hourlyLimit: 8 },
    now: new Date('2026-10-29T14:37:12.000Z'),
  });
  assert.equal(snapshot.remaining, 0);
});
