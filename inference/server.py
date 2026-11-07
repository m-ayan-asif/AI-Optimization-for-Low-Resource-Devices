"""
SkinSense ML Inference Service
Runs the distilled MobileNetV3-Large model and Whisper on ONNX Runtime and exposes a prediction API.
Called by the Express backend when a screening is submitted. PyTorch is only needed for training and exporting
(export_mobile.py, export_server.py), never to serve.
"""
import asyncio
import io
import os
import tempfile
import time
import traceback
import uuid
import re

import av
import cv2
import numpy as np
import onnxruntime as ort
import psutil
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image

from quality import (
    MAX_UPLOAD_BYTES,
    assess_prediction,
    check_image_blur,
    entropy_from_probs,
    is_lfs_pointer,
    is_not_a_lesion,
    is_skin_image,
    is_too_blurry,
)
from whisper_onnx import ENCODER_FILE, WhisperOnnx, session_options

# ── Config ────────────────────────────────────────────────────────────
# Production student: CLIP dual-KD MobileNetV3-Large trained on the leak-free split at 320 px (seed picked on val):
# 74.58% test / 70.85 macro-F1 on the clean test set, plus an 8th "not a skin lesion" output fitted on its frozen
# features (notebooks/fit_not_lesion_head.py), which leaves the 7 disease outputs - and accuracy - unchanged.
# Same file as the PWA's model (export_mobile.py): it returns the logits and the Grad-CAM for the top disease.
MODEL_PATH = os.environ.get("MODEL_PATH", "./models/student_clean_res320_s2_notlesion_v2.onnx")
HEATMAP_DIR = os.environ.get("HEATMAP_DIR", "./heatmaps")
# Our whisper-small Urdu fine-tune (train_whisper_urdu.py) as int8 ONNX, the same files the PWA runs: 23.3 / 30.4 % WER
# on FLEURS-100 / unseen Common Voice, against 23.6 / 29.8 % for the fp32 PyTorch model.
ASR_MODEL_PATH = os.environ.get("ASR_MODEL_PATH", "./models/asr/whisper-small-urdu-onnx")
PORT = int(os.environ.get("INFERENCE_PORT", 5001))
THREADS = int(os.environ.get("INFERENCE_THREADS", min(4, os.cpu_count() or 1)))
DEVICE = "cpu"
MEAN = np.array([0.485, 0.456, 0.406], np.float32)[:, None, None]
STD = np.array([0.229, 0.224, 0.225], np.float32)[:, None, None]

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


def create_session(path):
    return ort.InferenceSession(path, session_options(THREADS), providers=["CPUExecutionProvider"])


# ── Preprocessing ─────────────────────────────────────────────────────
def preprocess(pil_image, size):
    """torchvision's Resize + ToTensor + Normalize on a PIL image: (1, 3, size, size) float32."""
    pixels = np.asarray(pil_image.resize((size, size), Image.BILINEAR), np.float32).transpose(2, 0, 1) / 255.0
    return ((pixels - MEAN) / STD)[None].astype(np.float32)


def softmax(logits):
    z = np.exp(logits - logits.max())
    return z / z.sum()


def create_heatmap_overlay(original_image, cam, alpha=0.4):
    img_np = np.array(original_image.resize((IMG_SIZE, IMG_SIZE)))
    cam_resized = cv2.resize(cam, (IMG_SIZE, IMG_SIZE))

    heatmap = cv2.applyColorMap(np.uint8(255 * cam_resized), cv2.COLORMAP_JET)
    heatmap = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)

    overlay = np.uint8(alpha * heatmap + (1 - alpha) * img_np)
    return overlay


# ── Load Models ───────────────────────────────────────────────────────
# Deliberately without "onnx" in the name: the app reads that as "this ran on the phone" (ResultsPage, device-result).
MODEL_VERSION = os.environ.get("MODEL_VERSION", "mobilenetv3-large-dualkd-clean320-notlesion-v4")
print(f"Loading model from {MODEL_PATH} on {DEVICE} with {THREADS} threads...")
if os.path.exists(MODEL_PATH) and is_lfs_pointer(MODEL_PATH):
    raise RuntimeError(
        f"{MODEL_PATH} is a Git LFS pointer, not real weights. "
        "Run `git lfs install && git lfs pull` and restart the service."
    )
student = create_session(MODEL_PATH) if os.path.exists(MODEL_PATH) else None
MODEL_LOADED = student is not None
if MODEL_LOADED:
    _, _, IMG_SIZE, _ = student.get_inputs()[0].shape
    # 7 outputs = the diseases; 8 = the diseases plus a trained "not a skin lesion" class (output index 7)
    HAS_NOT_LESION_CLASS = student.get_outputs()[0].shape[1] > NUM_CLASSES
    print("Model loaded successfully.")
