"""
SkinSense ML Inference Service
Loads the distilled MobileNetV3-Large model and exposes a prediction API.
Called by the Express backend when a screening is submitted.
"""
import asyncio
import io
import os
import tempfile
import time
import traceback
import uuid
import re
from pathlib import Path

import cv2
import numpy as np
import psutil
import soundfile as sf
import torch
import torch.nn as nn
import torch.nn.functional as torchF
import torchvision.transforms as transforms
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from torchvision import models
from transformers import pipeline as hf_pipeline

from quality import (
    MAX_UPLOAD_BYTES,
    assess_prediction,
    check_image_blur,
    entropy_from_probs,
    is_lfs_pointer,
    is_skin_image,
    is_too_blurry,
)

# ── Config ────────────────────────────────────────────────────────────
MODEL_PATH = os.environ.get("MODEL_PATH", "./models/student_large_clip_dualkd_distilled.pth")
HEATMAP_DIR = os.environ.get("HEATMAP_DIR", "./heatmaps")
# Default ASR: our whisper-small Urdu fine-tune (train_whisper_urdu.py, weights in git via LFS) - 23.6% WER vs the
# turbo's 25.5% on the same FLEURS ur_pk clips, ~2.6x faster on CPU with ~43% less RAM. Falls back to the turbo
# (download_asr_model.py) if the fine-tune is missing or still an un-pulled LFS pointer (run `git lfs pull`).
def _usable_asr_dir(path):
    weights = os.path.join(path, "model.safetensors")
    return os.path.isdir(path) and (not os.path.exists(weights) or not is_lfs_pointer(weights))


ASR_MODEL_PATH = os.environ.get("ASR_MODEL_PATH") or next(
    (p for p in ("./models/asr/whisper-small-urdu-ours", "./models/asr/whisper-urdu") if _usable_asr_dir(p)),
    "./models/asr/whisper-urdu",
)
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


# ── Model Definition ──────────────────────────────────────────────────
def build_student_large(num_classes=7):
    model = models.mobilenet_v3_large(weights=None)
    in_features = model.classifier[0].in_features
    model.classifier = nn.Sequential(
        nn.Linear(in_features, 512),
        nn.Hardswish(),
        nn.Dropout(p=0.3),
        nn.Linear(512, num_classes),
    )
    return model


# ── Preprocessing ─────────────────────────────────────────────────────
inference_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


# ── Grad-CAM Implementation ──────────────────────────────────────────
class GradCAM:
    def __init__(self, model):
        self.model = model
        self.gradients = None
        self.activations = None
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

        gradients = self.gradients[0]
        activations = self.activations[0]

        weights = gradients.mean(dim=(1, 2))
        cam = (weights[:, None, None] * activations).sum(dim=0)
        cam = torchF.relu(cam)

        if cam.max() > 0:
            cam = cam / cam.max()

        return cam.cpu().numpy(), class_idx


def create_heatmap_overlay(original_image, cam, alpha=0.4):
    img_np = np.array(original_image.resize((IMG_SIZE, IMG_SIZE)))
    cam_resized = cv2.resize(cam, (IMG_SIZE, IMG_SIZE))

    heatmap = cv2.applyColorMap(np.uint8(255 * cam_resized), cv2.COLORMAP_JET)
    heatmap = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)

    overlay = np.uint8(alpha * heatmap + (1 - alpha) * img_np)
    return overlay


# ── Load Models ───────────────────────────────────────────────────────
MODEL_VERSION = "mobilenetv3-large-distilled-v1"
print(f"Loading model from {MODEL_PATH} on {DEVICE}...")
model = build_student_large(NUM_CLASSES)
MODEL_LOADED = False

if os.path.exists(MODEL_PATH):
    if is_lfs_pointer(MODEL_PATH):
        raise RuntimeError(
            f"{MODEL_PATH} is a Git LFS pointer, not real weights. "
            "Run `git lfs install && git lfs pull` and restart the service."
        )
    state_dict = torch.load(MODEL_PATH, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state_dict)
    MODEL_LOADED = True
    print("Model weights loaded successfully.")
else:
    MODEL_VERSION += "-UNTRAINED"
    print(
        f"WARNING: Model file not found at {MODEL_PATH}. Running with RANDOM weights; "
        "predictions are meaningless and are tagged UNTRAINED."
    )

model = model.to(DEVICE)
model.eval()

grad_cam = GradCAM(model)
os.makedirs(HEATMAP_DIR, exist_ok=True)


