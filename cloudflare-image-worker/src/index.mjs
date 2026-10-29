const MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
const MAX_BASE64_LENGTH = 5_500_000;

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (!env.API_KEY || request.headers.get('Authorization') !== `Bearer ${env.API_KEY}`) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'POST' || url.pathname !== '/') return json({ error: 'Not allowed' }, 405);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'JSON body required' }, 415);

  try {
    const body = await request.json();
    const prompt = String(body.prompt || '').trim();
    const imageBase64 = String(body.imageBase64 || '').replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    if (!prompt) return json({ error: 'Prompt is required' }, 400);
    if (prompt.length > 4000) return json({ error: 'Prompt is too long' }, 400);
    if (!imageBase64) return json({ error: 'Source image is required' }, 400);
    if (imageBase64.length > MAX_BASE64_LENGTH || !/^[a-zA-Z0-9+/=]+$/.test(imageBase64)) return json({ error: 'Source image is invalid or too large' }, 413);

    const image = decodeBase64(imageBase64);
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('input_image_0', new Blob([image], { type: 'image/png' }), 'source.png');
    form.append('width', '768');
    form.append('height', '960');
    form.append('guidance', '4');
    const multipart = new Response(form);
    const result = await env.AI.run(MODEL, {
      multipart: {
        body: multipart.body,
        contentType: multipart.headers.get('content-type'),
      },
    });
    const output = decodeBase64(String(result?.image || ''));
    if (!output.length) throw new Error('Cloudflare returned an empty image.');
    return new Response(output, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return json({ error: 'Failed to generate image', details: safeMessage(error) }, 500);
  }
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeMessage(error) {
  const message = String(error?.message || error || 'Unknown error');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
