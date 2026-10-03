"""Label SkinDiseaseBD's 197 unlabeled raw photos (Raw_Images.zip) via their labelled augmented copies.
Mendeley 9ggd3shdr7 (CC BY-NC 4.0) ships raw photos as 1..197.jpg with no labels; only the class-balanced
augmented set (Images_512x512_v2.zip) has class folders. Each raw photo gets the majority class of its 5 most
CLIP-similar augmented images; only unanimous (5/5) assignments are used downstream (build_train_augmented.py).
Needs embeddings from clip_embed_cache.py for both folders. Writes data/raw/SkinDiseaseBD/raw_labels.csv."""
import os, glob, collections, numpy as np, pandas as pd
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, "data", "raw", "SkinDiseaseBD")
C = np.load(os.path.join(ROOT, "data", "processed", "clip_emb_cache.npz"), allow_pickle=True)["d"].item()
raw = sorted(os.path.normpath(p) for p in glob.glob(os.path.join(B, "raw", "ResearchImage", "*.jpg")))
aug = [os.path.normpath(p) for p in glob.glob(os.path.join(B, "aug512", "Updated Images", "*", "*"))]
al = np.array([os.path.basename(os.path.dirname(p)) for p in aug])
S = np.stack([C[p] for p in raw]).astype(np.float32) @ np.stack([C[p] for p in aug]).astype(np.float32).T
top = np.argsort(-S, 1)[:, :5]
rows = [(p, *collections.Counter(al[top[i]]).most_common(1)[0], S[i, top[i, 0]]) for i, p in enumerate(raw)]
d = pd.DataFrame(rows, columns=["path", "label", "votes", "top_sim"]); d.to_csv(os.path.join(B, "raw_labels.csv"), index=False)
print(d.groupby("label").votes.apply(lambda v: f"{(v == 5).sum()}/{len(v)} unanimous").to_string())
