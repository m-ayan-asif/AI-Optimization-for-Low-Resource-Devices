# Accuracy experiments — 2026-10-03/04

Student: MobileNetV3-Large, CLIP dual-KD (`notebooks/train_dualkd.py`). Every arm was run with 3 seeds; numbers are
test accuracy mean ± sd unless noted. Seed-to-seed spread is about ±0.4 pt, and a same-seed rerun can differ by
about 2 pt because of GPU nondeterminism, so single runs are not evidence.

## Headline

**The data, not the training method, is the ceiling.** Every training-side change moved accuracy by less than seed
noise or made it worse. The label audit found a train→test leak and label noise, and those dominate the remaining
error. Honest accuracy on unseen images is **≈73%**, not the 74.5–75% reported so far. 80% is not reachable on the
current labels.

## Results (original splits — inflated by the leak, but comparable with each other)

| Arm | Test acc | Top-3 | Macro-F1 | Verdict |
|---|---|---|---|---|
| control (train.csv, B3 teacher d2ad, 224) | 74.57 ± 0.40 | 95.86 | 67.83 | baseline |
| + extra rare-class data (train_augmented) | 74.49 ± 0.39 | 96.02 | 68.07 | no gain |
| + B3 teacher retrained on extra data (teacher 73.30 vs 71.82) | 73.08 ± 0.95 | 95.65 | 65.96 | worse |
| input 320 instead of 224 | 74.99 ± 1.33 | 96.23 | 70.03 | only survivor; within noise on acc, +2.2 macro-F1 (Psoriasis +5, Contact +3, Seb Derm +3 recall); 2× phone compute |
| mixup α=0.4 | 71.57 ± 0.95 | 95.94 | 65.93 | worse |
| teacher = mean of 6 trained students | 73.40 ± 0.21 | 95.53 | 65.69 | worse |
| 80-epoch cap (new-teacher arm, 1 run) | 71.62 | — | — | inconclusive: early-stopped at 29, the cap never bound |

Inference-time only (`.bench/acc/step1_results.md`):

| | Test acc | Cost | Verdict |
|---|---|---|---|
| flip-TTA, production model | 74.98 → 75.06 | 4× | not worth shipping |
| ensemble of 9 students + flip-TTA | 77.2–77.6 | 9×–36× | real (+3 pt), but only fits the online path (branch C), not on-device |

**Better teacher ⇒ worse student, twice.** Both a stronger B3 teacher and a 77% student ensemble produced weaker
students. Likely cause: the teachers had fit the training set (students ~95% train acc), so on training images
their targets are near one-hot and carry no extra signal. A teacher would need to be scored on data it was not
trained on (k-fold teachers) to help.

## Label audit (`.bench/labels/labels_findings.md`)

- **Leak:** 332 / 2,438 test images (13.6%) have a pixel-identical copy in train/val; 405 (16.6%) counting re-crops of
  the same lesion. Val has the same problem (224 / 277). Students score 80–84% on leaked test images and ~73% on the
  rest.
- **Conflicting duplicates:** 99 groups, 212 images, 42 in test. Mostly SkinDiseaseImage / DermNet, where the same
  photo sits in two disease folders. Pairs: Eczema/Psoriasis (60), Psoriasis/Seb Derm (24), Eczema/Tinea (13).
- **Likely mislabelled test images:** ~130 (5.3%). Psoriasis 9.2%, Contact Derm 8.1%, Eczema 4.4%, Seb Derm 17.6%
  (6/34). The noise sits on Psoriasis↔Eczema, which is also the models' top confusion.
- 31 histology/biopsy files (at least one microscope slide) are mixed into the image data.
- Clean splits: `.bench/labels/{train,val,test,train_augmented}_clean.csv`. Removal rules: conflicting groups dropped,
  train copies of val/test dropped, within-split dupes deduped, 64 strong flags dropped from train only. Val/test are
  never pruned on a model's say-so. The originals in `data/processed/` are untouched.

## Plan going forward

1. **Clean baseline (done 2026-10-05, `models/clean_split_summary.md`):** 3 seeds each on the clean splits.
   control 224: **72.03 ± 1.21** acc, 95.89 top-3, 67.99 macro-F1. res320: **73.70 ± 0.81** acc, 96.59 top-3,
   70.44 macro-F1. 320 gains +1.7 acc and +2.5 macro-F1 (more than the seed noise), mostly on Contact Derm, Seb Derm
   and Eczema. The production student scores 75.74 on the clean test, but it was trained on the leaky train split,
   which still holds copies of clean-test images (the clean split dropped them from train only), so that number is
   inflated. These are now the only numbers to report.
2. **Fix labels by hand:** review `.bench/labels/flags_<class>.jpg`, the ~130 test suspects first, then the strong train
   flags. Remove the histology images.
3. **Group-aware split:** keep all near-duplicates of one lesion in the same split so the leak cannot come back.
4. **Retrain once** on the corrected data. Stop tuning methods.
5. If the production model changes: re-run `inference/sweep_guards.py` (the energy threshold is model-specific) and
   update every place that quotes 74.98%.

**Stop:** method tweaks and teacher swaps, more data from the same noisy web sources, chasing 80% on these labels.

## Defense framing

- Lead with the leak: "we found and fixed a 13.6% train/test leak; honest accuracy is ~73%."
- The negative results are findings: stronger teacher ⇒ weaker student, extra noisy data ⇒ no gain, mixup hurts.
- Screening metrics: top-3 ≈ 96%, per-class recall, guard behaviour (out-of-scope rejection).
- The ensemble shows the accuracy-for-compute tradeoff: ≈77% at 9× compute belongs on the online second-opinion
  path (branch C), not on-device. This fits the A/B/C partition.
- Consider reporting a merged "dermatitis" group (Eczema / Contact / Seb Derm) alongside the 7 classes, if the
  supervisor agrees; clinicians confuse these too.

## Where things are

- Run results: `models/dualkd_<run>_results.json` and `.log`; queue log `models/gpu_queue.log` (all gitignored).
- Training script flags added (uncommitted): `--teacher`, `--img-size`, `--mix/--mix-alpha`, `--ens-teacher`,
  `--val-csv/--test-csv`.
- GPU queue: `.bench/queue/gpu_queue.py [jobs-file]`; append lines to the jobs file, add `END` to make it exit.
