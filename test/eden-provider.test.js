'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EdenImageProvider, buildEditPrompt, extractItem } = require('../src/providers/eden');

test('Eden provider uploads a reference and downloads the generated image', async () => {
  const calls = [];
  const provider = new EdenImageProvider({
    apiKey: 'test-key',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/v3/upload')) return new Response(JSON.stringify({ file_id: 'file_123' }), { status: 200 });
      if (url.endsWith('/v3/universal-ai')) {
        const body = JSON.parse(options.body);
        assert.deepEqual(body.input.reference_images, ['file_123']);
        assert.equal(body.input.resolution, '1024x1280');
        return new Response(JSON.stringify({ output: { items: [{ image_url: 'https://cdn.example/result.jpg' }] } }), { status: 200 });
      }
      return new Response(Buffer.from('generated'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    },
  });
  const result = await provider.transform({ image: Buffer.from('source'), prompt: 'Golden light', preset: { name: 'Golden Hour' } });
  assert.equal(calls.length, 3);
  assert.equal(result.buffer.toString(), 'generated');
  assert.equal(result.provider, 'eden');
});

test('Eden item extraction supports inline base64 output', () => {
  assert.equal(extractItem({ items: [{ b64_json: 'abc' }] }).data, 'abc');
});

test('Eden edit prompt explicitly preserves the subject', () => {
  assert.match(buildEditPrompt('Editorial flash', { name: 'Editorial Flash' }), /Preserve identity/);
});
