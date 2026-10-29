'use strict';

const { GeminiImageProvider } = require('./gemini');
const { EdenImageProvider } = require('./eden');
const { CloudflareWorkerImageProvider } = require('./cloudflare-worker');

class DisabledImageProvider {
  constructor(providerName = 'disabled') {
    this.name = providerName;
  }

  async transform() {
    const error = new Error('Image generation is not configured. Add a provider API key to the environment.');
    error.code = 'PROVIDER_NOT_CONFIGURED';
    throw error;
  }
}

function createImageProvider(config, options = {}) {
  if (config.AI_PROVIDER === 'cloudflare-worker') {
    if (!(config.CLOUDFLARE_AI_WORKER_URL && config.CLOUDFLARE_AI_WORKER_TOKEN)) return new DisabledImageProvider('cloudflare-worker');
    return new CloudflareWorkerImageProvider({
      endpoint: config.CLOUDFLARE_AI_WORKER_URL,
      token: config.CLOUDFLARE_AI_WORKER_TOKEN,
      fetchImpl: options.fetchImpl,
    });
  }
  if (config.AI_PROVIDER === 'eden') {
    if (!config.EDENAI_API_KEY) return new DisabledImageProvider('eden');
    return new EdenImageProvider({
      apiKey: config.EDENAI_API_KEY,
      model: config.EDENAI_IMAGE_MODEL,
      fetchImpl: options.fetchImpl,
    });
  }
  if (config.AI_PROVIDER === 'gemini') {
    const apiKey = config.GEMINI_API_KEY || config.AI_API_KEY;
    if (!apiKey) return new DisabledImageProvider('gemini');
    return new GeminiImageProvider({
      apiKey,
      model: config.GEMINI_IMAGE_MODEL,
      fallbackModel: config.GEMINI_FALLBACK_MODEL,
      fetchImpl: options.fetchImpl,
    });
  }
  return new DisabledImageProvider(config.AI_PROVIDER);
}

module.exports = { DisabledImageProvider, createImageProvider };
