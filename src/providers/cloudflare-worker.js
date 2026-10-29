'use strict';

const sharp = require('sharp');

class CloudflareWorkerError extends Error {
  constructor(message, { code = 'CLOUDFLARE_AI_FAILED', status = 502, retryable = false } = {}) {
    super(message);
    this.name = 'CloudflareWorkerError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

class CloudflareWorkerImageProvider {
  constructor({ endpoint, token, fetchImpl = globalThis.fetch }) {
    if (!endpoint || !token) throw new Error('Cloudflare AI Worker endpoint and token are required.');
    this.name = 'cloudflare-workers-ai';
    this.model = '@cf/black-forest-labs/flux-2-klein-4b';
    this.endpoint = endpoint.replace(/\/$/, '');
    this.token = token;
    this.fetch = fetchImpl;
  }

  async transform({ image, prompt, preset }) {
    if (!Buffer.isBuffer(image) || !image.length) {
      throw new CloudflareWorkerError('A source image is required.', { code: 'INVALID_SOURCE_IMAGE', status: 400 });
    }
    const aiSource = await prepareSourceImage(image);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetch(this.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: buildEditPrompt(prompt, preset), imageBase64: aiSource.toString('base64') }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw await toProviderError(response);
        const contentType = response.headers.get('content-type') || 'image/png';
        if (!contentType.startsWith('image/')) throw new CloudflareWorkerError('Cloudflare returned an invalid image response.', { code: 'CLOUDFLARE_INVALID_IMAGE' });
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new CloudflareWorkerError('Cloudflare returned an invalid or oversized image.', { code: 'CLOUDFLARE_INVALID_IMAGE' });
        return { buffer, mimeType: contentType, provider: this.name, model: this.model };
      } catch (error) {
        lastError = normalizeError(error);
        if (!lastError.retryable || attempt === 2) break;
        await waitWithJitter(attempt);
      }
    }
    throw lastError;
  }
}

async function prepareSourceImage(image) {
  try {
    return await sharp(image, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 511, height: 511, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 8 })
      .toBuffer();
  } catch {
    throw new CloudflareWorkerError('The source image could not be prepared for Cloudflare.', { code: 'INVALID_SOURCE_IMAGE', status: 400 });
  }
}

function buildEditPrompt(stylePrompt, preset) {
  return [
    'Premium social-media portrait based on the supplied photograph.',
    `Creative direction: ${stylePrompt}.`,
    'Preserve the subject identity, facial features, body proportions, pose, and recognizable clothing.',
    'Render the chosen visual medium faithfully with polished lighting and vertical 4:5 framing.',
    'No text, logo, border, watermark, extra person, extra limb, deformed hands, or distorted face.',
    preset?.name ? `Art-direction preset: ${preset.name}.` : '',
  ].filter(Boolean).join(' ');
}

async function toProviderError(response) {
  const payload = await response.json().catch(() => ({}));
  const detail = payload.details || payload.error || 'Cloudflare Workers AI could not create this image.';
  const code = response.status === 401 || response.status === 403
    ? 'CLOUDFLARE_AUTH_FAILED'
    : response.status === 429
      ? 'CLOUDFLARE_DAILY_LIMIT'
      : 'CLOUDFLARE_AI_FAILED';
  const message = code === 'CLOUDFLARE_AUTH_FAILED'
    ? 'Cloudflare image worker authentication failed.'
    : code === 'CLOUDFLARE_DAILY_LIMIT'
      ? 'Cloudflare Workers AI free daily allocation is exhausted. Try again after the daily reset.'
      : String(detail).slice(0, 300);
  return new CloudflareWorkerError(message, { code, status: response.status, retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
}

function normalizeError(error) {
  if (error instanceof CloudflareWorkerError) return error;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new CloudflareWorkerError('Cloudflare Workers AI timed out.', { code: 'CLOUDFLARE_TIMEOUT', status: 504, retryable: true });
  return new CloudflareWorkerError('Could not reach the Cloudflare image worker.', { code: 'CLOUDFLARE_UNAVAILABLE', retryable: true });
}

function waitWithJitter(attempt) {
  return new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 1000 + Math.floor(Math.random() * 350)));
}

module.exports = { CloudflareWorkerError, CloudflareWorkerImageProvider, buildEditPrompt, prepareSourceImage };
