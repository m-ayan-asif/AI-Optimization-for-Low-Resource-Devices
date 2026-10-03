"""Download the Fitzpatrick17k subset for under-represented classes into data/raw/Fitzpatrick17k.
Source list: https://github.com/mattgroh/fitzpatrick17k (CC BY-NC-SA 3.0, images hosted by DermaAmin / Atlas Dermatologico).
Only the labels in KEEP are fetched. Writes manifest.csv with the mapped unified_label.
"""
import os, sys, csv, time, io, concurrent.futures as cf
import pandas as pd, requests
from PIL import Image

CSV = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw", "Fitzpatrick17k")
KEEP = {
    "seborrheic dermatitis": "Seborrheic Dermatitis",
    "allergic contact dermatitis": "Contact Dermatitis",
    "vitiligo": "Vitiligo",
    "psoriasis": "Psoriasis",
}
d = pd.read_csv(CSV)
d = d[d["label"].isin(KEEP)].reset_index(drop=True)
os.makedirs(OUT, exist_ok=True)
H = {"User-Agent": "Mozilla/5.0 (academic research; skin classification FYP)"}

def fetch(row):
    cls = KEEP[row.label]
    folder = os.path.join(OUT, cls.replace(" ", "_")); os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, row.md5hash + ".jpg")
    if os.path.exists(path): return row.md5hash, cls, path, "cached"
    for attempt in range(3):
        try:
            r = requests.get(row.url, headers=H, timeout=30)
            if r.status_code != 200: raise RuntimeError(r.status_code)
            Image.open(io.BytesIO(r.content)).convert("RGB").save(path, quality=95)
            return row.md5hash, cls, path, "ok"
        except Exception as e:
            err = str(e)[:60]; time.sleep(1 + attempt)
    return row.md5hash, cls, None, "fail:" + err

rows = list(d.itertuples())
res = []
with cf.ThreadPoolExecutor(4) as ex:
    for i, r in enumerate(ex.map(fetch, rows), 1):
        res.append(r)
        if i % 100 == 0: print(i, "/", len(rows), flush=True)
m = pd.DataFrame(res, columns=["md5hash", "unified_label", "image_path", "status"])
m = m.merge(d[["md5hash", "fitzpatrick_scale", "url"]], on="md5hash")
m.to_csv(os.path.join(OUT, "manifest.csv"), index=False)
print(m["status"].str[:4].value_counts()); print(m[m.status.isin(["ok","cached"])].unified_label.value_counts())
