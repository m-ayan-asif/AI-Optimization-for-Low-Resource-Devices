"""
Unit tests for utility functions in server.py.

Functions under test:
  load_audio_wav(path)
    Decodes any audio container with PyAV and returns a float32 numpy array at 16 kHz.
    Tests verify dtype, length (sample count), shape (1-D), resampling, down-mixing,
    browser WebM/Opus, and that silence decodes to all-zeros.

  preprocess(pil_image, size), softmax(logits)
    What torchvision and torch used to do for the model's input and output.

  student (the ONNX session)
    Returns the logits and the Grad-CAM.  The real graph computes the CAM in closed
    form (export_mobile.py, checked against hook-based Grad-CAM when exported); here
    we assert the shape the service relies on: the CAM is 2-D with values in [0, 1].

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

import server
from server import load_audio_wav, create_heatmap_overlay, preprocess, softmax, IMG_SIZE


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_wav(num_samples: int, sample_rate: int = 16000, channels: int = 1) -> str:
    """Write a minimal silent WAV file to a temp path and return the path.

    The RIFF/WAV header is constructed manually using struct.pack so that
    each field offset is explicit and there is no dependency on an external
    audio library for fixture creation.
    """
    data_size = num_samples * 2 * channels
    buf = io.BytesIO()
    buf.write(b"RIFF"); buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE"); buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))
    buf.write(struct.pack("<H", 1))            # PCM
    buf.write(struct.pack("<H", channels))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2 * channels))
    buf.write(struct.pack("<H", 2 * channels))
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

    def test_error_not_audio_raises(self):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(b"this is not audio at all")
        try:
            with pytest.raises(Exception):
                load_audio_wav(tmp.name)
        finally:
            os.unlink(tmp.name)

    def test_success_other_sample_rates_are_resampled_to_16k(self):
        path = _make_wav(44100, sample_rate=44100)  # one second
        try:
            assert abs(len(load_audio_wav(path)) - 16000) <= 32
        finally:
            os.unlink(path)

    def test_success_stereo_is_down_mixed_to_one_channel(self):
        path = _make_wav(16000, channels=2)
        try:
            audio = load_audio_wav(path)
            assert audio.ndim == 1
            assert len(audio) == 16000
        finally:
            os.unlink(path)

    def test_success_decodes_browser_webm_opus(self):
        # MediaRecorder's format on Chrome and Android: 0.5 s of a 440 Hz tone
        import av
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
            path = tmp.name
        try:
            with av.open(path, "w", format="webm") as out:
                stream = out.add_stream("libopus", rate=48000)
                t = np.arange(24000) / 48000
                frame = av.AudioFrame.from_ndarray((0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)[None], format="flt", layout="mono")
                frame.sample_rate = 48000
                for packet in list(stream.encode(frame)) + list(stream.encode(None)):
                    out.mux(packet)
            audio = load_audio_wav(path)
            assert abs(len(audio) - 8000) < 1600
            assert np.abs(audio).max() > 0.1
        finally:
            os.unlink(path)


# ─── Preprocessing and the student session ───────────────────────────────────

class TestPreprocess:
    def test_success_shape_and_dtype(self):
        from PIL import Image
        x = preprocess(Image.new("RGB", (100, 60), color=(128, 64, 32)), IMG_SIZE)
        assert x.shape == (1, 3, IMG_SIZE, IMG_SIZE)
        assert x.dtype == np.float32

    def test_success_applies_imagenet_normalisation(self):
        from PIL import Image
        x = preprocess(Image.new("RGB", (8, 8), color=(255, 0, 128)), 4)
        assert x[0, 0, 0, 0] == pytest.approx((1.0 - 0.485) / 0.229, abs=1e-5)
        assert x[0, 1, 0, 0] == pytest.approx((0.0 - 0.456) / 0.224, abs=1e-5)
        assert x[0, 2, 0, 0] == pytest.approx((128 / 255 - 0.406) / 0.225, abs=1e-5)


class TestSoftmax:
    def test_success_sums_to_one_and_matches_the_definition(self):
        logits = np.array([1.0, 2.0, 3.0])
        expected = np.exp(logits) / np.exp(logits).sum()
        assert softmax(logits) == pytest.approx(expected)

    def test_edge_huge_logits_do_not_overflow(self):
        p = softmax(np.array([1000.0, 0.0]))
        assert p == pytest.approx([1.0, 0.0])


class TestStudentSession:
    def _run(self):
        return server.student.run(["logits", "cam"], {"input": np.zeros((1, 3, IMG_SIZE, IMG_SIZE), np.float32)})

    def test_success_returns_logits_for_every_output(self):
        logits, _ = self._run()
        assert logits.shape == (1, server.NUM_CLASSES + 1)

    def test_success_cam_is_2d_and_between_0_and_1(self):
        _, cam = self._run()
        assert cam[0].ndim == 2
        assert cam.min() >= 0.0
        assert cam.max() <= 1.0

    def test_success_input_size_comes_from_the_model(self):
        assert IMG_SIZE == server.student.get_inputs()[0].shape[2]


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
