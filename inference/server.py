"""
SkinSense ML Inference Service
Loads the distilled MobileNetV3-Large model and exposes a prediction API.
Called by the Express backend when a screening is submitted.
"""

import io
import os
import time
import uuid
import tempfile
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as torchF
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2
from transformers import pipeline as hf_pipeline

# ── Config ────────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("MODEL_PATH", "./models/student_large_distilled.pth")
HEATMAP_DIR = os.environ.get("HEATMAP_DIR", "./heatmaps")
ASR_MODEL_PATH = os.environ.get("ASR_MODEL_PATH", "./models/asr/whisper-urdu")
PORT = int(os.environ.get("INFERENCE_PORT", 5001))
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

CLASS_NAMES = [
    "Vitiligo",
    "Melasma",
    "Psoriasis",
    "Eczema",
    "Tinea",
    "Contact Dermatitis",
    "Seborrheic Dermatitis",
]

NUM_CLASSES = len(CLASS_NAMES)
IMG_SIZE = 224

# ── Model Definition (must match training exactly) ────────────────────
def build_student_large(num_classes=7):
    model = models.mobilenet_v3_large(weights=None)  # No pretrained — we load our own
    in_features = model.classifier[0].in_features
    model.classifier = nn.Sequential(
        nn.Linear(in_features, 512),
        nn.Hardswish(),
        nn.Dropout(p=0.3),
        nn.Linear(512, num_classes),
    )
    return model


# ── Preprocessing (must match val_transform from training) ────────────
inference_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ── Grad-CAM Implementation ──────────────────────────────────────────
class GradCAM:
    """Grad-CAM for MobileNetV3 — targets the last conv layer in features."""

    def __init__(self, model):
        self.model = model
        self.gradients = None
        self.activations = None
        # Hook into the last conv block of MobileNetV3
        # features[-1] is the last InvertedResidual block
        target_layer = model.features[-1]
        target_layer.register_forward_hook(self._forward_hook)
        target_layer.register_full_backward_hook(self._backward_hook)

    def _forward_hook(self, module, input, output):
        self.activations = output.detach()

    def _backward_hook(self, module, grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def generate(self, input_tensor, class_idx=None):
        self.model.eval()
        input_tensor.requires_grad_(True)

        output = self.model(input_tensor)

        if class_idx is None:
            class_idx = output.argmax(dim=1).item()

        self.model.zero_grad()
        target = output[0, class_idx]
        target.backward()

        gradients = self.gradients[0]  # (C, H, W)
        activations = self.activations[0]  # (C, H, W)

        # Global average pool gradients
        weights = gradients.mean(dim=(1, 2))  # (C,)

        # Weighted combination of activation maps
        cam = (weights[:, None, None] * activations).sum(dim=0)  # (H, W)
        cam = torchF.relu(cam)

        # Normalize to [0, 1]
        if cam.max() > 0:
            cam = cam / cam.max()

        return cam.cpu().numpy(), class_idx


def create_heatmap_overlay(original_image, cam, alpha=0.4):
    """Overlay Grad-CAM heatmap on original image."""
    # Resize CAM to match original image
    img_np = np.array(original_image.resize((IMG_SIZE, IMG_SIZE)))
    cam_resized = cv2.resize(cam, (IMG_SIZE, IMG_SIZE))

    # Convert CAM to colormap
    heatmap = cv2.applyColorMap(np.uint8(255 * cam_resized), cv2.COLORMAP_JET)
    heatmap = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)

    # Blend
    overlay = np.uint8(alpha * heatmap + (1 - alpha) * img_np)
    return overlay


# ── Load Model ────────────────────────────────────────────────────────
print(f"Loading model from {MODEL_PATH} on {DEVICE}...")
model = build_student_large(NUM_CLASSES)

if os.path.exists(MODEL_PATH):
    state_dict = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state_dict)
    print("Model weights loaded successfully.")
else:
    print(f"WARNING: Model file not found at {MODEL_PATH}. Running with random weights.")

model = model.to(DEVICE)
model.eval()

grad_cam = GradCAM(model)

# Ensure heatmap directory exists
os.makedirs(HEATMAP_DIR, exist_ok=True)

# ── Load ASR Model ────────────────────────────────────────────────────
asr_pipe = None
if os.path.isdir(ASR_MODEL_PATH):
    print(f"Loading ASR model from {ASR_MODEL_PATH} ...")
    asr_pipe = hf_pipeline(
        "automatic-speech-recognition",
        model=ASR_MODEL_PATH,
        device=0 if torch.cuda.is_available() else -1,
    )
    print("ASR model ready.")
