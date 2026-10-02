"""
Shared fixtures for all inference service tests (pytest conftest).

Why env vars must be set before importing server.py:
  MobileNetV3 and the Whisper ASR pipeline are loaded at module level when
  server.py is first imported.  Setting the env vars beforehand controls what
  happens during that import:
    MODEL_PATH     → nonexistent .pth file → model initialises with random weights.
                     The API shape (output keys, HTTP codes) is fully exercised;
                     the actual prediction values are meaningless but that's fine.
    ASR_MODEL_PATH → nonexistent directory → asr_pipe is set to None, so every
                     /transcribe request returns 503.  Tests verify this contract.
    HEATMAP_DIR    → a real temporary directory → Grad-CAM PNGs can be written
                     to disk and subsequently served by GET /heatmaps/{filename}.

Fixture scope is "module" so the FastAPI TestClient and image/audio byte
buffers are created once per test module, not once per test function.
"""

import io
import os
import struct
import sys
import tempfile

import pytest

# ── Point paths at non-existent locations so the server starts without downloads
_tmp_heatmap_dir = tempfile.mkdtemp(prefix="skinsense_test_heatmaps_")
os.environ.setdefault("MODEL_PATH", "/nonexistent/model.pth")
os.environ.setdefault("ASR_MODEL_PATH", "/nonexistent/asr")
os.environ["HEATMAP_DIR"] = _tmp_heatmap_dir
os.environ.setdefault("INFERENCE_PORT", "5002")

# Add the inference root to sys.path so `from server import app` works
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402 (must come after env setup)
from server import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    """TestClient for the FastAPI app.  No real model weights are loaded."""
    return TestClient(app)


def _skin_texture(size=(64, 64), base=(200, 150, 100), seed=0):
    """
    Skin-toned image with fine texture.

    Solid-colour images are rejected by the runtime guards (Laplacian variance
    of a flat image is 0, i.e. "too blurry"), so fixtures need realistic detail
    while staying inside the HSV + YCrCb skin range.
    """
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 12, size=(size[1], size[0], 1))
    arr = np.clip(np.array(base, dtype=float) + noise, 0, 255).astype("uint8")
    return Image.fromarray(arr, "RGB")


@pytest.fixture(scope="module")
def png_bytes():
    """64x64 textured skin-tone PNG that passes the skin and blur guards."""
    buf = io.BytesIO()
    _skin_texture().save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def jpeg_bytes():
    """64x64 textured skin-tone JPEG that passes the skin and blur guards."""
    buf = io.BytesIO()
    _skin_texture(seed=1).save(buf, format="JPEG", quality=95)
    return buf.getvalue()


@pytest.fixture(scope="module")
def blurry_png_bytes():
    """Skin-tone image with no detail (flat colour): must be rejected as too blurry."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), color=(200, 150, 100)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def non_skin_png_bytes():
    """Textured blue image: must be rejected as containing no skin."""
    import numpy as np
    from PIL import Image
    rng = np.random.default_rng(3)
    arr = np.clip(np.array([30, 60, 200], dtype=float) + rng.normal(0, 12, (64, 64, 1)), 0, 255).astype("uint8")
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def wav_bytes():
    """Minimal 16 kHz mono WAV with 0.1 s of silence."""
    sample_rate = 16000
    num_samples = 1600  # 0.1 second
    data_size = num_samples * 2  # 16-bit samples

    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))          # chunk size
    buf.write(struct.pack("<H", 1))           # PCM
    buf.write(struct.pack("<H", 1))           # mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))
    buf.write(struct.pack("<H", 2))           # block align
    buf.write(struct.pack("<H", 16))          # bits per sample
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(b"\x00" * data_size)
    return buf.getvalue()


