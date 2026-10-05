"""
Unit tests for quality.py (torch-free guard logic).

These run without loading PyTorch or the model, so they are fast and can be
executed on any machine, including CI runners without a GPU.
"""
import math

import cv2
import numpy as np
import pytest
from PIL import Image

import quality as q


def _skin(size=(128, 128), sigma=12, seed=0, base=(200, 150, 100)):
    rng = np.random.default_rng(seed)
    arr = np.clip(np.array(base, float) + rng.normal(0, sigma, (size[1], size[0], 1)), 0, 255)
    return Image.fromarray(arr.astype("uint8"), "RGB")


def _bgr(img):
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


class TestSkinCheck:
    def test_skin_tone_passes(self):
        assert q.is_skin_image(_skin()) is True

    def test_dark_skin_tone_passes(self):
        # Fitzpatrick V-VI style tone
        assert q.is_skin_image(_skin(base=(120, 80, 60))) is True

    def test_blue_image_fails(self):
        assert q.is_skin_image(_skin(base=(30, 60, 200))) is False

    def test_green_image_fails(self):
        assert q.is_skin_image(_skin(base=(40, 180, 60))) is False

    def test_minimum_ratio_is_respected(self):
        img = np.zeros((100, 100, 3), np.uint8)
        img[:, :] = (30, 60, 200)
        img[:, :10] = (200, 150, 100)   # ~10% skin
        pil = Image.fromarray(img, "RGB")
        assert q.is_skin_image(pil, min_skin_ratio=0.05) is True
        assert q.is_skin_image(pil, min_skin_ratio=0.50) is False


class TestBlur:
    def test_flat_image_scores_zero(self):
        flat = Image.new("RGB", (128, 128), (200, 150, 100))
        assert q.check_image_blur(_bgr(flat)) == 0.0

    def test_textured_image_scores_above_threshold(self):
        assert q.check_image_blur(_bgr(_skin())) > q.BLUR_REJECT_THRESHOLD

    def test_gaussian_blur_lowers_score(self):
        sharp = _bgr(_skin(sigma=25))
        soft = cv2.GaussianBlur(sharp, (0, 0), 4)
        assert q.check_image_blur(soft) < q.check_image_blur(sharp)

    def test_blurred_image_is_flagged(self):
        soft = cv2.GaussianBlur(_bgr(_skin(sigma=25)), (0, 0), 8)
        assert q.is_too_blurry(q.check_image_blur(soft)) is True

    def test_large_images_are_measured_at_bounded_resolution(self):
        # The same scene at 4x the pixel count must give a comparable score
        # rather than a resolution-dependent one.
        small = _bgr(_skin(size=(512, 512), sigma=25, seed=2))
        big = cv2.resize(small, (2048, 2048), interpolation=cv2.INTER_NEAREST)
        s_small, s_big = q.check_image_blur(small), q.check_image_blur(big)
        assert s_small > 0
        assert s_big == pytest.approx(s_small, rel=0.35)

    def test_tiny_image_does_not_crash(self):
        assert q.check_image_blur(np.zeros((3, 3, 3), np.uint8)) >= 0.0

    def test_threshold_boundary(self):
        assert q.is_too_blurry(19.99) is True
        assert q.is_too_blurry(20.0) is False


class TestEntropy:
    def test_uniform_is_ln_n(self):
        assert q.entropy_from_probs([1 / 7] * 7) == pytest.approx(math.log(7), rel=1e-6)

    def test_one_hot_is_zero(self):
        assert q.entropy_from_probs([1.0, 0, 0, 0, 0, 0, 0]) == pytest.approx(0.0, abs=1e-9)

    def test_peaked_is_lower_than_flat(self):
        assert q.entropy_from_probs([0.9] + [0.1 / 6] * 6) < q.entropy_from_probs([1 / 7] * 7)

    def test_ignores_zero_probabilities(self):
        assert q.entropy_from_probs([0.5, 0.5, 0.0]) == pytest.approx(math.log(2), rel=1e-6)


class TestAssessPrediction:
    def test_confident_prediction_is_classified(self):
        assert q.assess_prediction(0.85, 0.70, 0.6) == "classified"

    def test_low_confidence_is_out_of_scope(self):
        assert q.assess_prediction(0.25, 0.05, 1.9) == "out_of_scope"

    def test_confidence_at_threshold_is_out_of_scope(self):
        assert q.assess_prediction(q.LOW_CONFIDENCE_THRESHOLD, 0.2, 1.0) == "out_of_scope"

    def test_flat_distribution_with_small_margin_is_out_of_scope(self):
        assert q.assess_prediction(0.35, 0.03, 1.80) == "out_of_scope"

    def test_high_entropy_with_clear_margin_is_still_classified(self):
        assert q.assess_prediction(0.40, 0.20, 1.80) == "classified"

    def test_uniform_seven_class_output_is_out_of_scope(self):
        p = [1 / 7] * 7
        assert q.assess_prediction(p[0], 0.0, q.entropy_from_probs(p)) == "out_of_scope"

    def test_low_energy_is_out_of_scope(self):
        assert q.assess_prediction(0.85, 0.70, 0.6, energy=q.OOD_ENERGY_THRESHOLD - 0.1) == "out_of_scope"

    def test_high_energy_is_classified(self):
        assert q.assess_prediction(0.85, 0.70, 0.6, energy=q.OOD_ENERGY_THRESHOLD + 0.1) == "classified"


class TestLfsPointer:
    def test_detects_pointer_file(self, tmp_path):
        f = tmp_path / "model.pth"
        f.write_bytes(b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n")
        assert q.is_lfs_pointer(str(f)) is True

    def test_real_binary_is_not_pointer(self, tmp_path):
        f = tmp_path / "model.pth"
        f.write_bytes(b"PK\x03\x04" + b"\x00" * 200)
        assert q.is_lfs_pointer(str(f)) is False

    def test_missing_file_is_not_pointer(self, tmp_path):
        assert q.is_lfs_pointer(str(tmp_path / "nope.pth")) is False


class TestNotALesion:
    def test_success_rejects_at_or_above_threshold(self):
        assert q.is_not_a_lesion(q.NOT_LESION_THRESHOLD) is True
        assert q.is_not_a_lesion(0.99) is True

    def test_success_accepts_below_threshold(self):
        assert q.is_not_a_lesion(q.NOT_LESION_THRESHOLD - 0.01) is False
        assert q.is_not_a_lesion(0.0) is False
