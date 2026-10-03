"""Cache L2-normalised CLIP ViT-B-32 (openai) image embeddings for near-duplicate detection.
Usage: python data/clip_embed_cache.py <list.txt of absolute image paths>  -> data/processed/clip_emb_cache.npz
Already-cached paths are skipped. CPU by default (CLIP_DEVICE=cuda to override)."""
import os, sys, numpy as np, torch, open_clip
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "processed", "clip_emb_cache.npz")
DEV = os.environ.get("CLIP_DEVICE", "cpu"); torch.set_num_threads(6)
paths = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
cache = dict(np.load(CACHE, allow_pickle=True)["d"].item()) if os.path.exists(CACHE) else {}
todo = [p for p in dict.fromkeys(paths) if p not in cache]
print(f"{len(paths)} paths, {len(todo)} to embed", flush=True)
model, _, prep = open_clip.create_model_and_transforms("ViT-B-32-quickgelu", pretrained="openai", device=DEV); model.eval()

def load(p):
    try:
        im = Image.open(p); im.draft("RGB", (448, 448)); return prep(im.convert("RGB"))
    except Exception: return None

with ThreadPoolExecutor(6) as ex, torch.no_grad():
    for i in range(0, len(todo), 64):
        chunk = todo[i:i + 64]; ims = list(ex.map(load, chunk))
        ok = [(p, t) for p, t in zip(chunk, ims) if t is not None]
        if ok:
            e = model.encode_image(torch.stack([t for _, t in ok]).to(DEV)); e = (e / e.norm(dim=-1, keepdim=True)).cpu().numpy().astype(np.float16)
            cache.update({p: v for (p, _), v in zip(ok, e)})
        if (i // 64) % 20 == 0:
            print(f"  {i + len(chunk)}/{len(todo)}", flush=True); np.savez(CACHE, d=np.array(cache, dtype=object))
np.savez(CACHE, d=np.array(cache, dtype=object)); print("cached:", len(cache))
