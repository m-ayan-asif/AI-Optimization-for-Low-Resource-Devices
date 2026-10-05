"""CLIP dual-KD distillation of the MobileNetV3-Large student, as a script (same method and hyperparameters
as 06_clip_distillation_dual_kd.ipynb) so it can run detached and use DataLoader workers on Windows
(notebook-defined Dataset classes can't be pickled into spawned workers; module-level ones can).

Used for the training-data ablation: identical teacher, seed and config, only --train-csv differs.

    cd notebooks
    python train_dualkd.py --train-csv ../data/processed/train.csv           --run-name control --seed 0
    python train_dualkd.py --train-csv ../data/processed/train_augmented.csv --run-name augdata --seed 0

Default teacher (--teacher): ../models/teacher_b3_split0926.pth (md5 d2ad9d93...) - the EfficientNet-B3 trained on the current
2026-09-26 split (71.82% test). The teacher behind the served 74.98% student is no longer on disk, and
.bench/models_before_retrain/teacher_final.pth predates the re-split (78.6% on today's test set - it has
almost certainly seen test images) and must not be used.
Writes ../models/student_large_clip_dualkd_<run>.pth and ../models/dualkd_<run>_results.json.
"""
import argparse, json, os, random, time
import numpy as np, pandas as pd, torch, torch.nn as nn, torch.nn.functional as F
import torchvision.transforms as transforms, open_clip
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from torchvision import models
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

CLASS_NAMES = ["Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"]
IMG_SIZE, B3_SIZE = 224, 300
CLIP_MODEL_NAME, CLIP_PRETRAINED = "ViT-B-32-quickgelu", "openai"
TEMPERATURE, ALPHA, BLEND_WEIGHT = 4, 0.7, 0.3
ALPHA_TEACHER, ALPHA_CLIP, ALPHA_HARD = ALPHA * (1 - BLEND_WEIGHT), ALPHA * BLEND_WEIGHT, 1 - ALPHA
TEACHER_CHECKPOINT = "../models/teacher_b3_split0926.pth"
PRODUCTION_STUDENT = "../models/student_large_clip_dualkd_distilled.pth"
VAL_CSV, TEST_CSV = "../data/processed/val.csv", "../data/processed/test.csv"
NUM_EPOCHS, PATIENCE = 40, 5

# Kept identical to 06_clip_distillation_dual_kd.ipynb (and inference/server.py's CLIP_PROMPTS on branch C).
CLIP_PROMPTS = {
    "Vitiligo": ["a photo of vitiligo, depigmented white patches on the skin",
                 "a dermatology image of skin with irregular white patches from loss of pigment",
                 "a close-up of skin showing patchy loss of melanin"],
    "Melasma": ["a photo of melasma, brown or gray-brown patches on the face",
                "a dermatology image of facial skin hyperpigmentation in symmetric patches",
                "a close-up of blotchy, darkened skin discoloration on the cheeks or forehead"],
    "Psoriasis": ["a photo of psoriasis, red scaly plaques on the skin",
                  "a dermatology image of thick, silvery-scaled red skin lesions",
                  "a close-up of inflamed, flaky raised skin patches"],
    "Eczema": ["a photo of eczema, dry inflamed and itchy red skin",
               "a dermatology image of atopic dermatitis with cracked, irritated skin",
               "a close-up of red, scaly, inflamed skin patches"],
    "Tinea": ["a photo of tinea, a ring-shaped fungal skin infection",
              "a dermatology image of a red, scaly, circular rash with a clear center",
              "a close-up of ringworm-like fungal skin lesion"],
    "Contact Dermatitis": ["a photo of contact dermatitis, red irritated skin from an allergic reaction",
                           "a dermatology image of inflamed skin with redness and swelling from irritation",
                           "a close-up of a rash caused by skin contact with an irritant or allergen"],
    "Seborrheic Dermatitis": ["a photo of seborrheic dermatitis, greasy yellowish scaly patches on the skin",
                              "a dermatology image of flaky, oily skin inflammation",
                              "a close-up of red skin with greasy yellow scales"],
}
NORM = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
AUG = [transforms.RandomHorizontalFlip(), transforms.RandomVerticalFlip(), transforms.RandomRotation(15),
       transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1),
       transforms.RandomAffine(degrees=0, translate=(0.1, 0.1))]


def student_transforms(size):
    return (transforms.Compose([transforms.Resize((size, size)), *AUG, transforms.ToTensor(), NORM]),
            transforms.Compose([transforms.Resize((size, size)), transforms.ToTensor(), NORM]))


