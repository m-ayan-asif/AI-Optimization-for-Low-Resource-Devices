"""Offline companion to eval_guards.py: compute every /predict guard signal (skin ratio, blur score, top-1
confidence, margin, entropy) once per image without the server, then sweep the guard thresholds. Also scores two
feature-space out-of-distribution detectors (plus a k-NN one) that need no extra model: the energy score (logsumexp of the logits)
and the Mahalanobis distance of the student's 512-d penultimate feature to the nearest training-class mean
(class means + shared covariance fitted on a train.csv sample).

Negatives: test_images/negative/** (synthetic + real photos). Positives: test_images/positive/<class>/ plus the
held-out test split (data/processed/test.csv). OOD thresholds are picked on val.csv positives (keep 95/97.5/99%
of them) so the test positives are not used for choosing. Runs on CPU (CUDA_VISIBLE_DEVICES is cleared).

Usage: python sweep_guards.py [--model ...] [--train-sample 2000] [--test-limit 0]
"""
import argparse
import os

os.environ["CUDA_VISIBLE_DEVICES"] = ""
import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

import quality as Q

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data", "processed")
KNN_K = 10
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
CLASS_NAMES = ["Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"]
def make_transform(size):
    return transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(),
                               transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])])


def build_student_large(num_classes=7):  # same as server.py
    m = models.mobilenet_v3_large(weights=None)
    m.classifier = nn.Sequential(nn.Linear(m.classifier[0].in_features, 512), nn.Hardswish(), nn.Dropout(p=0.3),
                                 nn.Linear(512, num_classes))
    return m


class GuardDataset(Dataset):
    def __init__(self, paths, transform):
        self.paths, self.transform = paths, transform  # passed in: spawned (Windows) workers re-import the module

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, i):
        im = Image.open(self.paths[i])
        im.draft("RGB", (1024, 1024))  # JPEG-only, no-op otherwise; the guards are resolution-independent ratios
        im = im.convert("RGB")
        blur = Q.check_image_blur(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2BGR))
        return self.transform(im), Q.skin_ratio(im), blur


def collect(root):
    out = []
    for dirpath, dirnames, files in os.walk(root):
        dirnames.sort()
        out += [os.path.join(dirpath, f) for f in sorted(files) if f.lower().endswith(IMAGE_EXTS)]
    return out


def split_rows(csv, kind, limit=0):
    d = pd.read_csv(csv if os.path.isabs(csv) else os.path.join(DATA, csv))
    if limit:
        d = d.sample(limit, random_state=0)
    return [(os.path.normpath(os.path.join(HERE, "..", "notebooks", p)), kind, c)
            for p, c in zip(d.image_path, d.unified_label)]