else:
    IMG_SIZE, HAS_NOT_LESION_CLASS = 320, False
    print(f"WARNING: Model file not found at {MODEL_PATH}. /predict returns 503 until it is there.")

os.makedirs(HEATMAP_DIR, exist_ok=True)

# ── Lesion-photo gate ─────────────────────────────────────────────────
# "Is this a photo of a skin condition at all?", judged on GENERAL ImageNet features (notebooks/fit_lesion_gate.py).
# The skin model sees everything as skin texture, so close-up pets or a baby on an armchair slipped past its own
# not-a-lesion output and came back as Eczema; an ImageNet model still knows dogs, babies and furniture.
LESION_GATE_PATH = os.environ.get("LESION_GATE_PATH", "./models/lesion_gate.onnx")
GATE_SIZE = 224
lesion_gate, LESION_GATE_THRESHOLD = None, None
if os.path.exists(LESION_GATE_PATH) and not is_lfs_pointer(LESION_GATE_PATH):
    lesion_gate = create_session(LESION_GATE_PATH)
    # export_server.py stores the threshold fitted with the gate inside the ONNX file
    LESION_GATE_THRESHOLD = float(os.environ.get(
        "LESION_GATE_THRESHOLD", lesion_gate.get_modelmeta().custom_metadata_map["threshold"]))
    print(f"Lesion gate loaded (threshold {LESION_GATE_THRESHOLD:.3f}).")
else:
    print(f"Lesion gate not found at {LESION_GATE_PATH}; relying on the model's own not-a-lesion output.")


def warm_up():
    """
    One dummy pass at startup so the first real request does not pay one-off costs (lazy kernel init, allocator
    growth). This keeps cold-start latency out of the telemetry.
    """
    if student is not None:
        student.run(None, {"input": np.zeros((1, 3, IMG_SIZE, IMG_SIZE), np.float32)})
    if lesion_gate is not None:
        lesion_gate.run(None, {"input": np.zeros((1, 3, GATE_SIZE, GATE_SIZE), np.float32)})


WARMED_UP = False
try:
    warm_up()
    WARMED_UP = True
except Exception:  # never block startup on warm-up
    traceback.print_exc()

# One voice note at a time: parallel decodes share the same CPU threads, so they gain little and multiply the RAM.
# With this queue and the memory arena off, 6 requests at once peak at 0.87 GB; with neither, 2.3 GB.
ASR_QUEUE = asyncio.Semaphore(1)
asr_model = None
if os.path.exists(os.path.join(ASR_MODEL_PATH, ENCODER_FILE)):
    if is_lfs_pointer(os.path.join(ASR_MODEL_PATH, ENCODER_FILE)):
        print(f"ASR model at {ASR_MODEL_PATH} is a Git LFS pointer. Run `git lfs pull` to enable transcription.")
    else:
        print(f"Loading ASR model from {ASR_MODEL_PATH} ...")
        asr_model = WhisperOnnx(ASR_MODEL_PATH, threads=THREADS)
        print("ASR model ready.")
else:
    print(f"ASR model not found at {ASR_MODEL_PATH}. Run export_server.py or `git lfs pull` to enable transcription.")


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
        "asr_model": os.path.basename(os.path.normpath(ASR_MODEL_PATH)) if asr_model is not None else "not loaded",
        "device": DEVICE,
        "runtime": f"onnxruntime {ort.__version__}",
        "classes": CLASS_NAMES,
        "model_version": MODEL_VERSION,
        "model_loaded": MODEL_LOADED,
        "lesion_gate": lesion_gate is not None,
        "warmed_up": WARMED_UP,
    }


