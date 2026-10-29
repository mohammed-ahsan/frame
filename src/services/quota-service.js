'use strict';

const { calculateLimits, currentWindow, quotaSnapshot } = require('../domain/limits');

class QuotaExceededError extends Error {
  constructor(snapshot) {
    super(`Hourly generation limit reached. Try again after ${snapshot.resetsAt.toISOString()}.`);
    this.name = 'QuotaExceededError';
    this.code = 'HOURLY_LIMIT_REACHED';
    this.snapshot = snapshot;
  }
}

class QuotaService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  async getSnapshot(userId, now = new Date()) {
    const [acceptedReferralCount, usage] = await Promise.all([
      this.db.collection('referrals').countDocuments({ referrerUserId: userId, status: 'accepted' }),
      this.db.collection('usageWindows').findOne({ userId, windowStart: currentWindow(now).start }),
    ]);
    const limits = calculateLimits({
      baseHourlyLimit: this.config.HOURLY_GENERATION_LIMIT,
      maxReferralBonus: this.config.MAX_REFERRAL_BONUS,
      acceptedReferralCount,
    });
    return quotaSnapshot({ used: usage?.used || 0, limits, now });
  }

  async consume(userId, now = new Date()) {
    const snapshot = await this.getSnapshot(userId, now);
    if (snapshot.remaining <= 0) throw new QuotaExceededError(snapshot);
    const window = currentWindow(now);
    let result;
    try {
      result = await this.db.collection('usageWindows').findOneAndUpdate(
        { userId, windowStart: window.start, used: { $lt: snapshot.hourlyLimit } },
        {
          $inc: { used: 1 },
          $setOnInsert: { createdAt: now, expiresAt: new Date(window.end.getTime() + 24 * 60 * 60 * 1000) },
          $set: { updatedAt: now },
        },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if (error.code === 11000) throw new QuotaExceededError(await this.getSnapshot(userId, now));
      throw error;
    }
    if (!result) throw new QuotaExceededError(await this.getSnapshot(userId, now));
    return quotaSnapshot({ used: result.used, limits: snapshot, now });
  }

  async release(userId, now = new Date()) {
    const window = currentWindow(now);
    await this.db.collection('usageWindows').updateOne(
      { userId, windowStart: window.start, used: { $gt: 0 } },
      { $inc: { used: -1 }, $set: { updatedAt: now } },
    );
  }
}

module.exports = { QuotaExceededError, QuotaService };
