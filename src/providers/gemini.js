'use strict';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

class GeminiProviderError extends Error {
  constructor(message, { code = 'GEMINI_REQUEST_FAILED', status = 502, retryable = false, fallbackEligible = false } = {}) {
    super(message);
    this.name = 'GeminiProviderError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.fallbackEligible = fallbackEligible;
  }
}

class GeminiImageProvider {
  constructor({ apiKey, model = 'gemini-3.1-flash-image', fallbackModel = 'gemini-3.1-flash-lite-image', fetchImpl = globalThis.fetch }) {
    if (!apiKey) throw new Error('Gemini API key is required.');
    if (typeof fetchImpl !== 'function') throw new Error('A Fetch implementation is required.');
    this.name = 'gemini';
    this.apiKey = apiKey;
    this.model = model;
    this.fallbackModel = fallbackModel;
    this.fetch = fetchImpl;
  }

  async transform({ image, prompt, preset }) {
    if (!Buffer.isBuffer(image) || !image.length) throw new GeminiProviderError('A source image is required.', { code: 'INVALID_SOURCE_IMAGE', status: 400 });
    const requestBody = {
      model: this.model,
      input: [
        { type: 'image', mime_type: 'image/webp', data: image.toString('base64') },
        { type: 'text', text: buildEditPrompt(prompt, preset) },
      ],
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        aspect_ratio: '4:5',
        image_size: '1K',
      },
    };

    const models = [...new Set([this.model, this.fallbackModel].filter(Boolean))];
    let lastError;
    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      requestBody.model = models[modelIndex];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await this.fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(120_000),
          });
          if (!response.ok) throw await toProviderError(response);
          const payload = await response.json();
          const output = extractImage(payload);
          if (!output?.data) {
            throw new GeminiProviderError('Gemini completed without returning an image.', { code: 'GEMINI_EMPTY_IMAGE' });
          }
          return {
            buffer: Buffer.from(output.data, 'base64'),
            mimeType: output.mime_type || output.mimeType || 'image/jpeg',
            provider: this.name,
            model: models[modelIndex],
          };
        } catch (error) {
          lastError = normalizeError(error);
          if (!lastError.retryable || attempt === 2) break;
          await waitWithJitter(attempt);
        }
      }
      if (!lastError.fallbackEligible || modelIndex === models.length - 1) break;
    }
    throw lastError;
  }
}

function buildEditPrompt(stylePrompt, preset) {
  return [
    'Edit the supplied photograph into a polished, photorealistic social-media portrait.',
    `Creative direction: ${stylePrompt}.`,
    'Preserve the subject identity, facial features, body proportions, pose, and important clothing details.',
    'Improve lighting, color grade, texture, depth, and background styling to match the creative direction.',
    'Create a natural 4:5 vertical composition suitable for a premium Instagram post.',
    'Do not add text, logos, borders, watermarks, extra people, extra limbs, or distorted anatomy.',
    preset?.name ? `Preset name for internal art direction: ${preset.name}.` : '',
  ].filter(Boolean).join(' ');
}

function extractImage(payload) {
  if (payload?.output_image?.data) return payload.output_image;
  for (const step of payload?.steps || []) {
    if (step.type !== 'model_output') continue;
    for (const block of step.content || []) if (block.type === 'image' && block.data) return block;
  }
  return null;
}

async function toProviderError(response) {
  const body = await response.json().catch(() => ({}));
  const upstreamMessage = body?.error?.message;
  const upstreamCode = String(body?.error?.code || body?.error?.status || '').toLowerCase();
  const quotaExceeded = response.status === 429 && (
    upstreamCode.includes('quota_exceeded')
    || /daily quota|current quota|billing|limit\s*:\s*0|quota[^.]*exceed/i.test(upstreamMessage || '')
  );
  const retryable = (response.status === 429 && !quotaExceeded) || response.status === 408 || response.status >= 500;
  const code = quotaExceeded
    ? 'GEMINI_QUOTA_EXCEEDED'
    : response.status === 429
      ? 'GEMINI_RATE_LIMITED'
      : response.status === 401 || response.status === 403
        ? 'GEMINI_AUTH_FAILED'
        : 'GEMINI_REQUEST_FAILED';
  const publicMessage = quotaExceeded
    ? 'Gemini image quota is unavailable for this project. Check the project billing and rate limits in Google AI Studio.'
    : response.status === 429
      ? 'The image service is temporarily rate limited. Please try again shortly.'
    : response.status === 401 || response.status === 403
      ? 'Gemini authentication failed. Check the configured API key.'
      : upstreamMessage || 'Gemini could not create this image.';
  return new GeminiProviderError(publicMessage, {
    code,
    status: response.status,
    retryable,
    fallbackEligible: response.status === 429 || response.status === 503 || response.status === 404,
  });
}

function normalizeError(error) {
  if (error instanceof GeminiProviderError) return error;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return new GeminiProviderError('Gemini took too long to respond. Please try again.', { code: 'GEMINI_TIMEOUT', status: 504, retryable: true });
  }
  return new GeminiProviderError('Could not reach the Gemini image service.', { code: 'GEMINI_UNAVAILABLE', status: 502, retryable: true });
}

function waitWithJitter(attempt) {
  const delayMs = (2 ** attempt) * 1000 + Math.floor(Math.random() * 350);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

module.exports = { ENDPOINT, GeminiImageProvider, GeminiProviderError, buildEditPrompt, extractImage, toProviderError };
