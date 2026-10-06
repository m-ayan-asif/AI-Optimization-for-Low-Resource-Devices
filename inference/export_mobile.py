"""
Export the production student for on-device inference in the PWA (onnxruntime-web).

Grad-CAM normally needs a backward pass, which ONNX Runtime cannot run. For this architecture it has a closed form:
features -> global average pool -> Linear -> Hardswish -> Linear, so the gradient of logit c w.r.t. every spatial
position of the last feature map is the same vector  g = W1^T (hardswish'(z1) * W2[c]) / (H*W).  The exported graph
returns the logits plus that CAM (for the top class), so the phone produces the same heatmap as server.py.

Writes client/public/models/<--out-dir>/{student.onnx, meta.json}, then checks the ONNX model against PyTorch (logits and
Grad-CAM vs server.py's hook-based implementation) and its accuracy on the clean test split.

Usage (needs torch, onnx, onnxruntime, opencv):  python export_mobile.py [--model ...] [--img-size 320]
"""
import argparse
import json
import os

import numpy as np
import torch
import torch.nn as nn
from torchvision import models

import quality as Q

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_ROOT = os.path.join(HERE, "..", "client", "public", "models")  # one folder per model version: served as immutable
CLASS_NAMES = ["Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"]
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]


def build_student_large(num_classes=7):  # same as server.py
    m = models.mobilenet_v3_large(weights=None)
    m.classifier = nn.Sequential(nn.Linear(m.classifier[0].in_features, 512), nn.Hardswish(), nn.Dropout(p=0.3),
                                 nn.Linear(512, num_classes))
    return m


class StudentWithCam(nn.Module):
    def __init__(self, student):
        super().__init__()
        self.s = student.eval()

    def forward(self, x):
        f = self.s.features(x)                                  # (1, 960, h, w)
        pooled = f.mean(dim=(2, 3))
        lin1, lin2 = self.s.classifier[0], self.s.classifier[3]
        z1 = lin1(pooled)
        logits = lin2(nn.functional.hardswish(z1))
        c = logits[:, :len(CLASS_NAMES)].argmax(dim=1)  # heatmap for the top disease (8-class models: not "not a lesion")
        dhs = torch.where(z1 < -3, torch.zeros_like(z1), torch.where(z1 > 3, torch.ones_like(z1), z1 / 3 + 0.5))
        g = (dhs * lin2.weight[c]) @ lin1.weight                # (1, 960) = d logit_c / d pooled
        cam = torch.relu((g[:, :, None, None] * f).sum(1) / (f.shape[2] * f.shape[3]))
        cam = cam / cam.amax(dim=(1, 2), keepdim=True).clamp_min(1e-12)
        return logits, cam


def hook_gradcam(model, x, class_idx):  # server.py's GradCAM, for the parity check
    store = {}
    h1 = model.features[-1].register_forward_hook(lambda m, i, o: store.__setitem__("a", o))
    h2 = model.features[-1].register_full_backward_hook(lambda m, gi, go: store.__setitem__("g", go[0]))
    x = x.clone().requires_grad_(True)
    out = model(x); model.zero_grad(); out[0, class_idx].backward()
    h1.remove(); h2.remove()
    w = store["g"][0].mean(dim=(1, 2))
    cam = torch.relu((w[:, None, None] * store["a"][0]).sum(0))
    return (cam / cam.max()).detach().numpy() if cam.max() > 0 else cam.detach().numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.path.join(HERE, "models", "student_clean_res320_s2_notlesion.pth"))
    ap.add_argument("--img-size", type=int, default=320)
    ap.add_argument("--model-version", default="mobilenetv3-large-dualkd-clean320-notlesion-v3-onnx")
    ap.add_argument("--out-dir", default="skin-v3", help="folder under client/public/models; use a new one per model")
    ap.add_argument("--test-csv", default=os.path.join(HERE, "..", ".bench", "labels", "test_clean.csv"))
    args = ap.parse_args()

    state = torch.load(args.model, map_location="cpu", weights_only=True)
    num_outputs = state["classifier.3.weight"].shape[0]  # 8 = the diseases + "not a skin lesion"
    student = build_student_large(num_outputs)
    student.load_state_dict(state)
    OUT = os.path.join(OUT_ROOT, args.out_dir)
    student.eval()
    wrapped = StudentWithCam(student).eval()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "student.onnx")
    dummy = torch.zeros(1, 3, args.img_size, args.img_size)
    torch.onnx.export(wrapped, (dummy,), path, input_names=["input"], output_names=["logits", "cam"],
                      opset_version=17, dynamo=False)
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "model_version": args.model_version, "img_size": args.img_size, "mean": MEAN, "std": STD,
            "class_names": CLASS_NAMES,
            "guards": {"min_skin_ratio": Q.MIN_SKIN_RATIO, "blur_reject_threshold": Q.BLUR_REJECT_THRESHOLD,
                       "blur_max_side": Q.BLUR_MAX_SIDE, "low_confidence_threshold": Q.LOW_CONFIDENCE_THRESHOLD,
                       "ood_entropy_threshold": Q.OOD_ENTROPY_THRESHOLD, "ood_margin_threshold": Q.OOD_MARGIN_THRESHOLD,
                       "ood_energy_threshold": Q.OOD_ENERGY_THRESHOLD,
                       "not_lesion_threshold": Q.NOT_LESION_THRESHOLD},
            "not_lesion_index": len(CLASS_NAMES) if num_outputs > len(CLASS_NAMES) else None,
        }, fh, indent=2)
    print(f"wrote {path} ({os.path.getsize(path) / 2**20:.1f} MB)")

    import onnxruntime as ort
    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(0)
    worst_logit = worst_cam = 0.0
    for _ in range(8):
        x = torch.from_numpy(rng.normal(0, 1, (1, 3, args.img_size, args.img_size)).astype("float32"))
        lo, cam = sess.run(None, {"input": x.numpy()})
        with torch.no_grad():
            ref = student(x)
        worst_logit = max(worst_logit, float(np.abs(lo - ref.numpy()).max()))
        top_disease = int(ref[0, :len(CLASS_NAMES)].argmax())
        worst_cam = max(worst_cam, float(np.abs(cam[0] - hook_gradcam(student, x, top_disease)).max()))
    print(f"parity vs PyTorch: max |logit diff| {worst_logit:.2e}, max |Grad-CAM diff| {worst_cam:.2e}")
    assert worst_logit < 1e-3 and worst_cam < 1e-3, "ONNX export does not match PyTorch"

    if os.path.exists(args.test_csv):
        import pandas as pd
        from PIL import Image
        from torchvision import transforms
        tf = transforms.Compose([transforms.Resize((args.img_size, args.img_size)), transforms.ToTensor(),
                                 transforms.Normalize(MEAN, STD)])
        df = pd.read_csv(args.test_csv)
        correct = 0
        for p, y in zip(df.image_path, df.numeric_label):
            im = Image.open(os.path.join(HERE, "..", "notebooks", p)); im.draft("RGB", (1024, 1024))
            lo, _ = sess.run(None, {"input": tf(im.convert("RGB"))[None].numpy()})
            correct += int(lo[0, :len(CLASS_NAMES)].argmax() == y)
        print(f"ONNX accuracy on {os.path.basename(args.test_csv)}: {100 * correct / len(df):.2f}% ({len(df)})")


if __name__ == "__main__":
    main()
