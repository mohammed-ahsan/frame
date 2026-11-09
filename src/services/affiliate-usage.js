'use strict';

const WEB_DAILY_GENERATION_LIMIT = 30;
const APP_DAILY_GENERATION_LIMIT = 50;

function currentAffiliateDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

async function consumeAffiliateGeneration(db, userId, { channel = 'web' } = {}, now = new Date()) {
  const day = currentAffiliateDay(now);
  const collection = channel === 'android' ? 'affiliateAppUsage' : 'affiliateUsage';
  const limit = channel === 'android' ? APP_DAILY_GENERATION_LIMIT : WEB_DAILY_GENERATION_LIMIT;
  while (true) {
    try {
      const usage = await db.collection(collection).findOneAndUpdate(
        { userId, day, used: { $lt: limit } },
        {
          $inc: { used: 1 },
          $setOnInsert: { createdAt: now },
          $set: { updatedAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (usage) return usage.used;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    const usage = await db.collection(collection).findOne({ userId, day });
    if ((usage?.used || 0) >= limit) return null;
  }
}

async function releaseAffiliateGeneration(db, userId, { channel = 'web' } = {}, now = new Date()) {
  const collection = channel === 'android' ? 'affiliateAppUsage' : 'affiliateUsage';
  await db.collection(collection).updateOne(
    { userId, day: currentAffiliateDay(now), used: { $gt: 0 } },
    { $inc: { used: -1 }, $set: { updatedAt: now } },
  );
}

module.exports = {
  APP_DAILY_GENERATION_LIMIT,
  WEB_DAILY_GENERATION_LIMIT,
  currentAffiliateDay,
  consumeAffiliateGeneration,
  releaseAffiliateGeneration,
};
