"""
Checks on the real served ONNX files. Skipped when they are not pulled from Git LFS (as in CI). The PyTorch comparison
also needs requirements-dev.txt, and it re-checks after any re-export that the service still gets the same answers.
"""
import filecmp
import os

import numpy as np
import onnxruntime as ort
import pytest

from quality import is_lfs_pointer

MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
STUDENT = os.path.join(MODELS, "student_clean_res320_s2_notlesion_v2.onnx")
GATE = os.path.join(MODELS, "lesion_gate.onnx")
PWA_STUDENT = os.path.join(MODELS, "..", "..", "client", "public", "models", "skin-v5", "student.onnx")


def real(path):
    return os.path.exists(path) and not is_lfs_pointer(path)


pytestmark = pytest.mark.skipif(not (real(STUDENT) and real(GATE)), reason="real models not pulled from LFS")


def sample(size, seed=0):
    return np.random.default_rng(seed).normal(0, 1, (1, 3, size, size)).astype(np.float32)


class TestStudent:
    def test_success_has_eight_outputs_and_a_cam(self):
        session = ort.InferenceSession(STUDENT, providers=["CPUExecutionProvider"])
        logits, cam = session.run(["logits", "cam"], {"input": sample(320)})
        assert logits.shape == (1, 8)
        assert cam[0].ndim == 2
        assert cam.min() >= 0.0 and cam.max() <= 1.0 + 1e-6

    def test_success_is_the_same_file_as_the_phone_model(self):
        if not real(PWA_STUDENT):
            pytest.skip("PWA model not pulled from LFS")
        assert filecmp.cmp(STUDENT, PWA_STUDENT, shallow=False)

    def test_success_matches_the_pytorch_checkpoint(self):
        torch = pytest.importorskip("torch")
        torchvision = pytest.importorskip("torchvision")
        pth = os.path.join(MODELS, "student_clean_res320_s2_notlesion_v2.pth")
        if not real(pth):
            pytest.skip("checkpoint not pulled from LFS")
        model = torchvision.models.mobilenet_v3_large(weights=None)
        model.classifier = torch.nn.Sequential(torch.nn.Linear(960, 512), torch.nn.Hardswish(), torch.nn.Dropout(0.3),
                                               torch.nn.Linear(512, 8))
        model.load_state_dict(torch.load(pth, map_location="cpu", weights_only=True))
        model.eval()
        x = sample(320)
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()
        session = ort.InferenceSession(STUDENT, providers=["CPUExecutionProvider"])
        assert np.abs(session.run(["logits"], {"input": x})[0] - ref).max() < 1e-3


class TestGate:
    def test_success_holds_its_threshold_and_returns_a_probability(self):
        session = ort.InferenceSession(GATE, providers=["CPUExecutionProvider"])
        assert 0.0 < float(session.get_modelmeta().custom_metadata_map["threshold"]) < 1.0
        p = session.run(None, {"input": sample(224)})[0]
        assert p.shape == (1,)
        assert 0.0 <= float(p[0]) <= 1.0
