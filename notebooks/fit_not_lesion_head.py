"""Add a "not a skin lesion" output to an already trained 7-class student WITHOUT retraining it.

Why: training the 8th class jointly (train_dualkd.py --neg-train-csv, 3 seeds) rejected 98-99% of held-out non-lesion
photos but cost 1.6 points of disease accuracy (72.10 +/- 1.62 vs 73.70 +/- 0.81; Psoriasis recall 69.7 -> 62.8).

Here the student is frozen. Its last layer maps the 512-d hidden vector h to 7 disease logits z = W h + b; we fit one
extra row, z8 = w.h + c, so that softmax over the 8 logits gives P(not a lesion) = sigmoid(z8 - logsumexp(z)).
The 7 disease logits are untouched, so disease predictions - and accuracy - are exactly those of the input model.

Data: lesions = clean train split; non-lesions = ../data/processed/negatives_train.csv (build_negatives.py).
Reports on val/test lesions, held-out negatives and the external Unsplash/synthetic negatives
(inference/test_images/negative/, never used for fitting).

    cd notebooks && python fit_not_lesion_head.py --model ../inference/models/student_clean_res320_s2.pth \
        --out ../inference/models/student_clean_res320_s2_notlesion.pth
"""
import argparse
import glob
import os

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

CLASSES = 7
NORM = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])


class Images(Dataset):
    def __init__(self, paths, size, flip=False):
        self.paths = list(paths)
        ops = [transforms.Resize((size, size))] + ([transforms.RandomHorizontalFlip(1.0)] if flip else [])
        self.tf = transforms.Compose(ops + [transforms.ToTensor(), NORM])

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        im = Image.open(self.paths[i])
        im.draft("RGB", (600, 600))  # same decode as train_dualkd.load_rgb
        return self.tf(im.convert("RGB"))


def student(num_classes=CLASSES):
    m = models.mobilenet_v3_large(weights=None)
    m.classifier = nn.Sequential(nn.Linear(960, 512), nn.Hardswish(), nn.Dropout(0.3), nn.Linear(512, num_classes))
    return m


@torch.no_grad()
def hidden(model, paths, size, device, flip=False):
    """512-d input of the last Linear layer (after Hardswish; dropout is off in eval)."""
    out = []
    for x in DataLoader(Images(paths, size, flip), batch_size=64, num_workers=6):
        f = model.avgpool(model.features(x.to(device))).flatten(1)
        out.append(model.classifier[1](model.classifier[0](f)).float().cpu())
    return torch.cat(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--img-size", type=int, default=320)
    ap.add_argument("--labels", default="../.bench/labels", help="folder with {train,val,test}_clean.csv")
    ap.add_argument("--negatives", default="../data/processed", help="folder with negatives_{train,val,test}.csv")
    ap.add_argument("--keep", type=float, default=0.99, help="threshold keeps this fraction of val lesions")
    args = ap.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(0)

    m = student()
    m.load_state_dict(torch.load(args.model, map_location="cpu", weights_only=True))
    m = m.to(device).eval()
    last = m.classifier[3]
    W, b = last.weight.detach().cpu(), last.bias.detach().cpu()

    pos = {s: pd.read_csv(f"{args.labels}/{s}_clean.csv").image_path for s in ["train", "val", "test"]}
    neg = {s: pd.read_csv(f"{args.negatives}/negatives_{s}.csv").image_path for s in ["train", "val", "test"]}
    ext = sorted(glob.glob("../inference/test_images/negative/**/*.*", recursive=True))
    ext = [p for p in ext if p.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp"))]
    ext_real = [p for p in ext if f"{os.sep}real{os.sep}" in os.path.normpath(p)]
    ext_syn = [p for p in ext if p not in ext_real]
    mism = sorted(glob.glob(os.path.expanduser("~/SkinSense/mismatches/*.*")))  # real-world misses reported in testing

    feats = {}
    for name, paths in [("pos_train", pos["train"]), ("neg_train", neg["train"]), ("pos_val", pos["val"]),
                        ("neg_val", neg["val"]), ("pos_test", pos["test"]), ("neg_test", neg["test"]),
                        ("ext_real", ext_real), ("ext_syn", ext_syn), ("mismatches", mism)]:
        feats[name] = hidden(m, paths, args.img_size, device)
        print(f"{name}: {len(paths)}", flush=True)
    # flipped copies of the training images: cheap augmentation for a 513-parameter fit
    feats["pos_train"] = torch.cat([feats["pos_train"], hidden(m, pos["train"], args.img_size, device, flip=True)])
    feats["neg_train"] = torch.cat([feats["neg_train"], hidden(m, neg["train"], args.img_size, device, flip=True)])

    def logit_gap(h, w, c):  # z8 - logsumexp(disease logits) = logit of P(not a lesion)
        return h @ w + c - torch.logsumexp(h @ W.T + b, dim=1)

    w = torch.zeros(512, requires_grad=True)
    c = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([w, c], lr=1, max_iter=500, line_search_fn="strong_wolfe")
    hp, hn = feats["pos_train"], feats["neg_train"]

    def closure():
        opt.zero_grad()
        # class-balanced logistic loss + small L2 on w
        loss = (F.binary_cross_entropy_with_logits(logit_gap(hp, w, c), torch.zeros(len(hp))) +
                F.binary_cross_entropy_with_logits(logit_gap(hn, w, c), torch.ones(len(hn)))) / 2 + 1e-4 * w.pow(2).sum()
        loss.backward()
        return loss

    opt.step(closure)
    with torch.no_grad():
        p = {k: torch.sigmoid(logit_gap(v, w, c)).numpy() for k, v in feats.items()}
    thr = float(np.quantile(p["pos_val"], args.keep))
    thr = max(thr, 0.5)  # never reject a photo the model thinks is more likely a lesion than not
    print(f"\nthreshold (keeps {args.keep:.1%} of val lesions, at least 0.5): {thr:.4f}")
    for k, label in [("pos_val", "val lesions rejected"), ("pos_test", "test lesions rejected"),
                     ("neg_val", "val non-lesions rejected"), ("neg_test", "held-out DTD/COCO non-lesions rejected"),
                     ("ext_real", "real Unsplash non-skin photos rejected"), ("ext_syn", "synthetic negatives rejected"),
                     ("mismatches", "reported misses (~/SkinSense/mismatches)")]:
        if not len(p[k]):
            continue
        r = p[k] >= thr
        print(f"  {label:42s} {r.sum():5d}/{len(r):5d} = {100 * r.mean():.2f}%")
    # Per disease: adding face photos to the negatives must not start rejecting Melasma (face photos too)
    for split in ["val", "test"]:
        labels = pd.read_csv(f"{args.labels}/{split}_clean.csv").unified_label.values
        r = p[f"pos_{split}"] >= thr
        per = {c: f"{int(r[labels == c].sum())}/{int((labels == c).sum())}" for c in sorted(set(labels))}
        print(f"  {split} lesions rejected per class: {per}")

    new = student(CLASSES + 1)
    sd = {k: v for k, v in m.state_dict().items() if not k.startswith("classifier.3.")}
    sd["classifier.3.weight"] = torch.cat([W, w.detach()[None]])
    sd["classifier.3.bias"] = torch.cat([b, c.detach()])
    new.load_state_dict(sd)
    torch.save(new.state_dict(), args.out)
    np.save(os.path.splitext(args.out)[0] + "_threshold.npy", np.array([thr]))
    print(f"wrote {args.out} (8 outputs; outputs 0-6 identical to {os.path.basename(args.model)})")


if __name__ == "__main__":
    main()
