"""
SkinSense ML Inference Service
Loads the distilled MobileNetV3-Large model and exposes a prediction API.
Called by the Express backend when a screening is submitted.
"""

import io
import os
import re
import time
import uuid
import tempfile
import traceback
from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as torchF
import torchvision.transforms as transforms
from torchvision import models
from PIL import Image
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import cv2
import soundfile as sf
from transformers import pipeline as hf_pipeline
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
import open_clip

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
LOW_CONFIDENCE_THRESHOLD = 0.30

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


# ── Skin Presence Validation ──────────────────────────────────────────
def is_skin_image(pil_image: Image.Image, min_skin_ratio: float = 0.15) -> bool:
    """
    Validates whether an image contains adequate skin tones across Fitzpatrick scales
    using joint HSV and YCrCb color space thresholding.
    """
    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)

    # HSV skin mask
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower_hsv = np.array([0, 15, 0], dtype=np.uint8)
    upper_hsv = np.array([25, 255, 255], dtype=np.uint8)
    mask_hsv = cv2.inRange(hsv, lower_hsv, upper_hsv)

    # YCrCb skin mask (effective across South Asian Fitzpatrick scales IV-VI)
    ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    lower_ycrcb = np.array([0, 133, 77], dtype=np.uint8)
    upper_ycrcb = np.array([255, 173, 127], dtype=np.uint8)
    mask_ycrcb = cv2.inRange(ycrcb, lower_ycrcb, upper_ycrcb)

    # Combined mask
    combined_mask = cv2.bitwise_and(mask_hsv, mask_ycrcb)
    skin_pixels = np.count_nonzero(combined_mask)
    total_pixels = img.shape[0] * img.shape[1]

    if total_pixels == 0:
        return False

    return (skin_pixels / total_pixels) >= min_skin_ratio


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
os.makedirs(HEATMAP_DIR, exist_ok=True)

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
    }


@app.post("/predict")
async def predict(image: UploadFile = File(...)):
    start_time = time.time()

    contents = await image.read()
    try:
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid image file"})

    # Validate that the image contains skin
    if not is_skin_image(pil_image):
        return JSONResponse(
            status_code=400,
            content={
                "error": "No skin detected. Please upload a clear photo of the affected skin area.",
                "code": "NO_SKIN_DETECTED"
            }
        )

    # Preprocess
    input_tensor = inference_transform(pil_image).unsqueeze(0).to(DEVICE)

    # Run inference
    with torch.no_grad():
        logits = model(input_tensor)
        probabilities = torchF.softmax(logits, dim=1)[0]

    all_scores = {}
    for i, name in enumerate(CLASS_NAMES):
        all_scores[name] = round(probabilities[i].item(), 4)

    top_idx = probabilities.argmax().item()
    top_condition = CLASS_NAMES[top_idx]
    confidence_score = float(probabilities[top_idx].item())

    # Generate Grad-CAM heatmap
    input_for_cam = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    cam, _ = grad_cam.generate(input_for_cam, class_idx=top_idx)

    heatmap_id = str(uuid.uuid4())
    overlay = create_heatmap_overlay(pil_image, cam)
    heatmap_filename = f"{heatmap_id}.png"
    heatmap_path = os.path.join(HEATMAP_DIR, heatmap_filename)
    Image.fromarray(overlay).save(heatmap_path)

    inference_time_ms = int((time.time() - start_time) * 1000)

    # Low confidence / Clear skin threshold (<= 30%)
    if confidence_score <= LOW_CONFIDENCE_THRESHOLD:
        return {
            "model_version": "mobilenetv3-large-distilled-v1",
            "top_condition": "No Disease / Inconclusive",
            "confidence_score": round(confidence_score, 4),
            "status": "out_of_scope",
            "all_scores": all_scores,
            "heatmap_path": heatmap_filename,
            "inference_time_ms": inference_time_ms,
        }

    return {
        "model_version": "mobilenetv3-large-distilled-v1",
        "top_condition": top_condition,
        "confidence_score": round(confidence_score, 4),
        "status": "classified",
        "all_scores": all_scores,
        "heatmap_path": heatmap_filename,
        "inference_time_ms": inference_time_ms,
    }


@app.post("/predict_fused")
async def predict_fused(
    image: UploadFile = File(...),
    symptom_text: str = Form(...),
    language: Optional[str] = Form(None),  # "en" | "ur" | "ro" — only needed to disambiguate
    # Latin-script English vs. Roman Urdu; Urdu script is auto-detected regardless of this value.
):
    """CLIP text-fusion: correlates the patient's symptom text with the image at prediction
    time via a small trained fusion head (see notebooks/07_clip_text_fusion_training.ipynb).
    Does not replace /predict — offline path is untouched."""
    if fusion_head is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Fusion head not loaded. Run notebooks/07_clip_text_fusion_training.ipynb first."},
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
    data, sr = sf.read(file_path, dtype="float32", always_2d=True)
    audio = data.mean(axis=1)
    if sr != target_sr:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
    return audio.astype(np.float32)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if asr_pipe is None:
        return JSONResponse(
            status_code=503,
            content={"error": "ASR model not loaded. Run inference/download_asr_model.py first."},
        )

    contents = await audio.read()
    if not contents:
        return JSONResponse(status_code=400, content={"error": "Empty audio file received."})

    suffix = Path(audio.filename).suffix if audio.filename else ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        audio_array = load_audio_wav(tmp_path)
        result = asr_pipe(
            {"array": audio_array, "sampling_rate": 16000},
            generate_kwargs={"language": "urdu", "task": "transcribe"},
        )

        transcript_text = result["text"].strip()
        tokens = transcript_text.split()
        keywords = list(dict.fromkeys(t for t in tokens if len(t) > 3))[:10]

        return {
            "transcript_text": transcript_text,
            "language": "ur",
            "confidence_score": 0.90,
            "keywords": keywords,
        }
    except Exception as e:
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