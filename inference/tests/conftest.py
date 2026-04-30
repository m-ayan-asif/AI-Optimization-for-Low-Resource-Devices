"""
Shared fixtures for inference service tests.

Environment variables MUST be set before server.py is imported, because
model loading and asr_pipe initialisation happen at module level.
  - MODEL_PATH  → nonexistent path  → model uses random weights (fine for API shape tests)
  - ASR_MODEL_PATH → nonexistent dir → asr_pipe = None  → /transcribe returns 503
  - HEATMAP_DIR → real temp dir     → Grad-CAM images can be written
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


@pytest.fixture(scope="module")
def png_bytes():
    """Minimal 1×1 white RGB PNG (67 bytes)."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color=(200, 150, 100)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def jpeg_bytes():
    """Minimal 10×10 JPEG."""
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), color=(100, 150, 200)).save(buf, format="JPEG")
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
