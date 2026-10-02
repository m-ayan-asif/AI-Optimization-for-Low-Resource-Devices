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
from typing import Optional

import cv2
import numpy as np
import psutil
import soundfile as sf
import torch
import torch.nn as nn
import torch.nn.functional as torchF
import torchvision.transforms as transforms
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image
from torchvision import models
from transformers import pipeline as hf_pipeline
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
import open_clip

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


# ── Branch B: CLIP text-fusion config ──────────────────────────────────
CLIP_MODEL_NAME = "ViT-B-32-quickgelu"  # matches branches A/C — "-quickgelu" matches the "openai" weights' activation
CLIP_PRETRAINED = "openai"
FUSION_HEAD_PATH = os.environ.get("FUSION_HEAD_PATH", "./models/fusion_head.pth")
FUSION_HIDDEN_DIM = 256

# Roman Urdu -> Urdu script (verified against real symptom phrases before adopting; see
# notebooks/07_clip_text_fusion_training.ipynb for the comparison that ruled out the
# alternatives — a single-researcher checkpoint from a March 2025 paper, not an established lab)
TRANSLITERATION_MODEL = "Mavkif/m2m100_rup_rur_to_ur"
TRANSLITERATION_TOKENIZER = "Mavkif/m2m100_rup_tokenizer_both"

# Urdu script -> English. NLLB was chosen over the smaller Helsinki-NLP/opus-mt-ur-en after
# testing both on real symptom phrases: opus-mt-ur-en mistranslated exactly the clinical
# vocabulary that matters ("itching" -> "signing", "redness" -> "black"), NLLB did not.
TRANSLATION_MODEL = "facebook/nllb-200-distilled-600M"

# Urdu script uses Arabic-block Unicode codepoints — deterministic to detect regardless of
# what a caller-supplied language hint says. Latin-script text (English vs. Roman Urdu) can't
# be told apart by character content alone, so that case relies on the `language` hint instead.
URDU_SCRIPT_PATTERN = re.compile(r"[؀-ۿݐ-ݿ]")


def contains_urdu_script(text: str) -> bool:
    return bool(URDU_SCRIPT_PATTERN.search(text))


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


class FusionHead(nn.Module):
    """Matches notebooks/07_clip_text_fusion_training.ipynb's FusionHead exactly —
    architecture must stay in sync with that notebook for fusion_head.pth to load."""

    def __init__(self, image_dim=512, text_dim=512, hidden_dim=FUSION_HIDDEN_DIM, num_classes=NUM_CLASSES):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(image_dim + text_dim, hidden_dim),
            nn.Hardswish(),
            nn.Dropout(p=0.3),
            nn.Linear(hidden_dim, num_classes),
        )

    def forward(self, image_features, text_features):
        combined = torch.cat([image_features, text_features], dim=-1)
        return self.net(combined)


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

# ── Branch B: CLIP text-fusion models ──────────────────────────────────
# Loaded only if a trained fusion head exists — otherwise /predict_fused stays disabled and
# none of these (CLIP + two translation models, ~800M+ params combined) are worth loading.
clip_model = None
clip_tokenizer = None
translit_model = None
translit_tokenizer = None
translit_roman_ur_id = None
translit_ur_id = None
translation_model = None
translation_tokenizer = None
translation_eng_id = None
fusion_head = None

