'use strict';

const path = require('node:path');
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1).optional(),
  MONGODB_DB: z.string().min(1).default('frameflow'),
  SESSION_SECRET: z.string().min(32).default('development-only-session-secret-change-me'),
  REFERRAL_SECRET: z.string().min(32).default('development-only-referral-secret-change-me'),
  OPERATOR_PASSWORD: z.string().min(16).optional(),
  AI_PROVIDER: z.string().default('disabled'),
  AI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-3.1-flash-lite-image'),
  EDENAI_API_KEY: z.string().optional(),
  EDENAI_IMAGE_MODEL: z.string().default('image/generation/pruna/p-image'),
  CLOUDFLARE_AI_WORKER_URL: z.string().url().optional(),
  CLOUDFLARE_AI_WORKER_TOKEN: z.string().min(24).optional(),
  BASE_URL: z.string().url().default('http://127.0.0.1:3000'),
  HOURLY_GENERATION_LIMIT: z.coerce.number().int().min(1).max(100).default(6),
  MAX_REFERRAL_BONUS: z.coerce.number().int().min(0).max(20).default(4),
  MAX_FILES_PER_USER: z.coerce.number().int().min(1).max(500).default(40),
  MAX_STORAGE_MB_PER_USER: z.coerce.number().int().min(1).max(2048).default(100),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(12),
});

function loadConfig(overrides = process.env) {
  const env = envSchema.parse(overrides);
  if (env.NODE_ENV === 'production') {
    if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required in production.');
    if (env.SESSION_SECRET.startsWith('development-only-')) throw new Error('A secure SESSION_SECRET is required in production.');
    if (!env.OPERATOR_PASSWORD) throw new Error('OPERATOR_PASSWORD is required in production.');
    if (env.AI_PROVIDER === 'gemini' && !(env.GEMINI_API_KEY || env.AI_API_KEY)) {
      throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini.');
    }
    if (env.AI_PROVIDER === 'eden' && !env.EDENAI_API_KEY) {
      throw new Error('EDENAI_API_KEY is required when AI_PROVIDER=eden.');
    }
    if (env.AI_PROVIDER === 'cloudflare-worker' && !(env.CLOUDFLARE_AI_WORKER_URL && env.CLOUDFLARE_AI_WORKER_TOKEN)) {
      throw new Error('CLOUDFLARE_AI_WORKER_URL and CLOUDFLARE_AI_WORKER_TOKEN are required when AI_PROVIDER=cloudflare-worker.');
    }
  }
  return Object.freeze({
    ...env,
    rootDir: path.resolve(__dirname, '..'),
    maxStorageBytes: env.MAX_STORAGE_MB_PER_USER * 1024 * 1024,
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    isProduction: env.NODE_ENV === 'production',
  });
}

module.exports = { loadConfig };
