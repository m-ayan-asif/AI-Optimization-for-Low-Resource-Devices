# SkinSense - Setup Instructions

Three services run side by side: **inference (Python, 5001)**, **backend (Express, 5000)** and **frontend (React, 5173)**.

## Prerequisites

- Node.js **20.19+** (required by Vite 7)
- Python 3.10+ (a virtual environment is recommended)
- PostgreSQL installed and running
- Git and **Git LFS**
- ~2 GB free disk space (Whisper Urdu model is ~1.5 GB)

## Project Structure

```
ai-optimization-for-low-resource-devices/
├── README.md
├── requirements.txt              # notebook / training dependencies
├── .prettierrc
├── client/                       # React + Vite frontend (port 5173)
│   ├── package.json
│   ├── vite.config.js            # proxies /api -> localhost:5000
│   ├── vitest.config.js
│   ├── eslint.config.js
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── index.css
│       ├── components/
│       │   ├── common/           # ProtectedRoute, ClinicianRoute
│       │   └── layout/           # Header, Layout
│       ├── context/              # AuthContext
│       ├── hooks/                # useScreening, useVoiceRecorder, useClinician
│       ├── i18n/                 # en.json, ur.json, i18n.js
│       ├── pages/
│       │   ├── LoginPage, RegisterPage, DashboardPage
│       │   ├── ScreeningPage, ResultsPage, HistoryPage, ClinicsPage
│       │   └── clinician/        # ClinicianDashboard, CaseReviewPage, ClinicianHistoryPage
│       ├── utils/                # api.js, constants.js, imageValidation.js
│       └── __tests__/            # Vitest tests + setup
├── server/                       # Express backend (port 5000)
│   ├── package.json
│   ├── server.js                 # entry point
│   ├── .env.example              # copy to .env
│   ├── migrations/               # 001_initial_schema.sql, 002_clinician_profile_fields.sql
│   ├── src/
│   │   ├── app.js
│   │   ├── config/               # env config
│   │   ├── controllers/          # auth, clinic, clinician, screening
│   │   ├── middleware/           # auth, rateLimiter, upload
│   │   ├── models/               # db.js, tokenBlacklist.js
│   │   ├── routes/               # auth, clinics, clinicianRoutes, screening
│   │   └── utils/                # mockData.js (fallback predictions)
│   └── tests/                    # Jest tests + setup
├── inference/                    # FastAPI ML service (port 5001)
│   ├── server.py                 # /health, /predict, /transcribe, /heatmaps
│   ├── download_asr_model.py     # one-time Whisper Urdu download
│   ├── requirements.txt
│   ├── models/
│   │   ├── student_large_distilled.pth   # Git LFS
│   │   └── asr/whisper-urdu/             # created by download_asr_model.py (not in repo)
│   ├── heatmaps/                 # generated Grad-CAM images (auto-created)
│   └── tests/                    # pytest tests
├── models/                       # trained checkpoints (Git LFS)
│   ├── teacher_best.pth, teacher_best_v2.pth, teacher_final.pth
│   ├── student_distilled.pth, student_large_distilled.pth
│   └── best_model.pth, best_model_finetuned.pth
├── notebooks/                    # data exploration, preprocessing, training
│   ├── 01_data_exploration.ipynb
│   ├── 02_data_preprocessing.ipynb
│   ├── 04_predictive_brain_model.ipynb
│   ├── SkinSense.ipynb
│   └── train_model_b.py
└── documentation/
    ├── SETUP_INSTRUCTIONS.md
    ├── ML_INTEGRATION_GUIDE.md
    └── TESTING.md
```

Folders created at runtime (not committed): `server/uploads/`, `inference/heatmaps/`, `inference/models/asr/`, `node_modules/`.

## 1. Clone and pull large files

```bash
git clone <repo-url>
cd <repo-folder>
git lfs install
git lfs pull
```

Model weights (e.g. `inference/models/student_large_distilled.pth`) are stored in Git LFS. Without `git lfs pull` the file is a small text pointer and the inference service will fail to load the model.

Already cloned? Update with:

```bash
git checkout main
git pull origin main
git lfs pull
```

## 2. Database

```bash
psql -U postgres -c "CREATE DATABASE skinsense;"
psql -U postgres -d skinsense -f server/migrations/001_initial_schema.sql
psql -U postgres -d skinsense -f server/migrations/002_clinician_profile_fields.sql
```

Run migrations in numeric order. Both are required.

## 3. Backend

```bash
cd server
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Edit `server/.env`:

| Variable                                                  | Purpose                                               |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `PORT`                                                    | API port (default 5000)                               |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection                                 |
| `JWT_SECRET`                                              | Set a strong random value                             |
| `JWT_EXPIRES_IN`                                          | Token lifetime (default 30m)                          |
| `UPLOAD_DIR`                                              | Image/audio upload folder                             |
| `INFERENCE_URL`                                           | Inference service URL (default http://localhost:5001) |

## 4. Inference service

```bash
cd inference
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python download_asr_model.py      # one time, needs internet, ~1.5 GB
```

Optional GPU build of PyTorch (adjust CUDA version to yours):

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
```

Optional environment variables: `MODEL_PATH`, `HEATMAP_DIR`, `ASR_MODEL_PATH`, `INFERENCE_PORT`.

## 5. Frontend

```bash
cd client
npm install
```

## 6. Run everything (three terminals)

Start in this order:

```bash
# Terminal 1 - Inference
cd inference && python server.py         # http://localhost:5001/health

# Terminal 2 - Backend
cd server && npm run dev                 # http://localhost:5000/api/health

# Terminal 3 - Frontend
cd client && npm run dev                 # http://localhost:5173
```

Vite proxies `/api` to port 5000, and the backend only allows CORS from `http://localhost:5173`.

## 7. Verify the setup

1. `http://localhost:5001/health` returns `status: ok`, the device and the 7 classes.
2. `http://localhost:5000/api/health` returns `status: ok`.
3. Open `http://localhost:5173`, register, start a screening, upload an image and run analysis.
4. Check the result's model version. If it contains **"mock"**, the inference service was not reached and the backend used its fallback.

## 8. Run tests

```bash
cd server && npm test
cd client && npm test
cd inference && python -m pytest tests/ -v
```

Details: [TESTING.md](TESTING.md)

## Troubleshooting

| Problem                                           | Likely cause / fix                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| Model fails to load, weights look like ~130 bytes | Git LFS not pulled: run `git lfs pull`                              |
| Results always say "mock"                         | Inference service not running, wrong `INFERENCE_URL`, or port clash |
| Voice transcript is empty                         | Whisper model not downloaded: run `python download_asr_model.py`    |
| `ECONNREFUSED` on port 5432                       | PostgreSQL not running or wrong DB credentials in `.env`            |
| Vite fails to start                               | Node.js older than 20.19: upgrade Node                              |
| CORS errors                                       | Frontend must run on port 5173                                      |
| Port already in use                               | Stop the old process or change `PORT` / `INFERENCE_PORT`            |

## Contributing workflow

```bash
git checkout -b feature/short-description
# make changes, run tests
git add <files>
git commit -m "feat: short description"
git push origin feature/short-description
```

Never commit `server/.env` or `server/uploads/`.
