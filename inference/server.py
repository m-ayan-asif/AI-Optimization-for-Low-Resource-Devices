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

CLIP_MODEL_NAME = "ViT-B-32-quickgelu"  # "-quickgelu" matches the activation the "openai" weights were trained with
CLIP_PRETRAINED = "openai"

# Zero-shot prompt variants per class (prompt ensembling — averaged into one
# embedding per class at startup). "No Disease" and "Unknown" give /predict_online
# real open-set classes instead of relying on the confidence-threshold hack in /predict.
CLIP_PROMPTS = {
    "Vitiligo": [
        "a photo of vitiligo, depigmented white patches on the skin",
        "a dermatology image of skin with irregular white patches from loss of pigment",
        "a close-up of skin showing patchy loss of melanin",
    ],
    "Melasma": [
        "a photo of melasma, brown or gray-brown patches on the face",
        "a dermatology image of facial skin hyperpigmentation in symmetric patches",
        "a close-up of blotchy, darkened skin discoloration on the cheeks or forehead",
    ],
    "Psoriasis": [
        "a photo of psoriasis, red scaly plaques on the skin",
        "a dermatology image of thick, silvery-scaled red skin lesions",
        "a close-up of inflamed, flaky raised skin patches",
    ],
    "Eczema": [
        "a photo of eczema, dry inflamed and itchy red skin",
        "a dermatology image of atopic dermatitis with cracked, irritated skin",
        "a close-up of red, scaly, inflamed skin patches",
    ],
    "Tinea": [
        "a photo of tinea, a ring-shaped fungal skin infection",
        "a dermatology image of a red, scaly, circular rash with a clear center",
        "a close-up of ringworm-like fungal skin lesion",
    ],
    "Contact Dermatitis": [
        "a photo of contact dermatitis, red irritated skin from an allergic reaction",
        "a dermatology image of inflamed skin with redness and swelling from irritation",
        "a close-up of a rash caused by skin contact with an irritant or allergen",
    ],
    "Seborrheic Dermatitis": [
        "a photo of seborrheic dermatitis, greasy yellowish scaly patches on the skin",
        "a dermatology image of flaky, oily skin inflammation",
        "a close-up of red skin with greasy yellow scales",
    ],
    "No Disease": [
        "a photo of clear, healthy skin with no visible skin condition",
        "a close-up of normal, smooth skin texture with no rash or lesion",
        "a photo of unblemished, healthy human skin",
    ],
    "Unknown": [
        "a photo of an unusual skin lesion that does not match a common skin condition",
        "a photo of skin with an unclear or unclassifiable abnormality",
        "an atypical skin image that is difficult to classify",
    ],
}
CLIP_CLASS_NAMES = list(CLIP_PROMPTS.keys())

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

print(f"Loading CLIP model {CLIP_MODEL_NAME} ({CLIP_PRETRAINED}) on {DEVICE}...")
clip_model, _, clip_preprocess = open_clip.create_model_and_transforms(
    CLIP_MODEL_NAME, pretrained=CLIP_PRETRAINED
)
clip_tokenizer = open_clip.get_tokenizer(CLIP_MODEL_NAME)
clip_model = clip_model.to(DEVICE)
clip_model.eval()

CLIP_PARAM_COUNT = sum(p.numel() for p in clip_model.parameters())
print(f"CLIP model loaded. Parameters: {CLIP_PARAM_COUNT:,}")


def _embed_clip_text(prompts):
    tokens = clip_tokenizer(prompts).to(DEVICE)
    with torch.no_grad():
        embeddings = clip_model.encode_text(tokens)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)
    return embeddings


# Precompute + cache one embedding per class (mean of its prompt variants) at
# startup so /predict_online only has to embed the incoming image/text per request.
with torch.no_grad():
    _class_embeddings = []
    for _class_name in CLIP_CLASS_NAMES:
        _variant_embeddings = _embed_clip_text(CLIP_PROMPTS[_class_name])
        _class_embedding = _variant_embeddings.mean(dim=0)
        _class_embedding = _class_embedding / _class_embedding.norm()
        _class_embeddings.append(_class_embedding)
    CLIP_TEXT_EMBEDDINGS = torch.stack(_class_embeddings).to(DEVICE)  # [num_clip_classes, embed_dim]

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
        "clip_model": f"{CLIP_MODEL_NAME} ({CLIP_PRETRAINED})",
        "clip_params": CLIP_PARAM_COUNT,
        "asr_model": "whisper-large-v3-turbo-urdu" if asr_pipe is not None else "not loaded",
        "device": str(DEVICE),
        "classes": CLASS_NAMES,
    }


def run_mobilenet_inference(pil_image: Image.Image) -> dict:
    """Shared MobileNetV3 forward pass used by both /predict and /predict_online."""
    start_time = time.time()

    input_tensor = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(input_tensor)
        probabilities = torchF.softmax(logits, dim=1)[0]

    all_scores = {}
    for i, name in enumerate(CLASS_NAMES):
        all_scores[name] = round(probabilities[i].item(), 4)

    top_idx = probabilities.argmax().item()
    top_condition = CLASS_NAMES[top_idx]
    confidence_score = float(probabilities[top_idx].item())
    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "top_condition": top_condition,
        "confidence_score": confidence_score,
        "all_scores": all_scores,
        "top_idx": top_idx,
        "latency_ms": latency_ms,
    }


