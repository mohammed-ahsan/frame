'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GeminiImageProvider, buildEditPrompt, extractImage } = require('../src/providers/gemini');

test('Gemini provider sends image editing input and returns decoded bytes', async () => {
  let request;
  const provider = new GeminiImageProvider({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ output_image: { data: Buffer.from('generated').toString('base64'), mime_type: 'image/jpeg' } }), { status: 200 });
    },
  });
  const result = await provider.transform({ image: Buffer.from('source'), prompt: 'Warm editorial light', preset: { name: 'Golden Hour' } });
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.equal(request.body.input[0].type, 'image');
  assert.equal(request.body.response_format.aspect_ratio, '4:5');
  assert.equal(result.buffer.toString(), 'generated');
  assert.equal(result.provider, 'gemini');
});

test('Gemini provider retries transient failures with backoff', async () => {
  let calls = 0;
  const provider = new GeminiImageProvider({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 });
      return new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'image', data: Buffer.from('ok').toString('base64') }] }] }), { status: 200 });
    },
  });
  const result = await provider.transform({ image: Buffer.from('source'), prompt: 'Film look' });
  assert.equal(calls, 2);
  assert.equal(result.buffer.toString(), 'ok');
});

test('Gemini provider falls back to Flash Lite when primary quota is unavailable', async () => {
  const requestedModels = [];
  const provider = new GeminiImageProvider({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestedModels.push(body.model);
      if (body.model === 'gemini-3.1-flash-image') {
        return new Response(JSON.stringify({ error: { code: 'quota_exceeded', message: 'Daily quota exceeded' } }), { status: 429 });
      }
      return new Response(JSON.stringify({ output_image: { data: Buffer.from('lite').toString('base64') } }), { status: 200 });
    },
  });
  const result = await provider.transform({ image: Buffer.from('source'), prompt: 'Soft studio' });
  assert.deepEqual(requestedModels, ['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']);
  assert.equal(result.model, 'gemini-3.1-flash-lite-image');
});

test('prompt preserves the subject and disallows common generation artifacts', () => {
  const prompt = buildEditPrompt('Neon portrait', { name: 'Neon Night' });
  assert.match(prompt, /Preserve the subject identity/);
  assert.match(prompt, /Do not add text/);
});

test('image extraction supports model output steps', () => {
  assert.equal(extractImage({ steps: [{ type: 'model_output', content: [{ type: 'image', data: 'abc' }] }] }).data, 'abc');
});