else:
    print(f"ASR model not found at {ASR_MODEL_PATH}. Run download_asr_model.py to enable transcription.")


# ── FastAPI App ───────────────────────────────────────────────────────
app = FastAPI(title="SkinSense Inference Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "MobileNetV3-Large (distilled)",
        "asr_model": "whisper-large-v3-turbo-urdu" if asr_pipe is not None else "not loaded",
        "device": str(DEVICE),
        "classes": CLASS_NAMES,
    }


@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    start_time = time.time()

    # Read and validate image
    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid image file"})

    # Preprocess
    input_tensor = inference_transform(pil_image).unsqueeze(0).to(DEVICE)

    # Run inference
    with torch.no_grad():
        logits = model(input_tensor)
        probabilities = torchF.softmax(logits, dim=1)[0]

    # Get all scores
    all_scores = {}
    for i, name in enumerate(CLASS_NAMES):
        all_scores[name] = round(probabilities[i].item(), 4)

    top_idx = probabilities.argmax().item()
    top_condition = CLASS_NAMES[top_idx]
    confidence_score = probabilities[top_idx].item()

    # Generate Grad-CAM heatmap
    input_for_cam = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    cam, _ = grad_cam.generate(input_for_cam, class_idx=top_idx)

    # Save heatmap overlay
    heatmap_id = str(uuid.uuid4())
    overlay = create_heatmap_overlay(pil_image, cam)
    heatmap_filename = f"{heatmap_id}.png"
    heatmap_path = os.path.join(HEATMAP_DIR, heatmap_filename)
    Image.fromarray(overlay).save(heatmap_path)

    inference_time_ms = int((time.time() - start_time) * 1000)

    return {
        "model_version": "mobilenetv3-large-distilled-v1",
        "top_condition": top_condition,
        "confidence_score": round(confidence_score, 4),
        "all_scores": all_scores,
        "heatmap_path": heatmap_filename,
        "inference_time_ms": inference_time_ms,
    }


import traceback
import soundfile as sf


def load_audio_wav(file_path: str, target_sr: int = 16000) -> np.ndarray:
    """Read a WAV file with soundfile (no external dependencies)."""
    data, sr = sf.read(file_path, dtype="float32", always_2d=True)
    audio = data.mean(axis=1)  # mix to mono
    if sr != target_sr:
        # Resample only if the browser sent something other than 16 kHz
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
    return audio.astype(np.float32)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if asr_pipe is None:
        print("[transcribe] ERROR: ASR model is not loaded.")
        return JSONResponse(
            status_code=503,
            content={"error": "ASR model not loaded. Run inference/download_asr_model.py first."},
        )

    contents = await audio.read()
    if not contents:
        print("[transcribe] ERROR: received empty audio file.")
        return JSONResponse(status_code=400, content={"error": "Empty audio file received."})

    suffix = Path(audio.filename).suffix if audio.filename else ".wav"
    print(f"[transcribe] Received {len(contents)} bytes, filename='{audio.filename}', suffix='{suffix}'")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        print(f"[transcribe] Loading audio from {tmp_path} ...")
        audio_array = load_audio_wav(tmp_path)
        print(f"[transcribe] Audio loaded: {len(audio_array)} samples at 16 kHz ({len(audio_array)/16000:.1f}s)")

        print("[transcribe] Running Whisper ASR ...")
        result = asr_pipe(
            {"array": audio_array, "sampling_rate": 16000},
            generate_kwargs={"language": "urdu", "task": "transcribe"},
        )

        transcript_text = result["text"].strip()
        print(f"[transcribe] Transcript: '{transcript_text}'")

        tokens = transcript_text.split()
        keywords = list(dict.fromkeys(t for t in tokens if len(t) > 3))[:10]

        return {
            "transcript_text": transcript_text,
            "language": "ur",
            "confidence_score": 0.90,
            "keywords": keywords,
        }
    except Exception as e:
        print(f"[transcribe] EXCEPTION: {e}")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"Transcription failed: {str(e)}"})
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.get("/heatmaps/{filename}")
async def get_heatmap(filename: str):
    path = os.path.join(HEATMAP_DIR, filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "Heatmap not found"})
    return FileResponse(path, media_type="image/png")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
