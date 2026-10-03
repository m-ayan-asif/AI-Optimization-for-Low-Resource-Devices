"""Fetch only the Atlas Dermatologico-hosted Fitzpatrick17k images (DermaAmin host does not resolve). Polite: 2 threads."""
import os, io, time, concurrent.futures as cf
import pandas as pd, requests
from PIL import Image
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw", "Fitzpatrick17k")
KEEP = {"seborrheic dermatitis":"Seborrheic Dermatitis","allergic contact dermatitis":"Contact Dermatitis","vitiligo":"Vitiligo","psoriasis":"Psoriasis"}
d = pd.read_csv(os.path.join(os.path.dirname(OUT), "f17k_labels.csv"))
d = d[d.label.isin(KEEP) & d.url.str.contains("atlasdermatologico")].reset_index(drop=True)
H = {"User-Agent": "Mozilla/5.0 (academic research; skin classification FYP)"}
def fetch(r):
    cls = KEEP[r.label]; f = os.path.join(OUT, cls.replace(" ", "_")); os.makedirs(f, exist_ok=True)
    p = os.path.join(f, r.md5hash + ".jpg")
    if os.path.exists(p): return r.md5hash, cls, p, "cached"
    for a in range(3):
        try:
            x = requests.get(r.url, headers=H, timeout=30); x.raise_for_status()
            Image.open(io.BytesIO(x.content)).convert("RGB").save(p, quality=95); time.sleep(0.3); return r.md5hash, cls, p, "ok"
        except Exception as e: err = str(e)[:60]; time.sleep(1+a)
    return r.md5hash, cls, None, "fail:"+err
with cf.ThreadPoolExecutor(2) as ex: res = list(ex.map(fetch, d.itertuples()))
m = pd.DataFrame(res, columns=["md5hash","unified_label","image_path","status"]); m.to_csv(os.path.join(OUT,"manifest.csv"), index=False)
print(m.status.str[:4].value_counts()); print(m[m.status.isin(["ok","cached"])].unified_label.value_counts())