@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    start_total = time.perf_counter()
    process = psutil.Process()
    ram_before = process.memory_info().rss / (1024 * 1024)

    if student is None:
        return JSONResponse(
            status_code=503,
            content={"error": "The skin model is not loaded on the inference service.", "code": "MODEL_NOT_LOADED"},
        )

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

    input_tensor = preprocess(pil_image, IMG_SIZE)
    preprocess_ms = int((time.perf_counter() - start_prep) * 1000)

    # Check 3: is this a photo of a skin condition at all? (general-image gate)
    lesion_gate_probability = None
    if lesion_gate is not None:
        lesion_gate_probability = float(lesion_gate.run(None, {"input": preprocess(pil_image, GATE_SIZE)})[0][0])
        if lesion_gate_probability >= LESION_GATE_THRESHOLD:
            return JSONResponse(
                status_code=400,
                content={
                    "error": "This photo does not look like a skin condition. Please take a close, clear photo of the affected skin.",
                    "code": "NOT_A_LESION",
                    "not_lesion_probability": round(lesion_gate_probability, 4),
                },
            )

    # ── Phase 2: Model Forward Pass (the Grad-CAM for the top disease comes out of the same pass) ──
    start_infer = time.perf_counter()
    full_logits, cam = student.run(["logits", "cam"], {"input": input_tensor})
    full_logits, cam = full_logits[0].astype(np.float64), cam[0]
    logits = full_logits[:NUM_CLASSES]
    probabilities = softmax(logits)
    not_lesion_probability = float(softmax(full_logits)[NUM_CLASSES]) if HAS_NOT_LESION_CLASS else None
    inference_ms = int((time.perf_counter() - start_infer) * 1000)

    all_scores = {name: round(float(probabilities[i]), 4) for i, name in enumerate(CLASS_NAMES)}

    sorted_indices = np.argsort(probabilities)[::-1]
    top_condition = CLASS_NAMES[int(sorted_indices[0])]
    confidence_score = float(probabilities[sorted_indices[0]])
    confidence_margin = confidence_score - float(probabilities[sorted_indices[1]])
    entropy = entropy_from_probs(probabilities.tolist())
    energy = float(np.logaddexp.reduce(logits))

    # ── Phase 3: Out-of-distribution / non-lesion check ──
    # A photo the model recognises as not a skin lesion at all (an object, a scene, a texture) is rejected like a
    # photo with no skin: the user is asked to retake it instead of getting a diagnosis.
    if not_lesion_probability is not None and is_not_a_lesion(not_lesion_probability):
        return JSONResponse(
            status_code=400,
            content={
                "error": "This photo does not look like a skin condition. Please take a close, clear photo of the affected skin.",
                "code": "NOT_A_LESION",
                "not_lesion_probability": round(not_lesion_probability, 4),
            },
        )
    status = assess_prediction(confidence_score, confidence_margin, entropy, energy)

    # ── Phase 4: Grad-CAM explainability heatmap ──
    start_cam = time.perf_counter()

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

    telemetry_data = {
        "image_preprocess_ms": preprocess_ms,
        "model_inference_ms": inference_ms,
        "gradcam_generation_ms": gradcam_ms,
        "total_server_time_ms": total_server_time_ms,
        "server_ram_used_mb": server_ram_used_mb,
        "gpu_vram_used_mb": 0.0,
        "device_type": DEVICE,
        "blur_score": round(blur_score, 1),
        "entropy": round(entropy, 3),
        "energy": round(energy, 3),
        "not_lesion_probability": round(not_lesion_probability, 4) if not_lesion_probability is not None else None,
        "lesion_gate_probability": round(lesion_gate_probability, 4) if lesion_gate_probability is not None else None,
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
    Reads WAV, WebM/Opus, OGG and MP4 alike: PyAV bundles FFmpeg, so nothing else has to be installed.
    """
    resampler = av.AudioResampler(format="flt", layout="mono", rate=target_sr)
    chunks = []
    with av.open(file_path) as container:
        if not container.streams.audio:
            raise RuntimeError(f"No audio stream in {file_path}")
        for frame in container.decode(container.streams.audio[0]):
            chunks += [f.to_ndarray().ravel() for f in resampler.resample(frame)]
    chunks += [f.to_ndarray().ravel() for f in resampler.resample(None)]
    return np.concatenate(chunks).astype(np.float32) if chunks else np.zeros(0, np.float32)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    print(f"\n[ASR] Incoming request: filename='{audio.filename}', content_type='{audio.content_type}'")
    
    if asr_model is None:
        print("[ASR] Rejected: asr_model is None (model not loaded).")
        return JSONResponse(
            status_code=503,
            content={"error": "ASR model not loaded. Run `git lfs pull` or inference/export_server.py first."},
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

        print("[ASR] Running Whisper on worker thread...")
        async with ASR_QUEUE:
            transcript_text = await asyncio.to_thread(asr_model.transcribe, audio_array)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
        print(f"[ASR] Whisper transcription completed in {elapsed_ms} ms")

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
    # Only exact "<uuid>.png" names are allowed, which rules out "..", "/" and "\"
    if not HEATMAP_FILENAME_REGEX.fullmatch(filename):
        return JSONResponse(status_code=404, content={"error": "Invalid heatmap identifier format"})


    heatmap_dir_abs = os.path.abspath(HEATMAP_DIR)
    path = os.path.abspath(os.path.join(heatmap_dir_abs, filename))

    # Second layer: the resolved path must stay inside the heatmaps folder
    # and must be a real file (not a directory)
    if os.path.commonpath([heatmap_dir_abs, path]) != heatmap_dir_abs or not os.path.isfile(path):
        return JSONResponse(status_code=404, content={"error": "Heatmap not found"})

    return FileResponse(path, media_type="image/png")



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)