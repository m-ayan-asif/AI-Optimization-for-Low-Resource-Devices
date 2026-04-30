"""
Unit tests for utility functions in server.py.

Focuses on:
  - load_audio_wav  – reads a WAV file and returns a float32 array at 16 kHz
  - encodePcmWav logic (tested indirectly via WAV round-trip)
  - GradCAM output shape and value range
  - create_heatmap_overlay output shape
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
    """Write a silent WAV file to a temp path and return the path."""
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
