import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../cloudflare-image-worker/src/index.mjs';

test('worker rejects requests without its shared secret', async () => {
  const response = await handleRequest(new Request('https://worker.example/', { method: 'POST' }), { API_KEY: 'secret', AI: {} });
  assert.equal(response.status, 401);
});

test('worker sends img2img parameters to the AI binding', async () => {
  let invocation;
  const env = {
    API_KEY: 'secret',
    AI: { run: async (model, input) => { invocation = { model, input }; return { image: Buffer.from([1, 2, 3]).toString('base64') }; } },
  };
  const request = new Request('https://worker.example/', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Editorial portrait', imageBase64: Buffer.from('source').toString('base64') }),
  });
  const response = await handleRequest(request, env);
  assert.equal(response.status, 200);
  assert.equal(invocation.model, '@cf/black-forest-labs/flux-2-klein-4b');
  assert.ok(invocation.input.multipart.body);
  assert.match(invocation.input.multipart.contentType, /^multipart\/form-data; boundary=/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
});