def warm_up():
    """
    One dummy forward pass and one Grad-CAM pass at startup so the first real
    request does not pay one-off costs (lazy kernel init, allocator growth).
    This keeps cold-start latency out of the telemetry.
    """
    dummy = torch.zeros(1, 3, IMG_SIZE, IMG_SIZE, device=DEVICE)
    with torch.no_grad():
        model(dummy)
    grad_cam.generate(torch.zeros(1, 3, IMG_SIZE, IMG_SIZE, device=DEVICE), class_idx=0)
    if torch.cuda.is_available():
        torch.cuda.synchronize()


WARMED_UP = False
try:
    warm_up()
    WARMED_UP = True
except Exception:  # never block startup on warm-up
    traceback.print_exc()

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
        "asr_model": os.path.basename(os.path.normpath(ASR_MODEL_PATH)) if asr_pipe is not None else "not loaded",
        "device": str(DEVICE),
        "classes": CLASS_NAMES,
        "model_version": MODEL_VERSION,
        "model_loaded": MODEL_LOADED,
        "warmed_up": WARMED_UP,
    }


def compute_prediction_entropy(probabilities: torch.Tensor) -> float:
    """Shannon entropy of the predicted distribution (see quality.entropy_from_probs)."""
    return entropy_from_probs(probabilities.tolist())


@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    start_total = time.perf_counter()
    process = psutil.Process()
    ram_before = process.memory_info().rss / (1024 * 1024)

    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    # ── Phase 1: Preprocessing & Runtime Validation ──
    start_prep = time.perf_counter()
    contents = await image.read()
    if not contents:
        return JSONResponse(status_code=400, content={"error": "Empty image file", "code": "EMPTY_FILE"})
    if len(contents) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            status_code=413,
            content={"error": "Image is too large (max 10 MB).", "code": "FILE_TOO_LARGE"},
        )
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid image file", "code": "INVALID_IMAGE"})

    # Check 1: skin colour presence across Fitzpatrick scales
    if not is_skin_image(pil_image):
        return JSONResponse(
            status_code=400,
            content={
                "error": "No skin detected. Please upload a clear photo of the affected skin area.",
                "code": "NO_SKIN_DETECTED",
            },
        )

    # Check 2: blur detection (reject ungradable images)
    cv_img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    blur_score = check_image_blur(cv_img)
    if is_too_blurry(blur_score):
        return JSONResponse(
            status_code=400,
            content={
                "error": "The image is too blurry for an accurate screening. Please hold your camera steady and retake.",
                "code": "IMAGE_TOO_BLURRY",
                "blur_score": round(blur_score, 2),
            },
        )

    input_tensor = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    preprocess_ms = int((time.perf_counter() - start_prep) * 1000)

    # ── Phase 2: Model Forward Pass ──
    start_infer = time.perf_counter()
    with torch.no_grad():
        logits = model(input_tensor)
        probabilities = torch.softmax(logits, dim=1)[0]
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    inference_ms = int((time.perf_counter() - start_infer) * 1000)

    all_scores = {name: round(probabilities[i].item(), 4) for i, name in enumerate(CLASS_NAMES)}

    sorted_probs, sorted_indices = torch.sort(probabilities, descending=True)
    top_idx = sorted_indices[0].item()
    top_condition = CLASS_NAMES[top_idx]
    confidence_score = float(sorted_probs[0].item())
    confidence_margin = confidence_score - float(sorted_probs[1].item())
    entropy = compute_prediction_entropy(probabilities)

    # ── Phase 3: Out-of-distribution / non-lesion check ──
    status = assess_prediction(confidence_score, confidence_margin, entropy)

    # ── Phase 4: Grad-CAM explainability heatmap ──
    start_cam = time.perf_counter()
    cam, _ = grad_cam.generate(input_tensor.detach().clone(), class_idx=top_idx)

    heatmap_id = str(uuid.uuid4())
    overlay = create_heatmap_overlay(pil_image, cam)
    heatmap_filename = f"{heatmap_id}.png"
    heatmap_path = os.path.join(HEATMAP_DIR, heatmap_filename)
    Image.fromarray(overlay).save(heatmap_path)
    gradcam_ms = int((time.perf_counter() - start_cam) * 1000)

    # ── Phase 5: Hardware & memory profiling ──
    total_server_time_ms = int((time.perf_counter() - start_total) * 1000)
    ram_after = process.memory_info().rss / (1024 * 1024)
    server_ram_used_mb = round(max(0.0, ram_after - ram_before), 2)

    gpu_vram_used_mb = 0.0
    if torch.cuda.is_available():
        gpu_vram_used_mb = round(torch.cuda.max_memory_allocated() / (1024 * 1024), 2)

    telemetry_data = {
        "image_preprocess_ms": preprocess_ms,
        "model_inference_ms": inference_ms,
        "gradcam_generation_ms": gradcam_ms,
        "total_server_time_ms": total_server_time_ms,
        "server_ram_used_mb": server_ram_used_mb,
        "gpu_vram_used_mb": gpu_vram_used_mb,
        "device_type": str(DEVICE.type),
        "blur_score": round(blur_score, 1),
        "entropy": round(entropy, 3),
        "confidence_margin": round(confidence_margin, 3),
    }

    return {
        "model_version": MODEL_VERSION,
        "top_condition": top_condition if status == "classified" else "No Disease / Inconclusive",
        "confidence_score": round(confidence_score, 4),
        "status": status,
        "all_scores": all_scores,
        "heatmap_path": heatmap_filename,
        "inference_time_ms": max(1, total_server_time_ms),
        "telemetry": telemetry_data,
    }