if os.path.exists(FUSION_HEAD_PATH):
    print(f"Loading CLIP {CLIP_MODEL_NAME} ({CLIP_PRETRAINED}) for text-fusion...")
    clip_model, _, _ = open_clip.create_model_and_transforms(CLIP_MODEL_NAME, pretrained=CLIP_PRETRAINED)
    clip_tokenizer = open_clip.get_tokenizer(CLIP_MODEL_NAME)
    clip_model = clip_model.to(DEVICE)
    clip_model.eval()
    for param in clip_model.parameters():
        param.requires_grad = False

    print(f"Loading Roman Urdu transliterator {TRANSLITERATION_MODEL}...")
    translit_tokenizer = M2M100Tokenizer.from_pretrained(TRANSLITERATION_TOKENIZER)
    translit_model = M2M100ForConditionalGeneration.from_pretrained(TRANSLITERATION_MODEL)
    translit_model = translit_model.to(DEVICE)
    translit_model.eval()
    # transformers' get_lang_id() only knows a fixed built-in language list and doesn't
    # recognize this fine-tune's custom "roman-ur" code, so both ids are resolved directly.
    translit_roman_ur_id = translit_tokenizer.convert_tokens_to_ids("__roman-ur__")
    translit_ur_id = translit_tokenizer.convert_tokens_to_ids("__ur__")

    print(f"Loading Urdu->English translator {TRANSLATION_MODEL}...")
    translation_tokenizer = AutoTokenizer.from_pretrained(TRANSLATION_MODEL, src_lang="urd_Arab")
    translation_model = AutoModelForSeq2SeqLM.from_pretrained(TRANSLATION_MODEL)
    translation_model = translation_model.to(DEVICE)
    translation_model.eval()
    translation_eng_id = translation_tokenizer.convert_tokens_to_ids("eng_Latn")

    fusion_head = FusionHead(image_dim=512, text_dim=512)
    fusion_head.load_state_dict(torch.load(FUSION_HEAD_PATH, map_location=DEVICE, weights_only=True))
    fusion_head = fusion_head.to(DEVICE)
    fusion_head.eval()
    print(f"Fusion head loaded from {FUSION_HEAD_PATH} ({sum(p.numel() for p in fusion_head.parameters()):,} params).")
else:
    print(f"Fusion head not found at {FUSION_HEAD_PATH}. Run notebooks/07_clip_text_fusion_training.ipynb "
          f"to enable /predict_fused. CLIP and translation models not loaded.")


@torch.no_grad()
def transliterate_roman_urdu_to_urdu(text: str) -> str:
    ids = translit_tokenizer(text, add_special_tokens=False)["input_ids"]
    input_ids = torch.tensor([[translit_roman_ur_id] + ids + [translit_tokenizer.eos_token_id]]).to(DEVICE)
    generated = translit_model.generate(input_ids, forced_bos_token_id=translit_ur_id, max_new_tokens=128)
    return translit_tokenizer.batch_decode(generated, skip_special_tokens=True)[0]


@torch.no_grad()
def translate_urdu_to_english(text: str) -> str:
    encoded = translation_tokenizer(text, return_tensors="pt").to(DEVICE)
    generated = translation_model.generate(**encoded, forced_bos_token_id=translation_eng_id, max_new_tokens=128)
    return translation_tokenizer.batch_decode(generated, skip_special_tokens=True)[0]


def normalize_symptom_text_to_english(text: str, language: Optional[str]) -> tuple[str, str]:
    """Returns (english_text, pipeline_used). Urdu script is auto-detected from the text
    itself; Roman Urdu vs. English (both Latin script) relies on the `language` hint since
    character content alone can't distinguish them."""
    if contains_urdu_script(text):
        return translate_urdu_to_english(text), "nllb_ur_en"
    if language == "ro":
        urdu_text = transliterate_roman_urdu_to_urdu(text)
        return translate_urdu_to_english(urdu_text), "roman_ur_translit+nllb_ur_en"
    return text, "none"


@torch.no_grad()
def extract_mobilenet_features(image_tensor):
    """Runs the student up through its 512-dim penultimate layer (classifier[0] + Hardswish),
    stopping before Dropout + the final 7-class Linear. Must match
    notebooks/07_clip_text_fusion_training.ipynb's extract_mobilenet_features exactly."""
    x = model.features(image_tensor)
    x = model.avgpool(x)
    x = torch.flatten(x, 1)
    x = model.classifier[0](x)
    x = model.classifier[1](x)
    return x


@torch.no_grad()
def embed_symptom_text_clip(text: str):
    tokens = clip_tokenizer([text]).to(DEVICE)
    embeddings = clip_model.encode_text(tokens)
    embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)
    return embeddings


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
        "fusion_head": f"{CLIP_MODEL_NAME} ({CLIP_PRETRAINED}) + FusionHead" if fusion_head is not None else "not loaded",
        "translation_models": {
            "roman_ur_to_ur": TRANSLITERATION_MODEL if translit_model is not None else "not loaded",
            "ur_to_en": TRANSLATION_MODEL if translation_model is not None else "not loaded",
        },
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