def signals(model, df, workers, img_size):
    feats, logits, skin, blur = [], [], [], []
    loader = DataLoader(GuardDataset(df.path.tolist(), make_transform(img_size)), batch_size=32, num_workers=workers)
    head, tail = model.classifier[:2], model.classifier[2:]
    with torch.no_grad():
        for k, (x, s, b) in enumerate(loader):
            f = head(torch.flatten(model.avgpool(model.features(x)), 1))
            feats.append(f); logits.append(tail(f)); skin += s.tolist(); blur += b.tolist()
            if k % 20 == 0:
                print(f"  {(k + 1) * 32}/{len(df)}", flush=True)
    full = torch.cat(logits)
    d = len(CLASS_NAMES)
    # 8-class models: column 7 is "not a skin lesion"; every other signal is computed on the 7 disease logits
    not_lesion = torch.softmax(full, 1)[:, d] if full.shape[1] > d else torch.zeros(len(full))
    lg = full[:, :d]
    p = torch.softmax(lg, 1)
    top2 = p.topk(2, 1).values
    df = df.assign(skin_ratio=skin, blur=blur, conf=top2[:, 0].numpy(), margin=(top2[:, 0] - top2[:, 1]).numpy(),
                   entropy=[Q.entropy_from_probs(r) for r in p.tolist()],
                   energy=torch.logsumexp(lg, 1).numpy(), pred=[CLASS_NAMES[i] for i in p.argmax(1).tolist()],
                   not_lesion=not_lesion.numpy())
    return df, torch.cat(feats).numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.path.join(HERE, "models", "student_clean_res320_s2_notlesion_v2.pth"))
    ap.add_argument("--train-sample", type=int, default=2000, help="train.csv rows used to fit the Mahalanobis model")
    ap.add_argument("--test-limit", type=int, default=0, help="use only N rows of test.csv / val.csv (0 = all)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--img-size", type=int, default=320, help="the model's input resolution (server IMG_SIZE)")
    ap.add_argument("--split-suffix", default="", help="e.g. _clean to use ../.bench/labels/{train,val,test}_clean.csv")
    ap.add_argument("--neg-test-csv", default=os.path.join(DATA, "negatives_test.csv"),
                    help="held-out DTD/COCO negatives (same sources as the 8-class training negatives)")
    args = ap.parse_args()
    split = (lambda n: os.path.join(HERE, "..", ".bench", "labels", f"{n}{args.split_suffix}.csv")) if args.split_suffix         else (lambda n: f"{n}.csv")

    rows = [(p, "negative_real" if os.sep + "real" + os.sep in p else "negative_synthetic", None)
            for p in collect(os.path.join(HERE, "test_images", "negative"))]
    rows += [(p, "positive_curated", os.path.basename(os.path.dirname(p)).replace("_", " "))
             for p in collect(os.path.join(HERE, "test_images", "positive"))]
    rows += split_rows(split("test"), "positive_test", args.test_limit) + split_rows(split("val"), "val", args.test_limit)
    rows += split_rows(split("train"), "train", args.train_sample)
    if os.path.exists(args.neg_test_csv):
        rows += [(os.path.normpath(os.path.join(HERE, "..", "notebooks", p)), "negative_heldout", None)
                 for p in pd.read_csv(args.neg_test_csv).image_path]
    df = pd.DataFrame(rows, columns=["path", "kind", "true_class"])

    state = torch.load(args.model, map_location="cpu", weights_only=True)
    model = build_student_large(state["classifier.3.weight"].shape[0])
    model.load_state_dict(state)
    model.eval()
    print(f"scoring {len(df)} images on CPU", flush=True)
    df, feats = signals(model, df, args.workers, args.img_size)

    # class-conditional Gaussians with a shared covariance (Lee et al. 2018), fitted on the train sample
    tr = (df.kind == "train").values
    labels = df.true_class[tr].map(CLASS_NAMES.index).values
    means = np.stack([feats[tr][labels == c].mean(0) for c in range(len(CLASS_NAMES))])
    centered = feats[tr] - means[labels]
    prec = np.linalg.pinv(np.cov(centered, rowvar=False) + 1e-3 * np.eye(feats.shape[1]))
    d = feats[:, None, :] - means[None]
    df["mahalanobis"] = np.einsum("ncd,de,nce->nc", d, prec, d).min(1)
    # deep nearest neighbour (Sun et al. 2022): cosine similarity to the k-th closest normalised train feature
    z = feats / np.linalg.norm(feats, axis=1, keepdims=True)
    df["knn_sim"] = np.sort(z @ z[tr].T, axis=1)[:, -KNN_K - 1]  # -K-1 skips a train image's match with itself
    df.to_csv(os.path.join(HERE, "guard_signals.csv"), index=False)

    val = df.kind == "val"
    base = (df.blur >= Q.BLUR_REJECT_THRESHOLD)

    def current_guard(min_skin=Q.MIN_SKIN_RATIO, min_conf=Q.LOW_CONFIDENCE_THRESHOLD):
        return base & (df.skin_ratio >= min_skin) & (df.conf > min_conf) & \
            ~((df.entropy > Q.OOD_ENTROPY_THRESHOLD) & (df.margin < Q.OOD_MARGIN_THRESHOLD))

    def line(name, acc):
        out = {"setting": name}
        for kind in ["negative_synthetic", "negative_real", "negative_heldout"]:
            m = df.kind == kind; out[f"FA {kind[9:]}"] = f"{acc[m].sum()}/{m.sum()}"
        for kind in ["positive_curated", "positive_test"]:
            m = df.kind == kind; out[f"rejected {kind[9:]}"] = f"{(~acc[m]).sum()}/{m.sum()}"
        m = (df.kind == "positive_test") & acc
        out["test acc of accepted"] = round(100 * (df.pred[m] == df.true_class[m]).mean(), 2)
        return out

    table = [line(f"current (skin>={Q.MIN_SKIN_RATIO}, conf>{Q.LOW_CONFIDENCE_THRESHOLD})", current_guard())]
    for s in [0.25, 0.30, 0.40]:
        table.append(line(f"skin>={s}", current_guard(min_skin=s)))
    for c in [0.40, 0.50]:
        table.append(line(f"conf>{c}", current_guard(min_conf=c)))
    for keep in [0.95, 0.975, 0.99]:
        e_thr = np.quantile(df.energy[val], 1 - keep)          # low energy = OOD
        m_thr = np.quantile(df.mahalanobis[val], keep)         # large distance = OOD
        table.append(line(f"current + energy>={e_thr:.2f} (val keep {keep:.1%})", current_guard() & (df.energy >= e_thr)))
        table.append(line(f"current + mahal<={m_thr:.0f} (val keep {keep:.1%})", current_guard() & (df.mahalanobis <= m_thr)))
        k_thr = np.quantile(df.knn_sim[val], 1 - keep)         # low similarity = OOD
        table.append(line(f"current + knn>={k_thr:.3f} (val keep {keep:.1%})", current_guard() & (df.knn_sim >= k_thr)))
        table.append(line(f"current + energy & knn (val keep {keep:.1%})",
                          current_guard() & (df.energy >= e_thr) & (df.knn_sim >= k_thr)))
    if df.not_lesion.max() > 0:
        for t in [0.3, 0.5, 0.7]:
            table.append(line(f"current + not-lesion<{t}", current_guard() & (df.not_lesion < t)))
        for keep in [0.975, 0.99]:
            n_thr = np.quantile(df.not_lesion[val], keep)      # high not-lesion probability = reject
            e_thr = np.quantile(df.energy[val], 1 - keep)
            table.append(line(f"current + not-lesion<{n_thr:.3f} (val keep {keep:.1%})", current_guard() & (df.not_lesion < n_thr)))
            table.append(line(f"current + not-lesion<{n_thr:.3f} & energy>={e_thr:.2f} (val keep {keep:.1%} each)",
                              current_guard() & (df.not_lesion < n_thr) & (df.energy >= e_thr)))
    pd.set_option("display.width", 250, "display.max_colwidth", 60)
    print(pd.DataFrame(table).to_string(index=False))


if __name__ == "__main__":
    main()
