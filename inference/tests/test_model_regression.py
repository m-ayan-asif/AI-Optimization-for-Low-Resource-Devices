import io
import math
import numpy as np
import pytest
from PIL import Image, ImageEnhance
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def create_synthetic_lesion_image(tone=(180, 130, 90), pattern="erythema"):
    """Generates a synthetic 320x320 skin lesion image with texture."""
    arr = np.full((320, 320, 3), tone, dtype=np.uint8)
    rng = np.random.default_rng(42)
    noise = rng.normal(0, 15, (320, 320, 3)).astype(np.int16)
    arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)

    # Inject lesion spot in center
    y, x = np.ogrid[:320, :320]
    mask = ((x - 160) ** 2 + (y - 160) ** 2) <= 50 ** 2
    if pattern == "erythema":
        arr[mask, 0] = np.clip(arr[mask, 0] + 50, 0, 255) # Reddening
        arr[mask, 1] = np.clip(arr[mask, 1] - 20, 0, 255)
    return Image.fromarray(arr, "RGB")

def to_bytes(img: Image.Image, fmt="PNG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()

class TestGoldenSetRobustness:
    def test_baseline_synthetic_lesion_passes_guards(self):
        img = create_synthetic_lesion_image()
        res = client.post("/predict", files={"image": ("lesion.png", to_bytes(img), "image/png")})
        assert res.status_code == 200
        body = res.json()
        assert "top_condition" in body
        assert body["status"] in ("classified", "out_of_scope")

    def test_dark_illumination_perturbation(self):
        """Simulate low-light clinic photo (50% brightness reduction)."""
        img = create_synthetic_lesion_image()
        dark_img = ImageEnhance.Brightness(img).enhance(0.4)
        res = client.post("/predict", files={"image": ("dark.png", to_bytes(dark_img), "image/png")})
        # Passes skin guard or fails gracefully without 500 error
        assert res.status_code in (200, 400)
        if res.status_code == 400:
            assert res.json()["code"] == "NO_SKIN_DETECTED"

    def test_motion_blur_perturbation(self):
        """Simulate camera jitter with heavy Gaussian blur."""
        import cv2
        img = create_synthetic_lesion_image()
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        blurred = cv2.GaussianBlur(cv_img, (31, 31), 15)
        blurred_pil = Image.fromarray(cv2.cvtColor(blurred, cv2.COLOR_BGR2RGB))

        res = client.post("/predict", files={"image": ("blur.png", to_bytes(blurred_pil), "image/png")})
        assert res.status_code == 400
        assert res.json()["code"] == "IMAGE_TOO_BLURRY"

    def test_rotation_invariance_response_shape(self):
        """Rotate input 90 degrees; output contract must remain stable."""
        img = create_synthetic_lesion_image()
        rotated = img.rotate(90)
        res = client.post("/predict", files={"image": ("rot.png", to_bytes(rotated), "image/png")})
        assert res.status_code == 200
        data = res.json()
        assert len(data["all_scores"]) == 7