# SkinSense — ML Model Integration Guide

## Architecture

```
Browser → React (5173) → Express API (5000) → Python Inference Service (5001)
                                                     ↓
                                              MobileNetV3-Large
                                              Grad-CAM Heatmap
```

The Express backend sends the uploaded image to a Python FastAPI service that runs
the actual MobileNetV3-Large model and returns predictions + Grad-CAM heatmaps.
If the Python service is down, the Express backend falls back to mock predictions.

---

## Files to Add/Replace

### New: `inference/` directory (at project root)
```
FYP-SkinSense-UI/
├── inference/
│   ├── server.py              ← Python FastAPI inference service
│   ├── requirements.txt       ← Python dependencies
│   ├── models/
│   │   └── student_large_distilled.pth  ← Your trained model weights
│   └── heatmaps/              ← Generated Grad-CAM images (auto-created)
```

### Replace: `server/src/controllers/screeningController.js`
Updated to call the Python service instead of generating mock data.

### Replace: `client/src/pages/ResultsPage.jsx`
Updated to display the Grad-CAM heatmap overlay image.

---

## Step-by-Step Setup

### 1. Install Python (if not already installed)

Download Python 3.11+ from https://www.python.org/downloads/
During installation, CHECK "Add Python to PATH".

Verify:
```powershell
python --version
pip --version
```

### 2. Create the inference directory

```powershell
cd C:\Users\lbrahim\Desktop\FYP-SkinSense-UI
mkdir inference
mkdir inference\models
mkdir inference\heatmaps
```

### 3. Copy the files from the downloaded archive

Copy `server.py` and `requirements.txt` into the `inference/` directory.

### 4. Copy your trained model weights

Copy your `student_large_distilled.pth` file from wherever you trained it into:
```
C:\Users\lbrahim\Desktop\FYP-SkinSense-UI\inference\models\student_large_distilled.pth
```

If the model was trained on another machine (the RTX 4060 machine), transfer the .pth
file to this machine. The file is typically 15-25 MB for MobileNetV3-Large.

### 5. Install Python dependencies

```powershell
cd C:\Users\lbrahim\Desktop\FYP-SkinSense-UI\inference
pip install -r requirements.txt
```

**Note on PyTorch:** The above installs CPU-only PyTorch by default. For inference on
a web server, CPU is fine and simpler. If you want GPU inference, install the CUDA
version instead:

```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu126
```

(Use cu126 for CUDA 12.6 which matches your RTX 4060 training setup.)

### 6. Install the `undici` package in the Express server

The updated controller uses `undici` for FormData support when calling the Python service:

```powershell
cd C:\Users\lbrahim\Desktop\FYP-SkinSense-UI\server
npm install undici
```

### 7. Replace the server controller

Replace `server/src/controllers/screeningController.js` with the updated version
from the archive.

### 8. Replace the results page

Replace `client/src/pages/ResultsPage.jsx` with the updated version from the archive.

### 9. Add INFERENCE_URL to server .env

Open `server/.env` and add:
```
INFERENCE_URL=http://localhost:5001
```

### 10. Update .gitignore

Add these lines to your root `.gitignore`:
```
inference/models/*.pth
inference/heatmaps/
__pycache__/
*.pyc
```

---

## Running Everything (3 terminals)

### Terminal 1 — Python Inference Service
```powershell
cd C:\Users\lbrahim\Desktop\FYP-SkinSense-UI\inference
python server.py
```
Should show:
```
Loading model from ./models/student_large_distilled.pth on cpu...
Model weights loaded successfully.
INFO:     Uvicorn running on http://0.0.0.0:5001
```

### Terminal 2 — Express Backend
```powershell
cd C:\Users\lbrahim\Desktop\FYP-SkinSense-UI\server
npm run dev
```
Should show: `SkinSense server running on port 5000`

### Terminal 3 — React Frontend
```powershell
cd C:\Users\lbrahim\Desktop\FYP-SkinSense-UI\client
npm run dev
```
Should show: `VITE ready at http://localhost:5173`

---

## Testing the Integration

### 1. Health check the inference service
Open browser: http://localhost:5001/health

Should return:
```json
{
  "status": "ok",
  "model": "MobileNetV3-Large (distilled)",
  "device": "cpu",
  "classes": ["Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"]
}
```

### 2. Test prediction directly
```powershell
curl -X POST http://localhost:5001/predict -F "image=@path/to/test_skin_image.jpg"
```

### 3. End-to-end test
1. Open http://localhost:5173
2. Login → Start Screening → Upload a skin image → Run Analysis
3. Results page should show real model predictions and a Grad-CAM heatmap

---

## How It Works

### Inference Flow
1. User uploads image → Express stores file on disk
2. User clicks "Run Analysis" → Express reads file path from DB
3. Express sends image to Python service via `POST /predict` (multipart)
4. Python service:
   - Loads image, resizes to 224×224, normalizes with ImageNet stats
   - Runs MobileNetV3-Large forward pass
   - Applies softmax to get probabilities for all 7 conditions
   - Runs Grad-CAM on the last convolutional layer
   - Generates heatmap overlay image, saves to disk
   - Returns JSON with predictions + heatmap filename
5. Express stores prediction in PostgreSQL
6. Frontend fetches results and displays heatmap from Python service URL

### Fallback Behavior
If the Python service is unreachable (down, crashed, network issue), the Express
controller catches the error and falls back to `generateMockPrediction()`. This means
the app never fully breaks — it just shows mock data until the inference service is
restarted. The server console will log a warning: "Falling back to mock prediction".

### Grad-CAM Details
- Hooks into `model.features[-1]` (last InvertedResidual block of MobileNetV3)
- Computes gradients of the predicted class w.r.t. activations
- Generates a weighted activation map
- Overlays as a JET colormap on the original image at 40% opacity
- Saved as PNG in `inference/heatmaps/` with UUID filename

---

## Model Details Reference

| Property | Value |
|----------|-------|
| Architecture | MobileNetV3-Large |
| Training Method | Knowledge distillation from EfficientNet-B3 teacher |
| Input Size | 224 × 224 × 3 |
| Normalization | ImageNet (mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]) |
| Classifier | Linear(960→512) → Hardswish → Dropout(0.3) → Linear(512→7) |
| Classes | Vitiligo, Melasma, Psoriasis, Eczema, Tinea, Contact Dermatitis, Seborrheic Dermatitis |
| Distillation | Temperature=4, Alpha=0.7, KL divergence + CE with label smoothing=0.1 |
| Weights File | student_large_distilled.pth |
