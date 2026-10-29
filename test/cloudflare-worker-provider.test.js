'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { CloudflareWorkerImageProvider, buildEditPrompt } = require('../src/providers/cloudflare-worker');

test('Cloudflare provider sends a resized source image and returns binary output', async () => {
  let request;
  const provider = new CloudflareWorkerImageProvider({
    endpoint: 'https://worker.example/', token: 'test-token',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(Buffer.from('image'), { status: 200, headers: { 'content-type': 'image/png' } });
    },
  });
  const source = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#e879f9' } }).png().toBuffer();
  const output = await provider.transform({ image: source, prompt: 'Film portrait', preset: { name: '35mm Film' } });
  assert.equal(request.url, 'https://worker.example');
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  const metadata = await sharp(Buffer.from(request.body.imageBase64, 'base64')).metadata();
  assert.ok(metadata.width < 512);
  assert.ok(metadata.height < 512);
  assert.equal(output.buffer.toString(), 'image');
});

test('Cloudflare prompt preserves subject identity', () => {
  assert.match(buildEditPrompt('Soft studio', { name: 'Soft Studio' }), /Preserve the subject identity/);
});
