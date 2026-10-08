"""Lesion-photo gate: "is this a photo of a skin condition at all?", judged on GENERAL image features.

Why: the not-a-lesion output on the skin model's own features (fit_not_lesion_head.py) kept missing real-world photos
- a golden-retriever puppy, then a baby on an armchair, both read as Eczema - because a model trained only on lesions
sees everything as skin texture. An ImageNet MobileNetV3-Large still knows dogs, babies, books and chairs, so a
logistic head on its 1280-d penultimate features separates lesion photos from everything else far better
(held-out non-lesions rejected 94.2 % -> 99.0 %, real Unsplash photos 84.3 % -> 100 %, lesions wrongly rejected 0.4 %).

Data: lesions = clean train split; non-lesions = negatives_*.csv (build_negatives.py: DTD, COCO, pets, people).
Threshold keeps 99 % of val lesions (and is at least 0.5).

Writes ../inference/models/lesion_gate.pth: the ImageNet backbone up to the 1280-d layer plus the head, with the
feature standardisation folded into the head, so the server and the phone need nothing downloaded at run time.
    cd notebooks && python fit_lesion_gate.py
"""
import glob, os, sys
import numpy as np, pandas as pd, torch, torch.nn.functional as F
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
dev = "cuda" if torch.cuda.is_available() else "cpu"
w = models.MobileNet_V3_Large_Weights.IMAGENET1K_V2
tf = transforms.Compose([transforms.Resize((224, 224)), transforms.ToTensor(),
                         transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])])


class Imgs(Dataset):
    def __init__(s, paths): s.p = list(paths)
    def __len__(s): return len(s.p)
    def __getitem__(s, i):
        im = Image.open(s.p[i]); im.draft("RGB", (600, 600))
        return tf(im.convert("RGB"))


@torch.no_grad()
def feats(m, paths):
    out = []
    for x in DataLoader(Imgs(paths), batch_size=128, num_workers=6):
        f = m.avgpool(m.features(x.to(dev))).flatten(1)
        out.append(m.classifier[1](m.classifier[0](f)).float().cpu())  # 1280-d ImageNet penultimate
    return torch.cat(out)


if __name__ == "__main__":
    m = models.mobilenet_v3_large(weights=w).to(dev).eval()
    lab = "../.bench/labels"; neg = "../data/processed"
    pos = {s: pd.read_csv(f"{lab}/{s}_clean.csv") for s in ["train", "val", "test"]}
    negs = {s: pd.read_csv(f"{neg}/negatives_{s}.csv") for s in ["train", "val", "test"]}
    ext = sorted(glob.glob("../inference/test_images/negative/**/*.*", recursive=True))
    ext = [p for p in ext if p.lower().endswith((".jpg", ".jpeg", ".png"))]
    ext_real = [p for p in ext if f"{os.sep}real{os.sep}" in os.path.normpath(p)]
    ext_syn = [p for p in ext if p not in ext_real]
    cur = sorted(glob.glob("../inference/test_images/positive/*/*"))
    mis = sorted(glob.glob(os.path.expanduser("~/SkinSense/mismatches/*.*")))
    F_ = {k: feats(m, v) for k, v in {
        "pos_train": pos["train"].image_path, "neg_train": negs["train"].image_path, "pos_val": pos["val"].image_path,
        "neg_val": negs["val"].image_path, "pos_test": pos["test"].image_path, "neg_test": negs["test"].image_path,
        "ext_real": ext_real, "ext_syn": ext_syn, "curated": cur, "mismatches": mis}.items()}
    mu, sd = F_["pos_train"].mean(0), F_["pos_train"].std(0) + 1e-6
    Z = {k: (v - mu) / sd for k, v in F_.items()}
    wv = torch.zeros(1280, requires_grad=True); b = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([wv, b], lr=1, max_iter=500, line_search_fn="strong_wolfe")
    hp, hn = Z["pos_train"], Z["neg_train"]
    def closure():
        opt.zero_grad()
        loss = (F.binary_cross_entropy_with_logits(hp @ wv + b, torch.zeros(len(hp))) +
                F.binary_cross_entropy_with_logits(hn @ wv + b, torch.ones(len(hn)))) / 2 + 1e-3 * wv.pow(2).sum()
        loss.backward(); return loss
    opt.step(closure)
    with torch.no_grad():
        P = {k: torch.sigmoid(v @ wv + b).numpy() for k, v in Z.items()}
    thr = max(float(np.quantile(P["pos_val"], 0.99)), 0.5)
    print(f"threshold (keep 99% val lesions): {thr:.4f}")
    for k, lbl in [("pos_val", "val lesions rejected"), ("pos_test", "test lesions rejected"), ("curated", "curated lesions rejected"),
                   ("neg_test", "held-out non-lesions rejected"), ("ext_real", "real Unsplash rejected"),
                   ("ext_syn", "synthetic rejected"), ("mismatches", "your reported photos rejected")]:
        r = P[k] >= thr; print(f"  {lbl:32s} {r.sum():5d}/{len(r):5d} = {100*r.mean():.1f}%")
    t = negs["test"]
    for src in t.source.unique():
        r = P["neg_test"][(t.source == src).values] >= thr; print(f"    held-out {src:13s} rejected {100*r.mean():.1f}%")
    for split in ["val", "test"]:
        labels = pos[split].unified_label.values; r = P[f"pos_{split}"] >= thr
        print(f"  {split} lesions rejected per class:", {c: f"{int(r[labels == c].sum())}/{int((labels == c).sum())}" for c in sorted(set(labels))})
    for p_, v in zip(mis, P["mismatches"]): print(f"  {os.path.basename(p_)}: {v:.3f}")
    # Fold the standardisation into one Linear(1280 -> 1): ((f - mu) / sd) . w + b
    w_eff = wv.detach() / sd
    b_eff = b.detach() - (mu * w_eff).sum()
    gate = {k: v.cpu() for k, v in m.state_dict().items() if k.startswith(("features.", "classifier.0."))}
    gate["head.weight"] = w_eff[None]
    gate["head.bias"] = b_eff.reshape(1)
    gate["threshold"] = torch.tensor(thr)
    torch.save(gate, os.path.join(HERE, "..", "inference", "models", "lesion_gate.pth"))
    print("wrote ../inference/models/lesion_gate.pth")
