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
- Username-gated affiliate studio with custom prompt generation, a 30-image UTC daily limit, and review tracking
- Kotlin Android affiliate app with a separate 50-generation UTC daily allowance for enabled affiliate accounts
- Affiliate submission review and username access management in the operator dashboard; approved entries earn ৳50 each
- bKash withdrawal requests from an approved balance of at least ৳1,500

- Gemini image-to-image generation through the Interactions API using the stable `gemini-3.1-flash-image` model
- Eden AI reference-image generation through Universal AI, using `image/generation/pruna/p-image`
- Cloudflare Workers AI image-to-image proxy using SDXL and a private bearer secret

## Project layout

```text
public/                 Landing page, authenticated studio, affiliate UI, and Android APK download
android-app/            Kotlin Android WebView app and Gradle build
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

Open `http://127.0.0.1:3000/`. The approval operator uses `/dashboard.html` and the visitor signs in at `/login`. Enable a username in the dashboard's Affiliate username access panel to grant access to the affiliate studio. The username is the same username entered at ticket login.

Affiliates can generate up to 30 images per UTC day. Each approved image submission earns ৳50; bKash withdrawals can be requested once the available approved balance is at least ৳1,500. Enter an 11-digit Bangladesh bKash number; only one withdrawal request can be active at a time, and requested withdrawals are expected to be disbursed within two hours. Submissions are expected to receive dashboard feedback within about two hours.

Affiliate accounts enabled from the dashboard also receive a separate allowance of 50 Android-app generations per UTC day. When an enabled affiliate uses all 30 web generations, the affiliate page offers the Android APK. The Android app includes a native affiliate studio for photo upload, style generation, review submissions, feedback revisions, earnings, and withdrawal requests. Sign-in uses the existing Frameflow approval flow, and the server matches the resulting username against the dashboard's Affiliate username access list.

The app does not read Instagram's private app data. Users enter their username through the existing Frameflow sign-in flow; a username alone is not treated as proof of identity.

Download the current production-targeted debug APK from `/downloads/Frameflow-Affiliates.apk`. The production API defaults to `https://instagram.indexbase.online`; the development flavor defaults to the Android emulator host `http://10.0.2.2:3000`. Override either at build time with Gradle properties. To build both:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\android-app\gradlew.bat -p android-app assembleDevDebug assembleProdDebug
Copy-Item android-app\app\build\outputs\apk\prod\debug\app-prod-debug.apk public\downloads\Frameflow-Affiliates.apk
```

To use a different local API host or production domain, pass `-PframeflowDevApiUrl=http://10.0.2.2:3000` and/or `-PframeflowProdApiUrl=https://instagram.indexbase.online`. The Android client marker selects the separate app counter; the server enforces the daily allowance per signed-in, dashboard-enabled affiliate account. This is account eligibility, not Google Play Integrity verification.

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
