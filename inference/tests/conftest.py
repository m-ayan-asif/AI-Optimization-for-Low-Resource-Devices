"""
Shared fixtures for all inference service tests (pytest conftest).

Why env vars must be set before importing server.py:
  The ONNX sessions are created at module level when server.py is first imported.
  Setting the env vars beforehand controls what happens during that import:
    MODEL_PATH     -> a tiny ONNX model built right here (random weights, same inputs and outputs as the real student).
                      The API shape (output keys, HTTP codes) is fully exercised on a real ONNX Runtime session without
                      Git LFS; the prediction values are meaningless but that's fine. tests/test_real_models.py checks
                      the real files when they are present.
    ASR_MODEL_PATH -> nonexistent directory -> asr_model is None, so every
                      /transcribe request returns 503.  Tests verify this contract.
    HEATMAP_DIR    -> a real temporary directory -> Grad-CAM PNGs can be written
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


def _write_fake_student(path):
    """(1, 3, 320, 320) -> logits (1, 8) + cam (1, 10, 10), like the real student. Near-uniform: not-a-lesion stays low."""
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    rng = np.random.default_rng(0)
    bias = np.zeros(8, np.float32)
    bias[7] = -8.0
    cam = rng.random((1, 10, 10)).astype(np.float32)
    initializers = [
        numpy_helper.from_array(rng.normal(0, 0.02, (3, 8)).astype(np.float32), "weights"),
        numpy_helper.from_array(bias, "bias"),
        numpy_helper.from_array(cam / cam.max(), "cam_values"),
    ]
    nodes = [
        helper.make_node("ReduceMean", ["input"], ["pooled"], axes=[2, 3], keepdims=0),
        helper.make_node("MatMul", ["pooled", "weights"], ["scores"]),
        helper.make_node("Add", ["scores", "bias"], ["logits"]),
        helper.make_node("Identity", ["cam_values"], ["cam"]),
    ]
    graph = helper.make_graph(
        nodes, "fake_student",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, 320, 320])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, [1, 8]),
         helper.make_tensor_value_info("cam", TensorProto.FLOAT, [1, 10, 10])],
        initializers,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.save(model, path)


# ── Set before server.py is imported; the real files must not leak in from the developer's environment
_tmp_dir = tempfile.mkdtemp(prefix="skinsense_test_")
os.environ["MODEL_PATH"] = os.path.join(_tmp_dir, "fake_student.onnx")
_write_fake_student(os.environ["MODEL_PATH"])
os.environ["ASR_MODEL_PATH"] = "/nonexistent/asr"
os.environ["LESION_GATE_PATH"] = "/nonexistent/lesion_gate.onnx"  # tests patch the gate in explicitly
os.environ["HEATMAP_DIR"] = os.path.join(_tmp_dir, "heatmaps")
os.environ.setdefault("INFERENCE_PORT", "5002")

# Add the inference root to sys.path so `from server import app` works
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402 (must come after env setup)
from server import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    """TestClient for the FastAPI app, running the tiny test model."""
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


