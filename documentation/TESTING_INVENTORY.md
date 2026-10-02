# SkinSense: Test Inventory

Last updated: 30 September 2026.

Lists every automated test suite, what it covers, how to run it, and which tests exist on `main` versus only on `feature/runtime-device-monitoring`.

Counts for `main` are taken from the last snapshot of the repository before the monitoring branch. If your teammate's CLIP-model work has since changed `main`, re-run the suites there and update the numbers.

## 1. Summary

| Suite | Tool | On `main` | Added on the monitoring branch | Total on branch |
|---|---|---|---|---|
| Server | Jest + Supertest | 79 | 28 | 107 |
| Client | Vitest | 62 | 7 | 69 |
| Inference | pytest | 55 | 32 | 87 |
| Dashboard | pytest | 0 | 25 | 25 |
| **All** | | **196** | **92** | **288** |

Last results on the branch: server 107/107, client 69/69, inference 87/87 (run on the developer machine), dashboard 25/25.

## 2. How to run

```powershell
cd server;    npm test                       # Jest, fully mocked (no DB, no network)
cd client;    npm test -- --run              # Vitest
cd inference; python -m pytest tests/ -v     # needs torch, fastapi, httpx
cd dashboard; python -m pytest tests/ -v     # needs pandas, streamlit
```
Guard logic without PyTorch: `cd inference; python -m pytest tests/test_quality.py --noconftest`.

## 3. Server (Jest)

Database is mocked with `jest.fn()`, rate limiters are replaced by pass-throughs (except the telemetry limiter), and the Python service is not started, so the ECONNREFUSED fallback path is exercised.

| File | Tests | Origin | Covers |
|---|---|---|---|
| `auth.test.js` | 28 | main (edited) | Register (roles, age bounds 1 to 120, duplicates, DB errors), login, logout and token blacklist, profile |
| `middleware.test.js` | 21 | main | `authenticate` (missing, wrong scheme, wrong secret, garbage, expired, revoked tokens), `requireRole` (403 vs 401), upload MIME filters for images (jpeg, png accepted; gif, pdf rejected) and audio (wav, webm, ogg accepted; image and text rejected) |
| `screening.test.js` | 30 | main | `create`, `upload-image`, `voice`, `inference` (including graceful fallback when the Python service is down), `results`, `history/list` |
| `monitoring.test.js` | 28 | branch | Telemetry endpoint (see below) |

**`monitoring.test.js` in detail**
- Success: full payload stored; response contains only `telemetry_id`, `case_id`, `created_at`; ownership query is scoped to the logged-in user; a real `0` stays `0`; missing browser fields become `NULL` and the connection becomes `unknown` (never a made-up "4g"); empty body accepted; user agent truncated to 300 characters; fractional values rounded for integer columns; upsert on `case_id`.
- Errors: 401 without token; 400 for case ids `abc`, `0`, `-3`, `1.5`, `5;DROP`; 404 when the case belongs to someone else; 400 for negative or absurd latency, non-numeric values, `NaN`, zero cores, unknown connection or device type, non-string user agent; 500 on database failure; 429 after 30 requests from one user while another user is unaffected.
- `parseTelemetry` unit tests: numeric strings, null and empty handling, rejects `Infinity`.

**Changes to existing tests on the branch (`auth.test.js`)**
- The DNS lookup used by registration is now mocked, so the suite passes offline. Before this, 11 tests failed without internet access.
- Two clinician registration tests now send age, gender and region, matching the controller, which requires them for every role.

**Expected noise:** the line `console.error ... recordTelemetry error` in the Jest output comes from the deliberate "database throws" test. It is not a failure.

## 4. Client (Vitest)

| File | Tests | Origin | Covers |
|---|---|---|---|
| `imageValidation.test.js` | 26 | main | File type and 10 MB limit, minimum 300x300 dimensions (boundary cases), `getConfidenceLevel` bands (0.8, 0.6, 0.3 boundaries), `getConfidenceColor` |
| `useScreening.test.jsx` | 21 | main | The screening hook: `createCase`, `uploadImage`, `submitVoice`, `runInference`, `getResults`, `getHistory`, `reset`, error states |
| `useVoiceRecorder.test.jsx` | 15 | main | Initial state, start and stop, clear, duration timer and auto-stop, WAV conversion fallback |
| `telemetry.test.js` | 7 | branch | Reads cores, memory, connection and JS heap when present; returns `null` when the Network Information API, `deviceMemory` or `performance.memory` are missing; keeps `rtt = 0`; rounds heap to 2 decimals; ignores non-numeric heap; includes user agent |