train_transform, val_transform = student_transforms(IMG_SIZE)
b3_train_transform = transforms.Compose([transforms.Resize((B3_SIZE, B3_SIZE)), *AUG, transforms.ToTensor(), NORM])


def load_rgb(path):
    # draft(): JPEGs are DCT-downscaled while decoding (never below 600px, 2x the largest model input) -
    # many sources are 4000x3000 phone photos and full decodes made the loader, not the GPU, the bottleneck
    try:
        im = Image.open(path); im.draft("RGB", (600, 600))
        return im.convert("RGB")
    except Exception:
        return Image.new("RGB", (224, 224))


class SkinDataset(Dataset):
    def __init__(self, csv_path, transform):
        self.df, self.transform = pd.read_csv(csv_path), transform

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        return self.transform(load_rgb(row["image_path"])), row["numeric_label"]


class DistillDataset(Dataset):
    def __init__(self, csv_path, clip_probs, transform=train_transform):
        self.df, self.clip_probs, self.transform = pd.read_csv(csv_path), clip_probs, transform

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        image = load_rgb(row["image_path"])
        return self.transform(image), b3_train_transform(image), self.clip_probs[idx], row["numeric_label"]


def build_teacher(pretrained=False):
    m = models.efficientnet_b3(weights=models.EfficientNet_B3_Weights.IMAGENET1K_V1 if pretrained else None)
    m.classifier = nn.Sequential(nn.Dropout(p=0.3), nn.Linear(m.classifier[1].in_features, 512), nn.SiLU(),
                                 nn.Dropout(p=0.2), nn.Linear(512, len(CLASS_NAMES)))
    return m


def build_student(pretrained=True):
    m = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.IMAGENET1K_V1 if pretrained else None)
    m.classifier = nn.Sequential(nn.Linear(m.classifier[0].in_features, 512), nn.Hardswish(), nn.Dropout(p=0.3),
                                 nn.Linear(512, len(CLASS_NAMES)))
    return m


def dual_kd_loss(student_logits, teacher_logits, clip_probs, labels):
    teacher_kd = F.kl_div(F.log_softmax(student_logits / TEMPERATURE, dim=1),
                          F.softmax(teacher_logits / TEMPERATURE, dim=1), reduction="batchmean") * TEMPERATURE ** 2
    clip_kd = F.kl_div(F.log_softmax(student_logits, dim=1), clip_probs, reduction="batchmean")
    hard = F.cross_entropy(student_logits, labels, label_smoothing=0.1)
    return ALPHA_TEACHER * teacher_kd + ALPHA_CLIP * clip_kd + ALPHA_HARD * hard


@torch.no_grad()
def logits_of(model, loader, device):
    model.eval(); out, ys = [], []
    for x, y in loader:
        out.append(model(x.to(device)).float().cpu()); ys.append(y)
    return torch.cat(out), torch.cat(ys)


