'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APP_DAILY_GENERATION_LIMIT,
  WEB_DAILY_GENERATION_LIMIT,
  currentAffiliateDay,
  consumeAffiliateGeneration,
  releaseAffiliateGeneration,
} = require('../src/services/affiliate-usage');

test('affiliate usage windows use UTC calendar days', () => {
  assert.equal(currentAffiliateDay(new Date('2026-11-09T23:59:59.000Z')), '2026-11-09');
  assert.equal(currentAffiliateDay(new Date('2026-11-10T00:00:00.000Z')), '2026-11-10');
});

test('affiliate web generations are capped at 30 and can be released', async () => {
  const usage = new Map();
  const db = {
    collection: (name) => ({
      findOneAndUpdate: async (filter, update) => {
        const key = `${name}:${filter.userId}:${filter.day}`;
        const current = usage.get(key) || { used: 0 };
        if (current.used >= filter.used.$lt) {
          const error = new Error('Duplicate key.');
          error.code = 11000;
          throw error;
        }
        current.used += update.$inc.used;
        usage.set(key, current);
        return current;
      },
      findOne: async (filter) => usage.get(`${name}:${filter.userId}:${filter.day}`) || null,
      updateOne: async (filter, update) => {
        const current = usage.get(`${name}:${filter.userId}:${filter.day}`);
        if (current && current.used > 0) current.used += update.$inc.used;
      },
    }),
  };
  const userId = 'affiliate-user';
  const now = new Date('2026-11-09T12:00:00.000Z');
  for (let count = 1; count <= WEB_DAILY_GENERATION_LIMIT; count += 1) {
    assert.equal(await consumeAffiliateGeneration(db, userId, { channel: 'web' }, now), count);
  }
  assert.equal(await consumeAffiliateGeneration(db, userId, { channel: 'web' }, now), null);
  await releaseAffiliateGeneration(db, userId, { channel: 'web' }, now);
  assert.equal(await consumeAffiliateGeneration(db, userId, { channel: 'web' }, now), WEB_DAILY_GENERATION_LIMIT);
});

test('eligible Android usage has a separate 50-generation daily allowance', async () => {
  const usage = new Map();
  const db = {
    collection: (name) => ({
      findOneAndUpdate: async (filter, update) => {
        const key = `${name}:${filter.userId}:${filter.day}`;
        const current = usage.get(key) || { used: 0 };
        if (current.used >= filter.used.$lt) {
          const error = new Error('Duplicate key.');
          error.code = 11000;
          throw error;
        }
        current.used += update.$inc.used;
        usage.set(key, current);
        return current;
      },
      findOne: async (filter) => usage.get(`${name}:${filter.userId}:${filter.day}`) || null,
      updateOne: async (filter, update) => {
        const current = usage.get(`${name}:${filter.userId}:${filter.day}`);
        if (current && current.used > 0) current.used += update.$inc.used;
      },
    }),
  };
  const userId = 'affiliate-user';
  const now = new Date('2026-11-09T12:00:00.000Z');
  for (let count = 1; count <= APP_DAILY_GENERATION_LIMIT; count += 1) {
    assert.equal(await consumeAffiliateGeneration(db, userId, { channel: 'android' }, now), count);
  }
  assert.equal(await consumeAffiliateGeneration(db, userId, { channel: 'android' }, now), null);
  assert.equal(await consumeAffiliateGeneration(db, userId, { channel: 'web' }, now), 1);
});
