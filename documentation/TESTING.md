# SkinSense — Test Suite Documentation

**188 tests across three services · all passing**

---

## Quick Start

Open three separate terminals (one per service) and run:

```bash
# Terminal 1 — Express backend (Node.js)
cd server
npm test

# Terminal 2 — React frontend
cd client
npm test

# Terminal 3 — Python inference service
cd inference
python -m pytest tests/ -v
```

---

## Coverage Reports (HTML)

These commands generate a browseable HTML report in the listed output folder.

```bash
# Server  → server/coverage/lcov-report/index.html
cd server && npm run test:coverage

# Client  → client/coverage/index.html
cd client && npm run test:coverage

# Python  → inference/htmlcov/index.html
cd inference && python -m pytest tests/ --cov=server --cov-report=html
```

Open the HTML file in a browser to see line-by-line coverage.

---

## Test Structure

```
server/
  tests/
    setup.js              ← sets JWT_SECRET, UPLOAD_DIR env vars before app loads
    auth.test.js          ← 30 tests  — register, login, logout, profile
    screening.test.js     ← 27 tests  — full screening pipeline endpoints
    middleware.test.js    ← 17 tests  — authenticate, requireRole, multer MIME filters

client/
  src/__tests__/
    setup.js              ← jsdom polyfills + MediaRecorder / AudioContext mocks
    useScreening.test.jsx ← 21 tests  — hook state management for all 6 API calls
    useVoiceRecorder.test.jsx ← 15 tests — mic access, recording, WAV conversion, timer
    imageValidation.test.js   ← 23 tests — file validation, dimensions, confidence helpers

inference/
  tests/
    conftest.py           ← shared fixtures (TestClient, PNG/JPEG/WAV bytes)
    test_predict.py       ← 19 tests  — /health + /predict endpoints
    test_transcribe.py    ←  9 tests  — /transcribe (ASR model not loaded → 503)
    test_heatmap.py       ← 10 tests  — /heatmaps/{filename} + path-traversal security
    test_utils.py         ← 17 tests  — load_audio_wav, GradCAM, create_heatmap_overlay
```

---

## What Each Suite Tests

### Server (Jest + Supertest) — 74 tests

| Test file | Endpoint / Module | Key scenarios |
|---|---|---|
| `auth.test.js` | `POST /api/auth/register` | Patient, clinician, minimal fields, duplicate → 409, DB error → 500 |
| | `POST /api/auth/login` | Valid creds, wrong username → 401, wrong password → 401, identical error message (no field leakage) |
| | `POST /api/auth/logout` | Blacklists token; re-use of same token rejected with "revoked" |
| | `GET /api/auth/profile` | Patient profile, clinician profile, null profile, expired token, tampered token |
| `screening.test.js` | `POST /api/screening/create` | Creates case, no auth → 401 |
| | `POST /:caseId/upload-image` | JPEG ✓, PNG ✓, PDF → 500, no file → 400 |
| | `POST /:caseId/voice` | ASR fallback when Python unreachable, Chrome `audio/webm;codecs=opus` accepted, no file → 400 |
| | `POST /:caseId/inference` | Mock prediction fallback when image path missing, no image linked → 400 |
| | `GET /:caseId/results` | With/without heatmap URL, symptoms joined, not found → 404 |
| | `GET /history/list` | Returns array, empty array, DB error → 500 |
| `middleware.test.js` | `authenticate` | Missing header, wrong scheme, wrong secret, garbage token, expired, blacklisted |
| | `requireRole` | Clinician token on patient route → 403, patient on clinician route → 403 |
| | `imageUpload` | JPEG ✓, PNG ✓, GIF ✗, PDF ✗ |
| | `audioUpload` | WAV ✓, `audio/webm;codecs=opus` ✓, OGG ✓, image/png ✗ |

### Client (Vitest + React Testing Library) — 59 tests

| Test file | Hook / Utility | Key scenarios |
|---|---|---|
| `useScreening.test.jsx` | `createCase` | Sets caseId, clears error on retry, loading state on/off |
| | `uploadImage` | Posts FormData, correct endpoint |
| | `submitVoice` | `.wav`/`.webm`/`.ogg`/`.mp4` extension selection, null blob (voice skipped) |
| | `runInference` | Returns prediction data |
| | `getResults` | Stores results in state |
| | `getHistory` | GET history endpoint |
| | `reset` | Clears caseId, results, error |
| `useVoiceRecorder.test.jsx` | `startRecording` | Mic granted → isRecording=true, mic denied → error message |
| | `stopRecording` | Sets isRecording=false, produces Blob, no-op when idle |
| | `clearRecording` | Resets blob and duration |
| | Duration timer | Increments each second, auto-stops at maxDuration, stops after stopRecording |
| | WAV fallback | Falls back to raw blob when AudioContext.decodeAudioData rejects |
| `imageValidation.test.js` | `validateImageFile` | JPEG ✓, PNG ✓, GIF ✗, >10 MB ✗, both errors at once |
| | `validateImageDimensions` | 400×400 ✓, 300×300 ✓ (boundary), 200×150 ✗ with dimensions in message, onerror path |
| | `getConfidenceLevel` | ≥0.8 → high, ≥0.6 → medium, <0.6 → low, exact boundaries |
| | `getConfidenceColor` | Green/amber/red with boundary checks |