def run_clip_inference(pil_image: Image.Image, symptom_text: Optional[str] = None) -> dict:
    """CLIP zero-shot classification against CLIP_CLASS_NAMES. If symptom_text is
    given, its text-similarity scores are averaged in with the image scores."""
    start_time = time.time()

    with torch.no_grad():
        image_tensor = clip_preprocess(pil_image).unsqueeze(0).to(DEVICE)
        image_features = clip_model.encode_image(image_tensor)
        image_features = image_features / image_features.norm(dim=-1, keepdim=True)

        logit_scale = clip_model.logit_scale.exp()
        image_logits = logit_scale * image_features @ CLIP_TEXT_EMBEDDINGS.T
        combined_probs = torchF.softmax(image_logits, dim=-1)[0]

        if symptom_text:
            text_tokens = clip_tokenizer([symptom_text]).to(DEVICE)
            text_features = clip_model.encode_text(text_tokens)
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
            text_logits = logit_scale * text_features @ CLIP_TEXT_EMBEDDINGS.T
            text_probs = torchF.softmax(text_logits, dim=-1)[0]
            combined_probs = (combined_probs + text_probs) / 2

    all_scores = {}
    for i, name in enumerate(CLIP_CLASS_NAMES):
        all_scores[name] = round(combined_probs[i].item(), 4)

    top_idx = combined_probs.argmax().item()
    top_condition = CLIP_CLASS_NAMES[top_idx]
    confidence_score = float(combined_probs[top_idx].item())
    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "top_condition": top_condition,
        "confidence_score": confidence_score,
        "all_scores": all_scores,
        "latency_ms": latency_ms,
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

    mobilenet_result = run_mobilenet_inference(pil_image)
    all_scores = mobilenet_result["all_scores"]
    top_idx = mobilenet_result["top_idx"]
    top_condition = mobilenet_result["top_condition"]
    confidence_score = mobilenet_result["confidence_score"]

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


@app.post("/predict_online")
async def predict_online(
    image: UploadFile = File(...),
    symptom_text: Optional[str] = Form(None),
):
    """Online-mode secondary opinion: runs MobileNetV3 and CLIP zero-shot side by
    side and reconciles them. Does not replace /predict — offline path is untouched."""
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

    mobilenet_result = run_mobilenet_inference(pil_image)
    clip_result = run_clip_inference(pil_image, symptom_text)

    # Generate Grad-CAM heatmap from the MobileNet path only — CLIP has no
    # heatmap in this pass.
    input_for_cam = inference_transform(pil_image).unsqueeze(0).to(DEVICE)
    cam, _ = grad_cam.generate(input_for_cam, class_idx=mobilenet_result["top_idx"])
    heatmap_id = str(uuid.uuid4())
    overlay = create_heatmap_overlay(pil_image, cam)
    heatmap_filename = f"{heatmap_id}.png"
    heatmap_path = os.path.join(HEATMAP_DIR, heatmap_filename)
    Image.fromarray(overlay).save(heatmap_path)

    agreement = mobilenet_result["top_condition"] == clip_result["top_condition"]

    # Reconciliation is placeholder logic pending real accuracy numbers from the
    # Week 4 benchmark: on agreement, average the two confidences with a small
    # boost (independent models agreeing is stronger evidence than either alone);
    # on disagreement, defer to whichever model was more confident.
    if agreement:
        boosted_confidence = min(
            1.0,
            ((mobilenet_result["confidence_score"] + clip_result["confidence_score"]) / 2) * 1.15,
        )
        reconciled_prediction = {
            "top_condition": mobilenet_result["top_condition"],
            "confidence_score": round(boosted_confidence, 4),
        }
    elif mobilenet_result["confidence_score"] >= clip_result["confidence_score"]:
        reconciled_prediction = {
            "top_condition": mobilenet_result["top_condition"],
            "confidence_score": round(mobilenet_result["confidence_score"], 4),
        }
    else:
        reconciled_prediction = {
            "top_condition": clip_result["top_condition"],
            "confidence_score": round(clip_result["confidence_score"], 4),
        }

    total_latency_ms = int((time.time() - total_start_time) * 1000)

    return {
        "mobilenet_prediction": {
            "top_condition": mobilenet_result["top_condition"],
            "confidence_score": round(mobilenet_result["confidence_score"], 4),
            "all_scores": mobilenet_result["all_scores"],
        },
        "clip_prediction": {
            "top_condition": clip_result["top_condition"],
            "confidence_score": round(clip_result["confidence_score"], 4),
            "all_scores": clip_result["all_scores"],
        },
        "reconciled_prediction": reconciled_prediction,
        "agreement": agreement,
        "heatmap_path": heatmap_filename,
        "mobilenet_latency_ms": mobilenet_result["latency_ms"],
        "clip_latency_ms": clip_result["latency_ms"],
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