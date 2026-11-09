'use strict';

const { MongoClient, GridFSBucket } = require('mongodb');

async function connectMongo(config) {
  if (!config.MONGODB_URI) return null;
  const client = new MongoClient(config.MONGODB_URI, {
    appName: 'frameflow-saas',
    maxPoolSize: 20,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  const db = client.db(config.MONGODB_DB);
  await ensureIndexes(db);
  return { client, db, mediaBucket: new GridFSBucket(db, { bucketName: 'media' }) };
}

async function ensureIndexes(db) {
  await Promise.all([
    db.collection('users').createIndex({ ticketEnrollmentId: 1 }, { unique: true, sparse: true }),
    db.collection('users').createIndex({ referralCode: 1 }, { unique: true, sparse: true }),
    db.collection('ticketSessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('ticketSessions').createIndex({ publicId: 1 }, { unique: true }),
    db.collection('usageWindows').createIndex({ userId: 1, windowStart: 1 }, { unique: true }),
    db.collection('usageWindows').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('referrals').createIndex({ referredUserId: 1 }, { unique: true }),
    db.collection('taskSubmissions').createIndex({ userId: 1, taskId: 1 }, { unique: true }),
    db.collection('taskSubmissions').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('payoutRequests').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('payoutRequests').createIndex({ userId: 1, status: 1 }),
    db.collection('generations').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('mediaFiles').createIndex({ userId: 1, createdAt: -1 }),
  ]);
}

module.exports = { connectMongo, ensureIndexes };
