"""Train the EfficientNet-B3 distillation teacher with 03_model_training.ipynb's "Teacher Final" recipe, as a script:
ImageNet-pretrained B3, fully unfrozen, head dropout 0.3/0.2, Adam lr 5e-5 wd 1e-4, label smoothing 0.1,
inverse-frequency weighted sampler, batch 16, 300px augmentation, ReduceLROnPlateau(patience 3, factor 0.5),
early stopping on val loss (patience 3, max 40 epochs). Only --train-csv differs between runs.

    cd notebooks
    python train_teacher.py --train-csv ../data/processed/train_augmented.csv --run-name augdata --seed 0
Writes ../models/teacher_b3_<run>.pth and ../models/teacher_<run>_results.json; then distil with
    python train_dualkd.py --train-csv ... --teacher ../models/teacher_b3_<run>.pth --run-name ...
"""
import argparse, json, random, time
import numpy as np, pandas as pd, torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import DataLoader, WeightedRandomSampler
import torchvision.transforms as transforms
from train_dualkd import (B3_SIZE, CLASS_NAMES, NORM, TEST_CSV, VAL_CSV, SkinDataset, b3_train_transform,
                          build_teacher, logits_of, report)

b3_val_transform = transforms.Compose([transforms.Resize((B3_SIZE, B3_SIZE)), transforms.ToTensor(), NORM])
NUM_EPOCHS, PATIENCE = 40, 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-csv", required=True)
    ap.add_argument("--run-name", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--epochs", type=int, default=NUM_EPOCHS)
    args = ap.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed); torch.cuda.manual_seed_all(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = f"../models/teacher_b3_{args.run_name}.pth"
    print(f"teacher run={args.run_name} train={args.train_csv} seed={args.seed} device={device}", flush=True)

    labels = pd.read_csv(args.train_csv)["numeric_label"].values
    counts = np.bincount(labels, minlength=len(CLASS_NAMES)); print("class counts:", dict(zip(CLASS_NAMES, counts.tolist())), flush=True)
    sampler = WeightedRandomSampler((1.0 / counts)[labels], num_samples=len(labels), replacement=True,
                                    generator=torch.Generator().manual_seed(args.seed))
    kw = dict(num_workers=args.workers, pin_memory=True, persistent_workers=args.workers > 0)
    train_loader = DataLoader(SkinDataset(args.train_csv, b3_train_transform), batch_size=16, sampler=sampler, **kw)
    val_loader = DataLoader(SkinDataset(VAL_CSV, b3_val_transform), batch_size=16, shuffle=False, **kw)
    test_loader = DataLoader(SkinDataset(TEST_CSV, b3_val_transform), batch_size=16, shuffle=False, **kw)

    teacher = build_teacher(pretrained=True).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.1)
    opt = torch.optim.Adam(teacher.parameters(), lr=0.00005, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", patience=3, factor=0.5)
    best, bad, history = float("inf"), 0, []
    for epoch in range(1, args.epochs + 1):
        t0 = time.time(); teacher.train(); run_loss = correct = total = 0
        for x, y in train_loader:
            x, y = x.to(device), y.to(device)
            opt.zero_grad(); out = teacher(x); loss = criterion(out, y); loss.backward(); opt.step()
            run_loss += loss.item(); correct += (out.argmax(1) == y).sum().item(); total += y.size(0)
        vl, vy = logits_of(teacher, val_loader, device)
        val_loss = criterion(vl, vy).item(); val_acc = 100 * (vl.argmax(1) == vy).float().mean().item()
        sched.step(val_loss)
        history.append({"epoch": epoch, "train_loss": run_loss / len(train_loader), "train_acc": 100 * correct / total,
                        "val_loss": val_loss, "val_acc": val_acc})
        if val_loss < best:
            best, bad, mark = val_loss, 0, " saved"; torch.save(teacher.state_dict(), ckpt)
        else:
            bad += 1; mark = f" patience {bad}/{PATIENCE}"
        print(f"epoch {epoch} | train loss {run_loss / len(train_loader):.4f} acc {100 * correct / total:.2f}% | "
              f"val loss {val_loss:.4f} acc {val_acc:.2f}% | {time.time() - t0:.0f}s{mark}", flush=True)
        if bad >= PATIENCE:
            print(f"early stop at epoch {epoch}", flush=True); break

    teacher.load_state_dict(torch.load(ckpt, map_location=device, weights_only=True))
    results = {"run": args.run_name, "train_csv": args.train_csv, "seed": args.seed, "history": history,
               "train_class_counts": dict(zip(CLASS_NAMES, counts.tolist())), "test": report(*logits_of(teacher, test_loader, device))}
    json.dump(results, open(f"../models/teacher_{args.run_name}_results.json", "w", encoding="utf-8"), indent=1)
    r = results["test"]
    print(f"RESULT teacher {args.run_name}: test acc {r['accuracy']}% | top-3 {r['top3_accuracy']}% | macro-F1 {r['macro_f1']}%", flush=True)
    for c in CLASS_NAMES:
        pc = r["per_class"][c]; print(f"  {c:22s} recall {100 * pc['recall']:.1f}%  f1 {100 * pc['f1-score']:.1f}%  (n={int(pc['support'])})")


if __name__ == "__main__":
    main()
