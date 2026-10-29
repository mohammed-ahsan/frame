# Frameflow

Frameflow is a ticket-authenticated image styling SaaS. A user enters through the existing approval flow, uploads a photo, chooses one of 20 curated presets, and receives a mobile-friendly generated image. Hourly generation limits are enforced on the server and can increase by one per accepted referral, up to a small configured cap.

## Current status

Implemented:

- Existing ticket session and manual approval flow, followed by a signed HTTP-only app session
- Dashboard sound alerts for new sessions (enable sound once in the dashboard)
- Responsive marketing landing page and authenticated creation dashboard
- 20 preset catalog
- MongoDB indexes and repositories used by the API
- GridFS image storage with ownership checks
- Upload validation, metadata removal, and WebP resize to a maximum of 1080×1350
- Hourly quota accounting with concurrency protection
- Referral capture and one-time redemption, capped by `MAX_REFERRAL_BONUS`
- Per-user file and byte quotas, gallery serving, and deletion
- Provider-neutral image transformation boundary

- Gemini image-to-image generation through the Interactions API using the stable `gemini-3.1-flash-image` model
- Eden AI reference-image generation through Universal AI, using `image/generation/pruna/p-image`
- Cloudflare Workers AI image-to-image proxy using SDXL and a private bearer secret

## Project layout

```text
public/                 Landing page and authenticated studio UI
src/
  domain/               Presets and pure limit calculations
  infrastructure/       MongoDB and GridFS setup
  providers/            AI vendor adapters
  security/             Signed session tokens
  services/             Quota and media application services
  config.js              Validated environment configuration
  server.js              Express routes and composition root
test/                    Node test-runner unit tests
index.html               Existing ticket login UI
dashboard.html           Existing manual ticket approval UI
```

## Local setup

1. Use Node.js 22 or newer.
2. Copy `.env.example` to `.env` and fill in a newly rotated MongoDB credential, long random session secret, and operator password. Never commit `.env`.
3. Install and run:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run dev
```

Open `http://127.0.0.1:3000/`. The approval operator uses `/dashboard.html` and the visitor signs in at `/login`.

If the legacy preview is already using port 3000, run the new app on another port for that shell:

```powershell
$env:PORT='3100'
npm.cmd start
```

## Security and storage notes

- Production startup rejects a missing MongoDB URI or the development session secret.
- The approval dashboard and its decision/event endpoints require HTTP Basic operator authentication in production. Local development bypasses this prompt so the ticket flow can be tested directly.
- Uploaded bytes are not publicly addressable; every media read checks the signed user session and owner ID.
- Source and generated images are normalized to WebP, orientation-corrected, capped at 40 megapixels on decode, and resized for mobile/social use before GridFS storage.
- Referral links only grant credit after a distinct user completes ticket approval. One referred user can be credited once.
- The pasted database password should be rotated before it is placed in local environment configuration.

## Gemini configuration

Set these values only in `.env` or your deployment secret manager:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=<rotated-key>
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_FALLBACK_MODEL=gemini-3.1-flash-lite-image
```

The supplied photograph and preset prompt are sent to Gemini as one image-editing interaction. Output is requested as a 1K 4:5 JPEG, then normalized by the existing media pipeline to a maximum 1080×1350 WebP before GridFS storage. Temporary 429/503 responses use exponential backoff with jitter; project-quota failures fall back once to Flash Lite and then return an actionable billing/rate-limit message.

API behavior follows Google's [Gemini image generation and editing guide](https://ai.google.dev/gemini-api/docs/image-generation).

## Eden AI configuration

```text
AI_PROVIDER=eden
EDENAI_API_KEY=<rotated-key>
EDENAI_IMAGE_MODEL=image/generation/pruna/p-image
```

The source WebP is uploaded through Eden AI's file endpoint and passed as a reference image to Universal AI. The current model is synchronous, accepts image and text input, and keeps the vendor cost low while the application-level hourly quota controls user demand.

## AI provider contract

Add a provider in `src/providers/` that implements:

```js
async transform({ image, prompt, preset }) {
  return { buffer: outputImageBuffer, provider: 'provider-name' };
}
```

Register it in `src/providers/index.js`. The rest of the application does not need vendor-specific changes.
