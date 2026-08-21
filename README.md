# SkinSense

AI-powered dermatological screening system for rural/low-resource healthcare in Pakistan. Patients photograph a skin condition and describe symptoms by voice (in Urdu or English); the system returns a differential diagnosis, Grad-CAM heatmap, and nearby clinic referrals.

---

## Architecture

```
Browser (React 5173) → Express API (5000) → Python Inference Service (5001)
                                                      │
                                               ┌──────┴──────┐
                                               │             │
                                    MobileNetV3-Large    Whisper ASR
                                    + Grad-CAM           (Urdu, offline)
```

Three processes must be running simultaneously for the full system to work:

| Terminal | Service | Port |
|----------|---------|------|
| 1 | Python inference service | 5001 |
| 2 | Express backend | 5000 |
| 3 | React frontend (Vite) | 5173 |

---

## Prerequisites

- Node.js v18+
- Python 3.11+
- PostgreSQL (running locally)
- **ffmpeg** — required for decoding WebM audio from the browser microphone
  - Windows: `winget install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`

---

## First-Time Setup

### 1. Database

```bash
psql -U postgres -c "CREATE DATABASE skinsense;"
psql -U postgres -d skinsense -f server/migrations/001_initial_schema.sql
```

### 2. Server environment

```bash
cp server/.env.example server/.env
# Edit server/.env — set DB_PASSWORD and JWT_SECRET at minimum
```

### 3. Node dependencies

```bash
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 4. Python inference dependencies

```bash
cd inference
pip install -r requirements.txt
```

This installs PyTorch (CPU), FastAPI, Transformers, librosa, and all other inference dependencies.

> For GPU inference (CUDA 12.6 / RTX 4060):
> ```bash
> pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
> ```

### 5. Skin classification model weights

Copy `student_large_distilled.pth` into:

```
inference/models/student_large_distilled.pth
```

This is the trained MobileNetV3-Large distilled model (~20 MB). Transfer it from the training machine if needed.

### 6. Download the Whisper ASR model (one time, ~1.5 GB)

```bash
cd inference
python download_asr_model.py
```

This downloads `kingabzpro/whisper-large-v3-turbo-urdu` from HuggingFace into `inference/models/asr/whisper-urdu/`. After this the inference service loads it with `local_files_only=True` — no internet access required at runtime.

> This step requires internet access once. All subsequent runs are fully offline.

---

## Running the System

Open three terminals from the project root:

**Terminal 1 — Python inference service**
```bash
cd inference
python server.py
```
Expected output:
```
Loading model from ./models/student_large_distilled.pth on cpu...
Model weights loaded successfully.
Loading ASR model from ./models/asr/whisper-urdu ...
ASR model ready.
INFO:     Uvicorn running on http://0.0.0.0:5001
```

**Terminal 2 — Express backend**
```bash
cd server
npm run dev
```
Expected: `SkinSense server running on port 5000`

**Terminal 3 — React frontend**
```bash
cd client
npm run dev
```
Expected: `VITE ready at http://localhost:5173`

---

## Verifying the inference service

Open `http://localhost:5001/health` in a browser. A fully loaded service returns:

```json
{
  "status": "ok",
  "model": "MobileNetV3-Large (distilled)",
  "asr_model": "whisper-large-v3-turbo-urdu",
  "device": "cpu",
  "classes": ["Vitiligo", "Melasma", ...]
}
```

If `asr_model` shows `"not loaded"`, the Whisper model directory is missing — run step 6 above.

---

## Project structure

```
FYP-SkinSense-UI/
├── client/                        React + Vite frontend
├── server/                        Express.js backend
│   ├── src/
│   │   ├── controllers/
│   │   │   └── screeningController.js
│   │   └── utils/
│   │       └── mockData.js        (mock predictions — not used for ASR anymore)
│   └── migrations/
│       └── 001_initial_schema.sql
├── inference/                     Python FastAPI inference service
│   ├── server.py                  Endpoints: /health  /predict  /transcribe  /heatmaps
│   ├── requirements.txt
│   ├── download_asr_model.py      Run once to download Whisper model
│   ├── models/
│   │   ├── student_large_distilled.pth   (add manually)
│   │   └── asr/
│   │       └── whisper-urdu/             (created by download_asr_model.py)
│   └── heatmaps/                  Grad-CAM output images (auto-created)
├── SETUP_INSTRUCTIONS.md          Full initial scaffolding walkthrough
└── ML_INTEGRATION_GUIDE.md        Inference service deep-dive
```

---

## Inference service endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service status, loaded models |
| POST | `/predict` | Skin image → condition + confidence + Grad-CAM |
| POST | `/transcribe` | Audio file → Urdu transcript + keywords |
| GET | `/heatmaps/{id}` | Serve Grad-CAM PNG by filename |
