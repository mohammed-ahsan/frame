'use strict';

const UPLOAD_ENDPOINT = 'https://api.edenai.run/v3/upload';
const GENERATE_ENDPOINT = 'https://api.edenai.run/v3/universal-ai';

class EdenProviderError extends Error {
  constructor(message, { code = 'EDEN_REQUEST_FAILED', status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'EdenProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class EdenImageProvider {
  constructor({ apiKey, model = 'image/generation/pruna/p-image', fetchImpl = globalThis.fetch }) {
    if (!apiKey) throw new Error('Eden AI API key is required.');
    if (typeof fetchImpl !== 'function') throw new Error('A Fetch implementation is required.');
    this.name = 'eden';
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl;
  }

  async transform({ image, prompt, preset }) {
    if (!Buffer.isBuffer(image) || !image.length) {
      throw new EdenProviderError('A source image is required.', { code: 'INVALID_SOURCE_IMAGE', status: 400 });
    }
    const fileId = await this.upload(image);
    const payload = await this.requestJson(GENERATE_ENDPOINT, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        model: this.model,
        input: {
          text: buildEditPrompt(prompt, preset),
          resolution: '1024x1280',
          num_images: 1,
          reference_images: [fileId],
        },
      }),
    });
    const item = extractItem(payload);
    if (!item) {
      if (isPending(payload)) throw new EdenProviderError('Eden AI returned an asynchronous job for a synchronous model.', { code: 'EDEN_ASYNC_RESPONSE' });
      throw new EdenProviderError(extractMessage(payload) || 'Eden AI completed without returning an image.', { code: 'EDEN_EMPTY_IMAGE' });
    }
    const buffer = item.data
      ? Buffer.from(stripDataUrl(item.data), 'base64')
      : await this.download(item.url);
    return { buffer, mimeType: item.mimeType || 'image/jpeg', provider: this.name, model: this.model };
  }

  async upload(image) {
    const form = new FormData();
    form.append('file', new Blob([image], { type: 'image/webp' }), 'source.webp');
    const payload = await this.requestJson(UPLOAD_ENDPOINT, {
      method: 'POST', headers: this.headers(false), body: form,
    });
    const fileId = payload.file_id || payload.id || payload.data?.file_id;
    if (!fileId) throw new EdenProviderError('Eden AI did not accept the source image.', { code: 'EDEN_UPLOAD_FAILED' });
    return fileId;
  }

  async download(url) {
    if (!/^https:\/\//i.test(String(url || ''))) throw new EdenProviderError('Eden AI returned an invalid image URL.', { code: 'EDEN_INVALID_IMAGE_URL' });
    const response = await this.fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new EdenProviderError('Could not download the generated image.', { code: 'EDEN_IMAGE_DOWNLOAD_FAILED', status: response.status, retryable: response.status >= 500 });
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 25 * 1024 * 1024) throw new EdenProviderError('Generated image is too large.', { code: 'EDEN_IMAGE_TOO_LARGE' });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new EdenProviderError('Generated image is invalid or too large.', { code: 'EDEN_INVALID_IMAGE' });
    return buffer;
  }

  async requestJson(url, options) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw await toProviderError(response);
        const payload = await response.json();
        if (payload.status === 'failed' || payload.error) throw fromPayload(payload);
        return payload;
      } catch (error) {
        lastError = normalizeError(error);
        if (!lastError.retryable || attempt === 2) break;
        await waitWithJitter(attempt);
      }
    }
    throw lastError;
  }

  headers(json) {
    return { Authorization: `Bearer ${this.apiKey}`, ...(json ? { 'Content-Type': 'application/json' } : {}) };
  }
}

function buildEditPrompt(stylePrompt, preset) {
  return [
    'Use the supplied reference photograph as the subject and composition reference.',
    `Restyle it as a polished photorealistic social-media portrait. Creative direction: ${stylePrompt}.`,
    'Preserve identity, facial features, body proportions, pose, and important clothing details.',
    'Use a natural vertical 4:5 composition. Do not add text, logos, borders, watermarks, extra people, extra limbs, or distorted anatomy.',
    preset?.name ? `Art-direction preset: ${preset.name}.` : '',
  ].filter(Boolean).join(' ');
}

function extractItem(payload) {
  const items = payload?.output?.items || payload?.items || payload?.data?.items || [];
  const item = items[0];
  if (!item) return null;
  const url = item.image_url || item.url || item.image?.url || item.file_url;
  const data = item.b64_json || item.base64 || item.image?.base64 || item.data;
  return url || data ? { url, data, mimeType: item.mime_type || item.content_type } : null;
}

function extractMessage(payload) {
  return payload?.error?.message || payload?.message || payload?.detail || null;
}

function isPending(payload) {
  return ['pending', 'processing', 'running'].includes(String(payload?.status || '').toLowerCase());
}

function stripDataUrl(value) {
  return String(value).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
}

async function toProviderError(response) {
  const payload = await response.json().catch(() => ({}));
  return fromPayload(payload, response.status);
}

function fromPayload(payload, status = 502) {
  const message = extractMessage(payload) || 'Eden AI could not create this image.';
  const lowered = message.toLowerCase();
  const code = status === 401 || status === 403
    ? 'EDEN_AUTH_FAILED'
    : status === 402 || lowered.includes('credit') || lowered.includes('balance')
      ? 'EDEN_CREDITS_REQUIRED'
      : status === 429
        ? 'EDEN_RATE_LIMITED'
        : 'EDEN_REQUEST_FAILED';
  const publicMessage = code === 'EDEN_AUTH_FAILED'
    ? 'Eden AI authentication failed. Check the configured API key.'
    : code === 'EDEN_CREDITS_REQUIRED'
      ? 'Eden AI credits are unavailable. Add credits in the Eden AI dashboard.'
      : code === 'EDEN_RATE_LIMITED'
        ? 'Eden AI is temporarily rate limited. Please try again shortly.'
        : message;
  return new EdenProviderError(publicMessage, { code, status, retryable: status === 408 || status === 429 || status >= 500 });
}

function normalizeError(error) {
  if (error instanceof EdenProviderError) return error;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new EdenProviderError('Eden AI took too long to respond.', { code: 'EDEN_TIMEOUT', status: 504, retryable: true });
  return new EdenProviderError('Could not reach Eden AI.', { code: 'EDEN_UNAVAILABLE', retryable: true });
}

function waitWithJitter(attempt) {
  return new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 1000 + Math.floor(Math.random() * 350)));
}

module.exports = { EdenImageProvider, EdenProviderError, buildEditPrompt, extractItem };