### Python (pytest + FastAPI TestClient) — 55 tests

| Test file | Endpoint / Function | Key scenarios |
|---|---|---|
| `test_predict.py` | `GET /health` | 200, all 7 class names present, ASR "not loaded" when model absent |
| | `POST /predict` | PNG ✓, JPEG ✓, response shape, confidence ∈ [0,1], all_scores sum ≈ 1.0, heatmap written to disk, non-image → 400, empty → 400, large 2048×2048 image resized |
| `test_transcribe.py` | `POST /transcribe` | 503 when Whisper not loaded (WAV, WebM, MP4), empty file → 400/503, response is JSON |
| `test_heatmap.py` | `GET /heatmaps/{filename}` | 200 with PNG signature, 404 for missing file, **path traversal `../../../etc/passwd` blocked**, `%2F` encoded path blocked |
| `test_utils.py` | `load_audio_wav` | Returns float32 1-D array, silence = zeros, file-not-found raises |
| | `GradCAM.generate` | Output is 2-D, values ∈ [0,1], class_idx in valid range, explicit class_idx respected |
| | `create_heatmap_overlay` | uint8 array, shape = IMG_SIZE×IMG_SIZE×3, all-zero cam, all-one cam |

---

## How Mocking Works

### Server tests
- **Database**: `jest.mock('../src/models/db')` replaces `pg.Pool.query` with `jest.fn()`. Each test chains `.mockResolvedValueOnce(...)` calls to simulate the exact DB rows the controller expects.
- **Rate limiters**: Bypassed with passthrough middleware so tests can hit the same endpoint multiple times without triggering 429.
- **bcryptjs**: Mocked to return instantly (avoids the real 12-round hash costing ~300 ms per test).
- **Python inference service**: Not mocked. The real node-fetch fails with ECONNREFUSED → the controller's catch block triggers graceful fallback (ASR → null transcript, inference → mock prediction). This is intentional: it tests the resilience path.

### Client tests
- **`api` (Axios instance)**: `vi.mock('../utils/api')` replaces `.post`/`.get` with `vi.fn()`.
- **Browser APIs**: `MediaRecorder`, `AudioContext`, `OfflineAudioContext` are replaced with lightweight classes in `setup.js`. `Blob.arrayBuffer` is polyfilled for jsdom.
- **Fake timers**: Used only in the Duration timer describe block, and only for `setInterval`/`clearInterval`/`Date` — **not** `setTimeout`, so React's internal scheduler keeps working.

### Python tests
- **Model weights**: `MODEL_PATH` is set to a non-existent path before `server.py` imports, so the model loads with **random weights**. The API shape, status codes, and data types are all verified without needing the real 50 MB weights file.
- **ASR model**: `ASR_MODEL_PATH` points to a non-existent directory → `asr_pipe = None` → `/transcribe` returns 503. All transcribe tests exercise this contract.
- **Heatmap dir**: Points to a real `tempfile.mkdtemp()` directory so the `/predict` endpoint can actually write PNG files and the `/heatmaps` tests can read them back.

---

## Running a Single Test File

```bash
# Server — one file
cd server && npx jest tests/auth.test.js --verbose

# Client — one file
cd client && npx vitest run src/__tests__/imageValidation.test.js

# Python — one file
cd inference && python -m pytest tests/test_predict.py -v

# Python — one test class
cd inference && python -m pytest tests/test_utils.py::TestGradCAM -v

# Python — one test
cd inference && python -m pytest tests/test_heatmap.py::TestHeatmapEndpoint::test_security_path_traversal_attempt_returns_404 -v
```

---

## Test Count Summary

| Service | Framework | Tests | Files |
|---|---|---|---|
| Express backend | Jest 29 + Supertest | 74 | 3 |
| React frontend | Vitest 3 + RTL | 59 | 3 |
| Python inference | pytest 9 + FastAPI TestClient | 55 | 4 |
| **Total** | | **188** | **10** |