**Expected noise:** `act(...)` warnings and "WAV conversion failed" messages from `useVoiceRecorder.test.jsx` are printed by tests that simulate failures. They pass.

## 5. Inference (pytest)

The test environment points `MODEL_PATH` and `ASR_MODEL_PATH` at non-existent files, so the model runs with **random weights** and Whisper is absent. Response shape and error handling are tested, not prediction quality.

| File | Tests | Origin | Covers |
|---|---|---|---|
| `test_predict.py` | 26 (19 on main) | main + branch | `/health` keys, classes, ASR status, model state; `/predict` success (png, jpeg), response keys, score bounds and sum, heatmap written to disk, 400 for non-image, empty and truncated files, large 2048x2048 image |
| `test_heatmap.py` | 10 | main | Serves generated PNGs, correct content type and signature, 404s, path-traversal protection |
| `test_transcribe.py` | 9 | main | 503 contract when Whisper is not loaded, error body, empty file, odd filenames |
| `test_utils.py` | 17 | main | `load_audio_wav` (resampling, mono), `GradCAM`, `create_heatmap_overlay` |
| `test_quality.py` | 25 | branch | Skin check (light and dark tones, blue and green rejected, ratio respected); blur (flat image scores 0, texture passes, Gaussian blur lowers score, resolution-independent scoring, tiny image); entropy (uniform equals ln 7, one-hot is 0); `assess_prediction` boundaries; Git LFS pointer detection |

**Branch additions to `test_predict.py`:** `status` is `classified` or `out_of_scope`; untrained weights tagged `-UNTRAINED`; telemetry block has all profiling fields; flat image rejected as too blurry; non-skin image rejected; oversized upload returns 413; health reports `model_loaded` false and `warmed_up` true.

**Changes to test fixtures on the branch:** solid-colour images are now (correctly) rejected as blurry or non-skin, so fixtures in `conftest.py` are textured skin-tone images. Expectations allow "No Disease / Inconclusive", because random weights produce near-uniform output.

## 6. Dashboard (pytest)

| File | Tests | Covers |
|---|---|---|
| `test_metrics.py` | 22 | median, p95 and mean ignore nulls; outliers move the mean but not the median; device classes (low RAM, slow network, unknown is not counted as standard); low-resource share; dropping the first run; stage medians (voice recording is not a stage); `fmt` shows a dash for missing values and shows `0` |
| `test_app_smoke.py` | 3 | Runs the Streamlit app headlessly against a fake database, ignoring any real `server/.env` so results are the same on every machine: renders medians, never shows the old fabricated 24.8 MB default, shows the empty state, reports a missing password instead of using a default |

## 7. What is not covered yet

- **No end-to-end test** of the full flow (browser to server to inference to database).
- **No test of real model quality.** All inference tests use random weights.
- **No test of the migrations** against a real PostgreSQL instance (server tests mock the database).
- **No test of `ScreeningPage.jsx`**, including the telemetry dispatch.
- **CI is new and unproven:** a GitHub Actions workflow (`.github/workflows/ci.yml`) was added on the branch to run the four suites. Check the Actions tab after the first push and confirm all four jobs are green.
- **No load or performance tests.**
- **Guard thresholds** (blur, skin, confidence, entropy) are tested for logic, not for accuracy on real photos.

## 8. Plan: testing after the CLIP model is merged

Full regression should wait until the CLIP model lands on `main`, because it changes the inference service, response format, confidence scale and the thresholds the guards rely on.

Until then, keep the existing suites green as a safety net. After the merge:

1. Merge or rebase this branch with `main` and resolve conflicts in `inference/server.py` and `inference/tests/`.
2. Run all four suites, and fix tests that assumed MobileNet specifics (class list, model version string, random-weight behaviour).
3. Build a small labelled golden set (good, blurry, low-light, non-skin, and each condition) and recalibrate the guard thresholds on it.
4. Add the end-to-end test, and confirm the CI workflow still passes against the merged code.
5. Benchmark MobileNet against CLIP on CPU and on throttled devices, and record the results.