def load_audio_wav(file_path: str, target_sr: int = 16000) -> np.ndarray:
    """
    Decodes audio from disk into a 1D float32 numpy array resampled to target_sr (16 kHz).
    Tolerates raw WAV, WebM/Opus, OGG, and MP4 containers via fallback readers.
    """
    # Attempt 1: soundfile (fast standard PCM loader)
    try:
        data, sr = sf.read(file_path, dtype="float32", always_2d=True)
        audio = data.mean(axis=1)
        if sr != target_sr:
            import librosa
            audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        return audio.astype(np.float32)
    except Exception:
        pass

    # Attempt 2: librosa (uses audioread / ffmpeg backend for WebM and compressed audio)
    try:
        import librosa
        audio, _ = librosa.load(file_path, sr=target_sr, mono=True)
        return audio.astype(np.float32)
    except Exception:
        pass

    # Attempt 3: torchaudio
    try:
        import torchaudio
        waveform, sr = torchaudio.load(file_path)
        if waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sr != target_sr:
            resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=target_sr)
            waveform = resampler(waveform)
        return waveform.squeeze().cpu().numpy().astype(np.float32)
    except Exception:
        pass

    raise RuntimeError(
        f"Unable to decode audio from {file_path}. Ensure ffmpeg is installed and available in PATH."
    )


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    print(f"\n[ASR] Incoming request: filename='{audio.filename}', content_type='{audio.content_type}'")
    
    if asr_pipe is None:
        print("[ASR] Rejected: asr_pipe is None (model not loaded).")
        return JSONResponse(
            status_code=503,
            content={"error": "ASR model not loaded. Run inference/download_asr_model.py first."},
        )

    contents = await audio.read()
    if not contents:
        print("[ASR] Rejected: Empty audio payload received.")
        return JSONResponse(status_code=400, content={"error": "Empty audio file received."})

    print(f"[ASR] Audio payload read successfully: {len(contents)} bytes")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        t0 = time.perf_counter()
        print(f"[ASR] Decoding audio from temporary file '{tmp_path}'...")
        audio_array = await asyncio.to_thread(load_audio_wav, tmp_path, 16000)
        print(f"[ASR] Audio decoded. Sample count: {len(audio_array)} ({round(len(audio_array)/16000, 2)}s duration)")

        print("[ASR] Running Whisper pipeline on worker thread...")
        def _run_pipeline():
            return asr_pipe(
                {"array": audio_array, "sampling_rate": 16000},
                generate_kwargs={"language": "urdu", "task": "transcribe"},
            )

        result = await asyncio.to_thread(_run_pipeline)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        print(f"[ASR] Whisper transcription completed in {elapsed_ms} ms")

        transcript_text = result.get("text", "").strip()
        print(f"[ASR] Result: \"{transcript_text}\"")

        tokens = transcript_text.split()
        keywords = list(dict.fromkeys(t for t in tokens if len(t) > 3))[:10]

        return {
            "transcript_text": transcript_text,
            "language": "ur",
            "confidence_score": 0.90,
            "keywords": keywords,
            "asr_compute_ms": elapsed_ms,
        }
    except Exception as e:
        print("[ASR] Exception during transcription:")
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"Transcription failed: {str(e)}"})
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


HEATMAP_FILENAME_REGEX = re.compile(r"^[0-9a-fA-F\-]{36}\.png$")

@app.get("/heatmaps/{filename}")
async def get_heatmap(filename: str):
    # Enforce exact UUID4 filename pattern to eliminate directory traversal
    if not HEATMAP_FILENAME_REGEX.match(filename):
        return JSONResponse(status_code=404, content={"error": "Invalid heatmap identifier format"})

    path = os.path.abspath(os.path.join(HEATMAP_DIR, filename))
    heatmap_dir_abs = os.path.abspath(HEATMAP_DIR)

    # Ensure canonical path stays strictly inside the designated heatmaps folder
    if not path.startswith(heatmap_dir_abs) or not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "Heatmap not found"})

    return FileResponse(path, media_type="image/png")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)