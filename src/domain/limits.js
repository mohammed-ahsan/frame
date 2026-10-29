'use strict';

const HOUR_MS = 60 * 60 * 1000;

function calculateLimits({ baseHourlyLimit, maxReferralBonus, acceptedReferralCount }) {
  const referralBonus = Math.min(
    Math.max(0, Number(acceptedReferralCount) || 0),
    Math.max(0, Number(maxReferralBonus) || 0),
  );
  return {
    baseHourlyLimit,
    referralBonus,
    hourlyLimit: baseHourlyLimit + referralBonus,
  };
}

function currentWindow(now = new Date()) {
  const start = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  return { start, end: new Date(start.getTime() + HOUR_MS) };
}

function quotaSnapshot({ used, limits, now = new Date() }) {
  const window = currentWindow(now);
  return {
    ...limits,
    used: Math.max(0, used),
    remaining: Math.max(0, limits.hourlyLimit - used),
    resetsAt: window.end,
  };
}

module.exports = { calculateLimits, currentWindow, quotaSnapshot };