def report(logits, labels):
    pred = logits.argmax(1).numpy(); y = labels.numpy()
    top3 = (logits.topk(3, dim=1).indices == labels[:, None]).any(1).float().mean().item()
    return {"accuracy": round(100 * accuracy_score(y, pred), 2), "top3_accuracy": round(100 * top3, 2),
            "macro_f1": round(100 * f1_score(y, pred, average="macro"), 2),
            "per_class": classification_report(y, pred, target_names=CLASS_NAMES, zero_division=0, output_dict=True),
            "confusion_matrix": confusion_matrix(y, pred, labels=range(len(CLASS_NAMES))).tolist()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-csv", required=True)
    ap.add_argument("--run-name", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--teacher", default=TEACHER_CHECKPOINT, help="EfficientNet-B3 checkpoint (e.g. from train_teacher.py)")
    ap.add_argument("--epochs", type=int, default=NUM_EPOCHS)
    ap.add_argument("--val-csv", default=VAL_CSV)
    ap.add_argument("--test-csv", default=TEST_CSV)
    ap.add_argument("--img-size", type=int, default=IMG_SIZE, help="student input resolution (teacher stays at B3_SIZE)")
    ap.add_argument("--mix", choices=["none", "mixup", "cutmix"], default="none",
                    help="mix both views of a batch with the same lambda; KD targets come from the mixed inputs")
    ap.add_argument("--mix-alpha", type=float, default=0.4, help="Beta(alpha, alpha) for the mixing ratio")
    ap.add_argument("--ens-teacher", default="", help="comma-separated student checkpoints averaged as the teacher "
                                                      "(replaces the EfficientNet-B3; members see the student's view)")
    ap.add_argument("--limit", type=int, default=0, help="smoke test: use only the first N train rows")
    args = ap.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed); torch.cuda.manual_seed_all(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = f"../models/student_large_clip_dualkd_{args.run_name}.pth"
    print(f"run={args.run_name} train={args.train_csv} teacher={args.ens_teacher or args.teacher} mix={args.mix} seed={args.seed} img_size={args.img_size} device={device}", flush=True)
    student_train_tf, student_val_tf = student_transforms(args.img_size)

    if args.ens_teacher:
        members = []
        for p in args.ens_teacher.split(","):
            m = build_student(pretrained=False); m.load_state_dict(torch.load(p, map_location=device, weights_only=True))
            members.append(m.to(device).eval().requires_grad_(False))
        args.teacher = args.ens_teacher

        def teacher_logits(s_img, t_img):
            # mean of the members' temperature-softened probs, as logits that dual_kd_loss turns back into that mean
            probs = torch.stack([F.softmax(m(s_img) / TEMPERATURE, dim=1) for m in members]).mean(0)
            return TEMPERATURE * torch.log(probs.clamp_min(1e-8))
    else:
        teacher = build_teacher(); teacher.load_state_dict(torch.load(args.teacher, map_location=device, weights_only=True))
        teacher = teacher.to(device).eval().requires_grad_(False)

        def teacher_logits(s_img, t_img):
            return teacher(t_img)

    clip_model, _, clip_preprocess = open_clip.create_model_and_transforms(CLIP_MODEL_NAME, pretrained=CLIP_PRETRAINED)
    clip_model = clip_model.to(device).eval().requires_grad_(False)
    tok = open_clip.get_tokenizer(CLIP_MODEL_NAME)
    with torch.no_grad():
        embs = []
        for c in CLASS_NAMES:
            e = clip_model.encode_text(tok(CLIP_PROMPTS[c]).to(device)); e = (e / e.norm(dim=-1, keepdim=True)).mean(0)
            embs.append(e / e.norm())
        text_emb = torch.stack(embs)

    @torch.no_grad()
    def clip_probs(csv_path):
        loader = DataLoader(SkinDataset(csv_path, clip_preprocess), batch_size=64, shuffle=False, num_workers=args.workers)
        out = []
        for x, _ in loader:
            f = clip_model.encode_image(x.to(device)); f = f / f.norm(dim=-1, keepdim=True)
            out.append(F.softmax(clip_model.logit_scale.exp() * f @ text_emb.T, dim=-1).float().cpu())
        return torch.cat(out)

    if args.limit:
        smoke = f"../models/_smoke_{args.run_name}.csv"; pd.read_csv(args.train_csv).sample(args.limit, random_state=0).to_csv(smoke, index=False)
        args.train_csv = smoke
    t0 = time.time()
    clip_train, clip_test = clip_probs(args.train_csv), clip_probs(args.test_csv)
    del clip_model; torch.cuda.empty_cache()
    print(f"CLIP soft targets precomputed in {time.time() - t0:.0f}s: train {tuple(clip_train.shape)}", flush=True)

    labels = pd.read_csv(args.train_csv)["numeric_label"].values
    counts = np.bincount(labels, minlength=len(CLASS_NAMES)); print("class counts:", dict(zip(CLASS_NAMES, counts.tolist())), flush=True)
    sampler = WeightedRandomSampler((1.0 / counts)[labels], num_samples=len(labels), replacement=True,
                                    generator=torch.Generator().manual_seed(args.seed))
    kw = dict(num_workers=args.workers, pin_memory=True, persistent_workers=args.workers > 0)
    distill_loader = DataLoader(DistillDataset(args.train_csv, clip_train, student_train_tf), batch_size=16, sampler=sampler, **kw)
    val_loader = DataLoader(SkinDataset(args.val_csv, student_val_tf), batch_size=32, shuffle=False, **kw)
    test_loader = DataLoader(SkinDataset(args.test_csv, student_val_tf), batch_size=32, shuffle=False, **kw)

    student = build_student().to(device)
    opt = torch.optim.Adam(student.parameters(), lr=0.0001, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", patience=3, factor=0.5)
    best, bad, history = float("inf"), 0, []
    for epoch in range(1, args.epochs + 1):
        t0 = time.time(); student.train(); run_loss = correct = total = 0
        for s_img, t_img, cp, y in distill_loader:
            s_img, t_img, cp, y = s_img.to(device), t_img.to(device), cp.to(device), y.to(device)
            lam, perm = 1.0, None
            if args.mix != "none":
                lam, perm = float(np.random.beta(args.mix_alpha, args.mix_alpha)), torch.randperm(y.size(0), device=device)
                if args.mix == "mixup":
                    s_img, t_img = lam * s_img + (1 - lam) * s_img[perm], lam * t_img + (1 - lam) * t_img[perm]
                else:  # same relative box in both views (they differ in size)
                    r, (cx, cy) = (1 - lam) ** 0.5, np.random.rand(2)
                    for img in (s_img, t_img):
                        H, W = img.shape[2:]
                        y1, y2 = int(np.clip((cy - r / 2) * H, 0, H)), int(np.clip((cy + r / 2) * H, 0, H))
                        x1, x2 = int(np.clip((cx - r / 2) * W, 0, W)), int(np.clip((cx + r / 2) * W, 0, W))
                        img[:, :, y1:y2, x1:x2] = img[perm][:, :, y1:y2, x1:x2]
                    lam = 1 - (y2 - y1) * (x2 - x1) / (H * W)
                cp = lam * cp + (1 - lam) * cp[perm]
            opt.zero_grad()
            s_logits = student(s_img)
            with torch.no_grad():
                t_logits = teacher_logits(s_img, t_img)
            # the KD terms already see mixed inputs/targets, so only the hard-label term needs the two labels
            loss = dual_kd_loss(s_logits, t_logits, cp, y)
            if perm is not None:
                loss = lam * loss + (1 - lam) * dual_kd_loss(s_logits, t_logits, cp, y[perm])
            loss.backward(); opt.step()
            run_loss += loss.item(); correct += (s_logits.argmax(1) == y).sum().item(); total += y.size(0)
        vl, vy = logits_of(student, val_loader, device)
        val_loss = F.cross_entropy(vl, vy).item(); val_acc = 100 * (vl.argmax(1) == vy).float().mean().item()
        sched.step(val_loss)
        history.append({"epoch": epoch, "train_loss": run_loss / len(distill_loader), "train_acc": 100 * correct / total,
                        "val_loss": val_loss, "val_acc": val_acc})
        mark = ""
        if val_loss < best:
            best, bad, mark = val_loss, 0, " saved"; torch.save(student.state_dict(), ckpt)
        else:
            bad += 1; mark = f" patience {bad}/{PATIENCE}"
        print(f"epoch {epoch} | train loss {run_loss / len(distill_loader):.4f} acc {100 * correct / total:.2f}% | "
              f"val loss {val_loss:.4f} acc {val_acc:.2f}% | {time.time() - t0:.0f}s{mark}", flush=True)
        if bad >= PATIENCE:
            print(f"early stop at epoch {epoch}", flush=True); break

    student.load_state_dict(torch.load(ckpt, map_location=device, weights_only=True))
    results = {"run": args.run_name, "train_csv": args.train_csv, "val_csv": args.val_csv, "test_csv": args.test_csv, "seed": args.seed, "teacher": args.teacher, "img_size": args.img_size,
               "mix": args.mix, "mix_alpha": args.mix_alpha if args.mix != "none" else None,
               "train_class_counts": dict(zip(CLASS_NAMES, counts.tolist())), "history": history,
               "test": report(*logits_of(student, test_loader, device)),
               "clip_alone_test_accuracy": round(100 * accuracy_score(pd.read_csv(args.test_csv)["numeric_label"], clip_test.argmax(1)), 2)}
    if os.path.exists(PRODUCTION_STUDENT):
        prod = build_student(pretrained=False).to(device)
        prod.load_state_dict(torch.load(PRODUCTION_STUDENT, map_location=device, weights_only=True))
        results["production_student_test"] = report(*logits_of(prod, test_loader, device))
    json.dump(results, open(f"../models/dualkd_{args.run_name}_results.json", "w", encoding="utf-8"), indent=1)
    r = results["test"]
    print(f"RESULT {args.run_name}: test acc {r['accuracy']}% | top-3 {r['top3_accuracy']}% | macro-F1 {r['macro_f1']}%", flush=True)
    for c in CLASS_NAMES:
        pc = r["per_class"][c]; print(f"  {c:22s} recall {100 * pc['recall']:.1f}%  f1 {100 * pc['f1-score']:.1f}%  (n={int(pc['support'])})")


if __name__ == "__main__":
    main()