@app.post("/predict_fused")
async def predict_fused(
    image: UploadFile = File(...),
    symptom_text: str = Form(...),
    language: Optional[str] = Form(None),  # "en" | "ur" | "ro" — only needed to disambiguate
    # Latin-script English vs. Roman Urdu; Urdu script is auto-detected regardless of this value.
    acknowledge_experimental: bool = Form(False),
):
    """CLIP text-fusion: correlates the patient's symptom text with the image at prediction
    time via a small trained fusion head (see notebooks/07_clip_text_fusion_training.ipynb).
    Does not replace /predict — offline path is untouched.

    EXPERIMENTAL GUARDRAIL: the fusion head was trained on synthetic, template-generated
    patient-phrased symptom text (no real paired image+symptom-text dataset exists yet —
    see the training notebook's own caveat). Benchmarked test accuracy (95.08%) reflects
    that synthetic text, not validated real patient language, so callers must explicitly
    acknowledge this before the endpoint will run.
    """
    if fusion_head is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Fusion head not loaded. Run notebooks/07_clip_text_fusion_training.ipynb first."},
        )

    if not acknowledge_experimental:
        return JSONResponse(
            status_code=412,
            content={
                "error": (
                    "This endpoint is experimental: the text-fusion model was trained on "
                    "synthetic, template-generated symptom text, not real patient language. "
                    "Pass acknowledge_experimental=true to proceed anyway."
                ),
                "code": "EXPERIMENTAL_ACKNOWLEDGEMENT_REQUIRED",
            },
        )

    total_start_time = time.time()

    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid image file"})

    if not is_skin_image(pil_image):
        return JSONResponse(
            status_code=400,
            content={
                "error": "No skin detected. Please upload a clear photo of the affected skin area.",
                "code": "NO_SKIN_DETECTED"
            }
        )

    translation_start_time = time.time()
    english_text, text_pipeline_used = normalize_symptom_text_to_english(symptom_text, language)
    translation_latency_ms = int((time.time() - translation_start_time) * 1000)

    fusion_start_time = time.time()
    input_tensor = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        image_features = extract_mobilenet_features(input_tensor)
        text_features = embed_symptom_text_clip(english_text)
        fused_logits = fusion_head(image_features, text_features)
        fused_probs = torchF.softmax(fused_logits, dim=1)[0]
    fusion_latency_ms = int((time.time() - fusion_start_time) * 1000)

    all_scores = {}
    for i, name in enumerate(CLASS_NAMES):
        all_scores[name] = round(fused_probs[i].item(), 4)

    top_idx = fused_probs.argmax().item()
    top_condition = CLASS_NAMES[top_idx]
    confidence_score = float(fused_probs[top_idx].item())

    # Heatmap from the MobileNet/image branch only — same pattern as /predict and C's /predict_online.
    input_for_cam = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    cam, _ = grad_cam.generate(input_for_cam, class_idx=top_idx)
    heatmap_id = str(uuid.uuid4())
    overlay = create_heatmap_overlay(pil_image, cam)
    heatmap_filename = f"{heatmap_id}.png"
    heatmap_path = os.path.join(HEATMAP_DIR, heatmap_filename)
    Image.fromarray(overlay).save(heatmap_path)

    total_latency_ms = int((time.time() - total_start_time) * 1000)

    return {
        "model_version": "clip-text-fusion-v1",
        "experimental": True,
        "experimental_caveat": (
            "Fusion head trained on synthetic, template-generated symptom text — "
            "confidence is not validated against real patient language."
        ),
        "top_condition": top_condition,
        "confidence_score": round(confidence_score, 4),
        "all_scores": all_scores,
        "symptom_text_original": symptom_text,
        "symptom_text_english": english_text,
        "text_pipeline_used": text_pipeline_used,
        "heatmap_path": heatmap_filename,
        "translation_latency_ms": translation_latency_ms,
        "fusion_latency_ms": fusion_latency_ms,
        "total_latency_ms": total_latency_ms,
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