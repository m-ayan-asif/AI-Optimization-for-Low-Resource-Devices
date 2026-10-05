"""Dedup new images against existing train/val/test, then write processed/train_augmented.csv.
Existing val.csv/test.csv are never modified.

Near-duplicates are found by cosine similarity of CLIP ViT-B-32 image embeddings (cached by
data/clip_embed_cache.py). The earlier 64-bit dHash flagged unrelated smooth-skin photos as duplicates
(e.g. a MEMI-DS forehead crop at distance 0 from a DermNet eczema close-up), silently discarding real data.
Calibrated by inspecting pairs per similarity band: exact copies sit at >= 0.99 (gap at 0.98-0.99), while
different photos of the same patient appear at 0.92-0.96. So the threshold is asymmetric:
  - vs val/test: SIM_EVAL (0.95) - strict, same-patient shots would inflate test accuracy
  - vs train / already-accepted new images: SIM_TRAIN (0.98) - only exact copies are pure redundancy"""
import os, glob, json, re, subprocess, sys, tempfile, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "data", "processed")
SIM_EVAL, SIM_TRAIN = 0.95, 0.98
CACHE = os.path.join(P, "clip_emb_cache.npz")

def resolve(p): return os.path.normpath(os.path.join(ROOT, "notebooks", p))  # csv paths are relative to notebooks/
sets = {s: pd.read_csv(os.path.join(P, f"{s}.csv")) for s in ["train", "val", "test"]}
lab2num = dict(zip(sets["train"].unified_label, sets["train"].numeric_label))

# ---- candidate new images
cands = []
sel = json.load(open(os.path.join(ROOT, "data/raw/DermNet_full_mirror/selection.json")))
for rel, cls in sel.items():
    cands.append((os.path.join(ROOT, "data/raw/DermNet_full_mirror", rel), cls, "DermNet-full"))
for cls, folder in [("Seborrheic Dermatitis", "Seborrheic_Dermatitis"), ("Contact Dermatitis", "Allergic_Contact_Dermatitis")]:
    for f in glob.glob(os.path.join(ROOT, "data/raw/DoctorSkinDisease", "**", folder, "*"), recursive=True):
        if re.search(r"\.(jpe?g|png)$", f, re.I): cands.append((f, cls, "DoctorSkinDisease"))
m = pd.read_csv(os.path.join(ROOT, "data/raw/Fitzpatrick17k/manifest.csv")); m = m[m.status.isin(["ok", "cached"])]
for r in m.itertuples(): cands.append((r.image_path if os.path.isabs(r.image_path) else os.path.join(ROOT, r.image_path), r.unified_label, "Fitzpatrick17k"))
for f in sorted(glob.glob(os.path.join(ROOT, "data/raw/MEMI-DS/crops", "*.jpg"))):  # lesion crops from build_memi_crops.py
    cands.append((f, "Melasma", "MEMI-DS"))
sdbd = pd.read_csv(os.path.join(ROOT, "data/raw/SkinDiseaseBD/raw_labels.csv"))  # from label_skindiseasebd.py
for r in sdbd[(sdbd.votes == 5) & sdbd.label.isin(["Dermatitis", "Vitiligo"])].itertuples():
    cands.append((r.path, {"Dermatitis": "Contact Dermatitis"}.get(r.label, r.label), "SkinDiseaseBD"))
cands = [(os.path.normpath(p), c, src) for p, c, src in cands]
print("candidates:", len(cands))

# ---- embed (cached) and dedup
existing = [(s, resolve(p)) for s, d in sets.items() for p in d.image_path]
allp = [p for _, p in existing] + [c[0] for c in cands]
C = np.load(CACHE, allow_pickle=True)["d"].item() if os.path.exists(CACHE) else {}
if any(p not in C for p in allp):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f: f.write("\n".join(allp))
    subprocess.run([sys.executable, os.path.join(ROOT, "data", "clip_embed_cache.py"), f.name], check=True)
    C = np.load(CACHE, allow_pickle=True)["d"].item()
ok = [p in C for _, p in existing]
print(f"existing: {len(existing)} unreadable/missing: {ok.count(False)}")
E = np.stack([C[p] for (_, p), o in zip(existing, ok) if o]).astype(np.float32)
ES = np.array([s for (s, _), o in zip(existing, ok) if o])
acc_e, kept, drop = [], [], {"unreadable": 0, "dup_test": 0, "dup_val": 0, "dup_train": 0, "dup_new": 0}
drop_by_class = {}
for path, cls, src in cands:
    if path not in C: drop["unreadable"] += 1; continue
    e = C[path].astype(np.float32); sim = E @ e
    reason = None
    if (sim[ES == "test"] >= SIM_EVAL).any(): reason = "dup_test"
    elif (sim[ES == "val"] >= SIM_EVAL).any(): reason = "dup_val"
    elif (sim[ES == "train"] >= SIM_TRAIN).any(): reason = "dup_train"
    elif acc_e and (np.stack(acc_e) @ e >= SIM_TRAIN).any(): reason = "dup_new"
    if reason: drop[reason] += 1; drop_by_class[(cls, reason)] = drop_by_class.get((cls, reason), 0) + 1; continue
    acc_e.append(e); kept.append((path, cls, src))
print("dropped:", drop)
new = pd.DataFrame([{ "image_path": os.path.relpath(p, os.path.join(ROOT, "notebooks")).replace("\\", "/"),
                      "unified_label": c, "numeric_label": lab2num[c], "source": s} for p, c, s in kept])
aug = pd.concat([sets["train"], new], ignore_index=True)
aug.to_csv(os.path.join(P, "train_augmented.csv"), index=False)
before, after = sets["train"].unified_label.value_counts(), aug.unified_label.value_counts()
print(pd.DataFrame({"before": before, "after": after, "added": after - before}).to_string())
print(new.groupby(["unified_label", "source"]).size().to_string())
print("dropped by class/reason:", drop_by_class)
