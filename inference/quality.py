"""
Torch-free image-quality and prediction-quality helpers for the inference service.

Kept separate from server.py so they can be unit-tested (and reused) without
loading PyTorch or the model weights.
"""
import math
from typing import Iterable

import cv2
import numpy as np
from PIL import Image

# ── Thresholds (calibrate on a labelled set of good / blurry / non-skin images) ──
MIN_SKIN_RATIO = 0.15
BLUR_REJECT_THRESHOLD = 20.0      # Laplacian variance below this => too blurry
BLUR_MAX_SIDE = 512               # measure blur at a bounded resolution
LOW_CONFIDENCE_THRESHOLD = 0.30
OOD_ENTROPY_THRESHOLD = 1.65      # ln(7) = 1.946 is the maximum for 7 classes
OOD_MARGIN_THRESHOLD = 0.08

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec"


def is_skin_image(pil_image: Image.Image, min_skin_ratio: float = MIN_SKIN_RATIO) -> bool:
    """Joint HSV + YCrCb skin-tone check (covers Fitzpatrick types IV-VI)."""
    img = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    total_pixels = img.shape[0] * img.shape[1]
    if total_pixels == 0:
        return False

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask_hsv = cv2.inRange(hsv, np.array([0, 15, 0], np.uint8), np.array([25, 255, 255], np.uint8))

    ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
    mask_ycrcb = cv2.inRange(ycrcb, np.array([0, 133, 77], np.uint8), np.array([255, 173, 127], np.uint8))

    skin_pixels = np.count_nonzero(cv2.bitwise_and(mask_hsv, mask_ycrcb))
    return bool((skin_pixels / total_pixels) >= min_skin_ratio)


def check_image_blur(cv_image: np.ndarray, max_side: int = BLUR_MAX_SIDE) -> float:
    """
    Variance of the Laplacian (higher = sharper).

    The image is first shrunk so its longest side is at most `max_side`. Without
    this the score depends on the camera resolution (a 12 MP phone photo and a
    1 MP photo of the same scene get very different values) and large images cost
    needlessly more CPU. Images already smaller than max_side are not upscaled.
    """
    gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    longest = max(h, w)
    if longest > max_side:
        scale = max_side / float(longest)
        gray = cv2.resize(gray, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def is_too_blurry(blur_score: float, threshold: float = BLUR_REJECT_THRESHOLD) -> bool:
    return blur_score < threshold


def entropy_from_probs(probabilities: Iterable[float]) -> float:
    """Shannon entropy (nats). Flat distribution => high, confident peak => low."""
    entropy = 0.0
    for p in probabilities:
        if p > 1e-6:
            entropy -= p * math.log(p)
    return entropy


def assess_prediction(confidence: float, margin: float, entropy: float) -> str:
    """
    Decide whether a prediction can be shown as a classification.

    Returns "out_of_scope" when the model is guessing (low top-1 confidence, or a
    near-uniform distribution with a negligible lead over the runner-up).
    """
    if confidence <= LOW_CONFIDENCE_THRESHOLD:
        return "out_of_scope"
    if entropy > OOD_ENTROPY_THRESHOLD and margin < OOD_MARGIN_THRESHOLD:
        return "out_of_scope"
    return "classified"


def is_lfs_pointer(path: str) -> bool:
    """True if `path` is a Git LFS pointer text file rather than real weights."""
    try:
        with open(path, "rb") as fh:
            return fh.read(len(LFS_POINTER_PREFIX)) == LFS_POINTER_PREFIX
    except OSError:
        return False
