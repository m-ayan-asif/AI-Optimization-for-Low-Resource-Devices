"""
Prepares the models server.py serves, all on ONNX Runtime (needs requirements-dev.txt; the service itself never needs PyTorch):
  models/lesion_gate.onnx                                exported here from lesion_gate.pth; holds its threshold as metadata
  models/student_clean_res320_s2_notlesion_v2.onnx       copied from the PWA's folder (see export_mobile.py)
  models/asr/whisper-small-urdu-onnx/                    copied from the PWA's folder (see WEEKEND_REPORT.md section 10)

The server and the phone run byte-identical student and Whisper files, so Git LFS stores each only once.

Usage:  python export_server.py [--skin-dir skin-v5] [--whisper-dir whisper-small-ur-v1]
"""
import argparse
import os
import shutil

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn
from torchvision import models

HERE = os.path.dirname(os.path.abspath(__file__))
PWA_MODELS = os.path.join(HERE, "..", "client", "public", "models")
OUT = os.path.join(HERE, "models")


class LesionGate(nn.Module):
    """ImageNet MobileNetV3-Large up to its 1280-d layer, plus one logistic output: P(not a lesion photo)."""

    def __init__(self):
        super().__init__()
        base = models.mobilenet_v3_large(weights=None)
        self.features, self.avgpool = base.features, base.avgpool
        self.classifier = nn.Sequential(base.classifier[0], base.classifier[1])  # Linear(960, 1280) + Hardswish
        self.head = nn.Linear(1280, 1)

    def forward(self, x):
        return torch.sigmoid(self.head(self.classifier(torch.flatten(self.avgpool(self.features(x)), 1))))[:, 0]


def export_gate():
    state = torch.load(os.path.join(OUT, "lesion_gate.pth"), map_location="cpu", weights_only=True)
    threshold = float(state.pop("threshold").item())
    gate = LesionGate()
    gate.load_state_dict(state)
    gate.eval()
    path = os.path.join(OUT, "lesion_gate.onnx")
    torch.onnx.export(gate, (torch.zeros(1, 3, 224, 224),), path, input_names=["input"], output_names=["p"],
                      opset_version=17, dynamo=False)
    model = onnx.load(path)
    onnx.helper.set_model_props(model, {"threshold": str(threshold)})
    onnx.save(model, path)

    session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    assert float(session.get_modelmeta().custom_metadata_map["threshold"]) == threshold
    rng = np.random.default_rng(0)
    worst = 0.0
    for _ in range(8):
        x = rng.normal(0, 1, (1, 3, 224, 224)).astype("float32")
        with torch.no_grad():
            ref = gate(torch.from_numpy(x)).numpy()
        worst = max(worst, float(np.abs(session.run(None, {"input": x})[0] - ref).max()))
    print(f"wrote {path} ({os.path.getsize(path) / 2**20:.1f} MB), threshold {threshold}, max |diff| vs PyTorch {worst:.2e}")
    assert worst < 1e-3, "ONNX export does not match PyTorch"


def copy_from_pwa(skin_dir, whisper_dir):
    shutil.copyfile(os.path.join(PWA_MODELS, skin_dir, "student.onnx"),
                    os.path.join(OUT, "student_clean_res320_s2_notlesion_v2.onnx"))
    src = os.path.join(PWA_MODELS, whisper_dir)
    dst = os.path.join(OUT, "asr", "whisper-small-urdu-onnx")
    os.makedirs(dst, exist_ok=True)
    for name in ("config.json", "generation_config.json", "tokenizer.json"):
        shutil.copyfile(os.path.join(src, name), os.path.join(dst, name))
    for name in ("encoder_model_quantized.onnx", "decoder_model_merged_quantized.onnx"):
        shutil.copyfile(os.path.join(src, "onnx", name), os.path.join(dst, name))
    print(f"copied the student from {skin_dir} and Whisper from {whisper_dir}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--skin-dir", default="skin-v5")
    ap.add_argument("--whisper-dir", default="whisper-small-ur-v1")
    args = ap.parse_args()
    export_gate()
    copy_from_pwa(args.skin_dir, args.whisper_dir)
