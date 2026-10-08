# End-to-end tests (Playwright)

These tests drive the real PWA in a phone-sized browser against the real backend: on-device screening, the "not a skin lesion" rejection, offline mode with sync, and Urdu Whisper fed through the app's own recorder.

## Run

1. Start the stack, either with `start.cmd` from the launcher folder or with `cd deploy && docker compose up -d --build`.
2. Run the tests:
   ```
   cd e2e
   npm install
   npm test              # fast suite, about 2 minutes
   npm run test:whisper  # the @slow Whisper test (downloads the 330 MB model on a cold cache)
   npm run test:all      # everything
   ```

Playwright builds `client/` and serves it on `http://localhost:4173`, with `/api` proxied to `https://localhost` (`E2E_API_URL`). `http://localhost` counts as a secure context, so the service worker and offline mode work. Caddy's self-signed `https://localhost` would block them.

The tests use the Edge already installed on Windows (`E2E_CHANNEL=msedge`). To use Playwright's own Chromium instead, set `E2E_CHANNEL=` (empty) and run `npx playwright install chromium`. On failure, traces and screenshots go to `test-results/`; open the report with `npm run report`.

## Test data

| What | Where | If missing |
|---|---|---|
| Non-lesion photo | `fixtures/non_lesion_photo.jpg` (in git): Golden Gate Bridge at sunset by Chris Brignola, Unsplash License, https://unsplash.com/photos/n7n-nkadHRM. 93 % of its pixels pass the skin-colour check, so only the not-a-lesion output stops it | — |
| Lesion photo | `E2E_LESION_IMAGE`, default `inference/test_images/positive/Vitiligo/` (local only; dataset licences keep it out of git) | Those tests are skipped |
| Urdu speech | `E2E_AUDIO`, default `data/raw/asr/symptoms_tts/clean/s00.wav` (16 kHz WAV) | Whisper test skipped |
| Test account | `E2E_USERNAME` / `E2E_PASSWORD`, defaults in `tests/helpers.js`. It is created on first use and reused, because registration is limited to 3 per hour per IP | — |

## Bugs these tests caught

- **Phone uploads failed (8 Oct 2026).** The on-device model's version string (51 characters) did not fit `predictions.model_version VARCHAR(50)`. Every phone screening stayed stuck on the device and the server returned 500. The server unit tests mock the database, so they could not see it.
- **First offline screening failed (5 Oct 2026).** ONNX Runtime's loader was not cached until first use, so it is now precached by the service worker.
