"""
Unit tests for utility functions in server.py.

Functions under test:
  load_audio_wav(path)
    Reads a WAV file with soundfile and returns a float32 numpy array at 16 kHz.
    Tests verify dtype, length (sample count), shape (1-D), and that silence
    decodes to all-zeros.

  GradCAM.generate(tensor, class_idx=None)
    Hooks into the last convolutional layer (model.features[-1]) to produce a
    class activation map.  The model runs with RANDOM weights in tests (no .pth
    file exists at MODEL_PATH), so prediction values are meaningless.  We assert
    only on structural properties that hold regardless of weights: the CAM is
    2-D, values are in [0, 1] (normalised), and a forced class_idx is honoured.

  create_heatmap_overlay(pil_image, cam)
    Blends the Grad-CAM heatmap over the original image using OpenCV colormaps.
    Tests verify: numpy array output, 3 channels (RGB), dimensions match
    IMG_SIZE, uint8 dtype, pixel values in [0, 255], and that degenerate all-zero
    or all-one CAMs don't crash or produce out-of-range values.

Helper _make_wav():
  Manually constructs a RIFF/WAV byte buffer and writes it to a temp file.
  Building the header by hand avoids any binary fixture file dependency.
"""

import io
import os
import struct
import tempfile

import numpy as np
import pytest

# Import helpers directly from the inference server module
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import load_audio_wav, create_heatmap_overlay, GradCAM, model, CLASS_NAMES


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_wav(num_samples: int, sample_rate: int = 16000) -> str:
    """Write a minimal silent WAV file to a temp path and return the path.

    The RIFF/WAV header is constructed manually using struct.pack so that
    each field offset is explicit and there is no dependency on an external
    audio library for fixture creation.
    """
    data_size = num_samples * 2
    buf = io.BytesIO()
    buf.write(b"RIFF"); buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE"); buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))            # PCM
    buf.write(struct.pack("<H", 1))            # mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))
    buf.write(struct.pack("<H", 2))
    buf.write(struct.pack("<H", 16))
    buf.write(b"data"); buf.write(struct.pack("<I", data_size))
    buf.write(b"\x00" * data_size)

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.write(buf.getvalue())
    tmp.close()
    return tmp.name


# ─── load_audio_wav ──────────────────────────────────────────────────────────

class TestLoadAudioWav:
    def test_success_returns_float32_array(self):
        path = _make_wav(16000)
        try:
            audio = load_audio_wav(path)
            assert audio.dtype == np.float32
        finally:
            os.unlink(path)

    def test_success_correct_sample_count_for_one_second(self):
        path = _make_wav(16000)
        try:
            audio = load_audio_wav(path)
            assert len(audio) == 16000
        finally:
            os.unlink(path)

    def test_success_silence_is_all_zeros(self):
        path = _make_wav(16000)
        try:
            audio = load_audio_wav(path)
            assert np.allclose(audio, 0.0)
        finally:
            os.unlink(path)

    def test_success_returns_1d_array(self):
        path = _make_wav(3200)
        try:
            audio = load_audio_wav(path)
            assert audio.ndim == 1
        finally:
            os.unlink(path)

    def test_success_short_clip(self):
        path = _make_wav(1600)  # 0.1 second
        try:
            audio = load_audio_wav(path)
            assert len(audio) == 1600
        finally:
            os.unlink(path)

    def test_error_file_not_found_raises(self):
        with pytest.raises(Exception):
            load_audio_wav("/nonexistent/path/to/audio.wav")


# ─── GradCAM ─────────────────────────────────────────────────────────────────

class TestGradCAM:
    # All tests in this class run the model forward pass with random weights.
    # The gradient-based CAM computation is deterministic for a given input
    # tensor, so the structural assertions (shape, range) are reliable even
    # though the selected class and CAM values change each test run.

    def test_success_cam_output_is_2d_numpy_array(self):
        import torch
        from torchvision import transforms
        from PIL import Image

        img = Image.new("RGB", (224, 224), color=(128, 64, 32))
        tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        tensor = tf(img).unsqueeze(0)

        cam, class_idx = GradCAM(model).generate(tensor)
        assert cam.ndim == 2

    def test_success_cam_values_are_between_0_and_1(self):
        import torch
        from torchvision import transforms
        from PIL import Image

        img = Image.new("RGB", (224, 224), color=(200, 100, 50))
        tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        tensor = tf(img).unsqueeze(0)

        cam, _ = GradCAM(model).generate(tensor)
        assert cam.min() >= 0.0
        assert cam.max() <= 1.0

    def test_success_class_idx_is_within_valid_range(self):
        import torch
        from torchvision import transforms
        from PIL import Image

        img = Image.new("RGB", (224, 224))
        tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        tensor = tf(img).unsqueeze(0)

        _, class_idx = GradCAM(model).generate(tensor)
        assert 0 <= class_idx < len(CLASS_NAMES)

    def test_success_explicit_class_idx_is_respected(self):
        import torch
        from torchvision import transforms
        from PIL import Image

        img = Image.new("RGB", (224, 224))
        tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])
        tensor = tf(img).unsqueeze(0)

        _, returned_idx = GradCAM(model).generate(tensor, class_idx=2)
        assert returned_idx == 2


# ─── create_heatmap_overlay ───────────────────────────────────────────────────

class TestCreateHeatmapOverlay:
    def _make_inputs(self):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (100, 100), color=(100, 150, 200))
        cam = np.random.rand(14, 14).astype(np.float32)
        return img, cam

    def test_success_output_is_numpy_array(self):
        img, cam = self._make_inputs()
        overlay = create_heatmap_overlay(img, cam)
        assert isinstance(overlay, np.ndarray)

    def test_success_output_has_three_channels(self):
        img, cam = self._make_inputs()
        overlay = create_heatmap_overlay(img, cam)
        assert overlay.ndim == 3
        assert overlay.shape[2] == 3

    def test_success_output_dimensions_match_img_size(self):
        from server import IMG_SIZE
        img, cam = self._make_inputs()
        overlay = create_heatmap_overlay(img, cam)
        assert overlay.shape[0] == IMG_SIZE
        assert overlay.shape[1] == IMG_SIZE

    def test_success_output_pixel_values_are_uint8(self):
        img, cam = self._make_inputs()
        overlay = create_heatmap_overlay(img, cam)
        assert overlay.dtype == np.uint8

    def test_success_pixel_values_are_in_valid_range(self):
        img, cam = self._make_inputs()
        overlay = create_heatmap_overlay(img, cam)
        assert overlay.min() >= 0
        assert overlay.max() <= 255

    def test_edge_all_zero_cam_produces_valid_overlay(self):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (50, 50), color=(0, 0, 0))
        cam = np.zeros((7, 7), dtype=np.float32)
        overlay = create_heatmap_overlay(img, cam)
        assert overlay.dtype == np.uint8

    def test_edge_all_one_cam_produces_valid_overlay(self):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (50, 50), color=(255, 255, 255))
        cam = np.ones((7, 7), dtype=np.float32)
        overlay = create_heatmap_overlay(img, cam)
        assert overlay.dtype == np.uint8
