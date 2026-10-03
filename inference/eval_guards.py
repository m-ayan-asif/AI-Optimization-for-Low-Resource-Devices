"""Evaluate the skin-detection + confidence/entropy guards against a labeled
test set, following the plan: run every negative/ and positive/<class>/ image
through /predict, record status/confidence/entropy/margin, and report:

  - false accepts: negatives that got a disease label (status == "classified")
  - not classified: positives that got rejected/inconclusive
    (status != "classified")

Writes guard_eval.csv with per-image results.

Usage: python eval_guards.py [--base-url http://127.0.0.1:5001]
"""
import argparse
import csv
import os
import time

import requests

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5001")
parser.add_argument("--test-dir", default=os.path.join(os.path.dirname(__file__), "test_images"))
args = parser.parse_args()

NEG_DIR = os.path.join(args.test_dir, "negative")
POS_DIR = os.path.join(args.test_dir, "positive")


def collect_images(root, label_from_subdir=False):
    items = []
    if not os.path.isdir(root):
        return items
    if label_from_subdir:
        for sub in sorted(os.listdir(root)):
            subdir = os.path.join(root, sub)
            if not os.path.isdir(subdir):
                continue
            for f in sorted(os.listdir(subdir)):
                items.append((os.path.join(subdir, f), sub))
    else:
        for f in sorted(os.listdir(root)):
            p = os.path.join(root, f)
            if os.path.isfile(p):
                items.append((p, None))
    return items


negatives = [(p, "negative", None) for p, _ in collect_images(NEG_DIR)]
positives = [(p, "positive", cls) for p, cls in collect_images(POS_DIR, label_from_subdir=True)]
all_items = negatives + positives

print(f"Found {len(negatives)} negatives, {len(positives)} positives")

rows = []
for path, kind, true_class in all_items:
    try:
        with open(path, "rb") as f:
            t0 = time.time()
            r = requests.post(f"{args.base_url}/predict", files={"image": (os.path.basename(path), f, "image/png")}, timeout=60)
            latency_ms = (time.time() - t0) * 1000
        if r.status_code != 200:
            rows.append({
                "path": path, "kind": kind, "true_class": true_class,
                "http_status": r.status_code, "status": "http_error",
                "top_condition": None, "confidence_score": None,
                "entropy": None, "confidence_margin": None, "latency_ms": latency_ms,
            })
            continue
        body = r.json()
        telemetry = body.get("telemetry", {})
        rows.append({
            "path": path, "kind": kind, "true_class": true_class,
            "http_status": 200, "status": body.get("status"),
            "top_condition": body.get("top_condition"),
            "confidence_score": body.get("confidence_score"),
            "entropy": telemetry.get("entropy"),
            "confidence_margin": telemetry.get("confidence_margin"),
            "latency_ms": latency_ms,
        })
    except Exception as e:
        rows.append({
            "path": path, "kind": kind, "true_class": true_class,
            "http_status": "error", "status": f"exception:{e}",
            "top_condition": None, "confidence_score": None,
            "entropy": None, "confidence_margin": None, "latency_ms": None,
        })

out_csv = os.path.join(os.path.dirname(__file__), "guard_eval.csv")
with open(out_csv, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
    writer.writeheader()
    writer.writerows(rows)

false_accepts = [r for r in rows if r["kind"] == "negative" and r["status"] == "classified"]
not_classified = [r for r in rows if r["kind"] == "positive" and r["status"] != "classified"]

n_neg = len(negatives)
n_pos = len(positives)

print()
print(f"=== Summary ===")
print(f"False accepts (negatives classified as a disease): {len(false_accepts)}/{n_neg} "
      f"({100*len(false_accepts)/n_neg:.1f}%)" if n_neg else "False accepts: n/a (no negatives)")
print(f"Not classified (real positives rejected/inconclusive): {len(not_classified)}/{n_pos} "
      f"({100*len(not_classified)/n_pos:.1f}%)" if n_pos else "Not classified: n/a (no positives)")
print(f"Full results written to {out_csv}")

if false_accepts:
    print("\nFalse-accept examples:")
    for r in false_accepts[:10]:
        print(f"  {os.path.basename(r['path'])}: top_condition={r['top_condition']} "
              f"confidence={r['confidence_score']} entropy={r['entropy']} margin={r['confidence_margin']}")

if not_classified:
    print("\nNot-classified examples:")
    for r in not_classified[:10]:
        print(f"  {os.path.basename(r['path'])} (true={r['true_class']}): status={r['status']} "
              f"top_condition={r['top_condition']} confidence={r['confidence_score']}")
