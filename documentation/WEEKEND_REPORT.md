# Weekend report: Fri 2 Oct → Mon 5 Oct 2026

This report covers everything done on SkinSense between Friday evening (2 Oct) and Monday morning (5 Oct) 2026. That includes what we tested, what we changed, what we kept, what we dropped, and why. All times are local (PKT).

Detailed companion notes:
- [`ACCURACY_EXPERIMENTS.md`](ACCURACY_EXPERIMENTS.md): the classifier experiments, in more depth.
- `.bench/labels/labels_findings.md`: the label audit. It is local and not in git.

---

## TL;DR

**What ships**

| Part | Choice | Key number |
|---|---|---|
| Image classifier | MobileNetV3-Large student, 3.47M params, 14 MB. Distilled from an EfficientNet-B3 teacher **and** CLIP, using two separate KL terms ("dual-KD"). Trained on the cleaned splits at **320×320** input. | **73.70 ± 0.81 %** test accuracy, 96.59 % top-3, 70.44 macro-F1 (3 seeds, clean split) |
| Speech-to-text (`/transcribe`) | Our own whisper-small Urdu fine-tune (244M params). It replaces a 3.2 GB whisper-large-v3-turbo Urdu model. | Ties the turbo on unseen speech (29.8 vs 30.2 % WER) at about a third of the compute |
| Input guards | Skin-colour pre-filter (threshold 0.15 → 0.05), a new **energy** out-of-distribution score, and (Monday night) a trained **"not a skin lesion" output** that rejects the photo, on top of the existing blur, confidence and entropy checks | Real non-skin photos given a diagnosis 81/172 → **10/172**; synthetic 5/36 → 0/36; real lesions wrongly rejected 9.2 % → 8.1 % |
| Deployment | **PC:** Docker Compose (Postgres, Express, CPU inference, Caddy with HTTPS). **Phone:** installable PWA that runs the skin model *and* Whisper on the device, offline, and syncs when back online | Phone models: 13 MB skin model (bit-exact with PyTorch, 74.71 % clean test) + 330 MB int8 Whisper (23.3 % WER vs 23.6 % PyTorch) |
| Full server footprint (CPU) | 320 student + our whisper-small | **2.85 GB peak RAM** (the old turbo stack peaked at 4.71 GB) |

**The most important finding of the weekend** was a data problem, not a modelling one:
- **Test leak:** 13.6 % of the test set (16.6 % counting re-crops) had a copy in the training data.
- **Mislabels:** about 5 % of test images look mislabelled.

Earlier headline numbers (74.98 %) were inflated by 1–2 points. Accuracy on truly unseen images is **about 72–74 %**. Every training-method tweak we tried moved accuracy by less than seed noise or made it worse. Higher input resolution was the only change that survived. **80 % is not reachable on the current labels.**

---

## Timeline

### Friday 2 Oct
- **Teammate branch (Usman Haroon, `feature/runtime-device-monitoring`)**, merged later that night:
  - case-ownership checks on all screening routes, plus migration `004_guard_metrics.sql`;
  - English/Urdu text for validation errors and fallback banners;
  - a directory-traversal fix on the heatmap endpoint.
- **Benchmark sweep (started Thursday):** a full-convergence run of every training notebook and every CLIP branch on the RTX 4060 (8 GB).
  - **Windows DataLoader problems:** workers hang when spawned from inside a Jupyter kernel. Fixed by moving Dataset classes into modules and using `persistent_workers=True`.
  - **Results:** the brain-inspired `altModels` ablation finished around 22:35. Branch A (CLIP distillation), branch B (text fusion) and branch C (online second opinion) finished by about 02:30 Saturday.

### Saturday 3 Oct
- **02:39–03:12 — consolidation, pushed to `origin`:**
  - Branch A was merged and the CLIP dual-KD student became the production `/predict` model (`4bd7fc4`).
  - The monitoring branch was merged into `main`.
  - `feature/clip-text-fusion` also took the monitoring branch, plus an "experimental" guard on `/predict_fused`: it returns 412 unless `acknowledge_experimental=true`.
- **Morning — investigation:**
  - A review of the guards showed the skin check is a colour filter: a car on sand passes it.
  - We measured RAM per branch on CPU.
  - We settled the deployment target: **the whole product must run offline on both a PC and a phone**. That made Whisper the bottleneck.
- **Midday — three parallel workstreams:**
  1. Compare existing Urdu Whisper models.
  2. Fine-tune our own whisper-small.
  3. Find extra images for the weakest classes.
- **Afternoon:**
  - **ASR:** found and fixed a label-masking bug in the Whisper training loop, then retrained (4,000 steps, about 2 h).
  - **Data:** added MEMI-DS (melasma) and SkinDiseaseBD, and replaced the dHash duplicate filter with CLIP-embedding similarity.
- **Evening:**
  - Benchmarked our Whisper and made it the `/transcribe` default.
  - Committed the work as `a2a9342`, `ba59751`, `be3c3a4` and `89ca9bc`.
  - Pushed the 966 MB Whisper weights through Git LFS (`b417b18`).
  - First data ablation, seed 0: control 75.02 vs extra data 74.94.

### Sunday 4 Oct
- **02:35 — teacher training:** committed `train_teacher.py` and the `--teacher` flag (`2674b9b`).
- **Overnight queue:** a teacher retrain on the extra data, then 3 setups × 3 seeds of the student, then an 80-epoch run.
- **Morning:** results came in.
  - Neither the extra data nor the better teacher helped.
  - The Whisper real-speech check showed our model ties the turbo.
  - The guard work was finished: real non-skin photos, the energy score, and the GradCAM test fix.
- **12:00–21:36 — five-step accuracy plan:**
  1. TTA and seed ensembles (CPU).
  2. Label audit (CPU), which **found the leak**.
  3. 320 px input.
  4. Mixup.
  5. Student ensemble as teacher.
- **Night:** wrote everything into `ACCURACY_EXPERIMENTS.md` and staged the clean-split rerun.

### Monday 5 Oct
- **02:27–05:39 — clean-split rerun:** 224 vs 320, 3 seeds each, about 3.2 h with no errors.
- **Morning:**
  - Results recorded.
  - The 320 student picked for shipping.
  - RAM of the full serving stack measured.
- **Rest of the day — production deployment** (section 10):
  - The 320 student put into the server, guards re-swept for it (energy threshold 2.37 → 2.31).
  - Docker Compose stack for the PC, verified end to end.
  - Skin model and Whisper exported to ONNX for the phone, accuracy re-checked after export.
  - The web client turned into an installable PWA with on-device inference, an offline outbox and sync.

---

## 1. CLIP dual-KD student to production (branch A)

**Claim:** distilling from CLIP as a *second, separate* teacher improves the on-device student at zero runtime cost, because CLIP never ships.

**Results** (Friday sweep, original splits, single runs):

| Variant | On-device params | Test acc |
|---|---|---|
| Baseline large student (B3 teacher only) | 3.47M | 71.70 % |
| CLIP blended into the teacher's target, flat weight 0.3 | 3.47M | 69.03 % |
| CLIP blend, confidence-weighted | 3.47M | 47.13 % |
| **CLIP dual-KD** (separate KL terms: 0.49 teacher, 0.21 CLIP, 0.30 hard labels) | 3.47M | **74.98 %** |
| EfficientNet-B3 teacher alone | 11.5M | 73.09 % |
| CLIP zero-shot alone | 150M | 27.24 % |

- **Alternatives considered:**
  - **Blending** the two teachers into one soft target. It averages away their disagreements into a mushy target, and it was worse than baseline in both forms.
  - **Running CLIP at inference** (branches B and C). This costs 0.6–3.7 GB more RAM.
- **What decided it:** dual-KD was the only variant to beat the baseline, and the teacher too, with zero added inference cost. It became the production model on Saturday.
- **Later correction:**
  - The teacher behind this 74.98 % run is no longer on disk.
  - The other old copy (`.bench/models_before_retrain/teacher_final.pth`) predates the 26 Sep re-split and scores 78.6 % on today's test set, so it has seen test images. **It must never be used as a teacher.**
  - All weekend experiments use the split-matched teacher `models/teacher_b3_split0926.pth` (71.82 % test).
  - The 74.98 % was itself inflated by the leak (§7).

**Other branches** (recorded for the benchmark table, not shipped):
- **Branch B** (CLIP text fusion):
  - 95.08 % with matching symptom text, but the text is synthetic.
  - Accuracy drops to 52.91 % with mismatched text, which shows the text really is being used.
  - It runs 155M params at inference, 44× the student.
- **Branch C** (online CLIP second opinion): adds about 7 ms of latency on GPU and about 0.6 GB of RAM.
- **`altModels`** (brain-inspired, trained from scratch): best variant `model_b` at 54.4 %, against a 45.4 % plain-CNN baseline. The neuromodulator ladder did not improve on `model_b`. It is still far below MobileNetV3, so we did not switch.

## 2. Whisper-small Urdu fine-tune (`/transcribe`)

**Why:** the old ASR was `whisper-large-v3-turbo-urdu`, 3.2 GB on disk and about 4 GB of RAM in the server. It is the single biggest blocker to running offline on a PC or phone.

**Options we evaluated** (first 100 FLEURS ur_pk test clips, CPU fp32):

| Model | WER | CER | RTF (lower = faster) | Peak RAM |
|---|---|---|---|---|
| turbo Urdu (old default) | 25.5 % | 9.4 % | 1.25 | 5.1 GB |
| community `whisper-small-urdu` | 26.4 % | 10.1 % | 0.46 | 2.9 GB |
| `whisper-base-urdu-full` | 40.6 % | 15.8 % | 0.22 | 2.2 GB |
| **ours (whisper-small, FLEURS ×2 + Common Voice, 4,000 steps)** | **23.6 %** | **8.6 %** | **0.48** | **2.9 GB** |

On the full FLEURS test set (299 clips) ours scores 22.9 % WER and 8.2 % CER.

**Bug found and fixed:**
- Whisper's padding token is the same token as end-of-text.
- Masking labels "where token == pad" therefore also hid every end-of-text token, so the model never learned to stop.
- The first run repeated each sentence until the length limit and scored 95.7 % WER, even though the words themselves were right.
- The fix masks padding **by position**. We then checked that each label keeps exactly one end-of-text token.

**Real-speech check** (Sunday). FLEURS test is in-distribution for us, so we also tested on speech we hadn't trained on:

| Test set | Ours WER / CER | Turbo WER / CER |
|---|---|---|
| Common Voice dev, sentences unseen in training | 29.8 / 11.2 | 30.2 / 11.2 |
| 20 synthetic symptom sentences, clean audio | 24.2 / 9.3 | 28.7 / 9.5 |
| Same 20, phone-quality audio | 36.2 / 15.6 | 39.2 / 15.8 |

- **Verdict:** a tie on accuracy, at about a third of the compute and roughly half the RAM. The thesis argument is "same accuracy, much cheaper", not "better".
- **Known weak spot:** ours wrote خارش (itching) as خارج in 2 of 3 cases where the turbo was right.

**Alternatives dropped:**
- **Generic `whisper-medium`:** no Urdu fine-tune and almost no smaller than turbo. Downloaded by mistake and deleted.
- **`whisper-large-v3-urdu`:** about twice the size of turbo.
- **The CT2 int8 turbo:** not a browser or phone runtime.
- **Base:** about 40 % WER, too inaccurate.
- **Hugging Face hosting:** the team preferred GitHub, so the weights went in through Git LFS (about 1 GB, inside the free quota).
  - `server.py` falls back to the turbo if the weights are still an LFS pointer.
  - `/health` reports which model actually loaded.

## 3. Rare-class data and near-duplicate filtering

**Why:** Melasma (54 training images) and Seborrheic Dermatitis (110) were the weakest classes.

**Sources added** (`data/build_train_augmented.py` → `data/processed/train_augmented.csv`; val and test untouched):

| Class | Before | After | Sources |
|---|---|---|---|
| Melasma | 54 | 190 | MEMI-DS face crops (CC BY 4.0, cropped around the lesion masks; eye-censor bar and calibration card trimmed so they can't become a shortcut), DermNet |
| Seborrheic Dermatitis | 110 | 219 | DoctorSkinDisease, Fitzpatrick17k |
| Contact Dermatitis | 514 | 804 | DoctorSkinDisease, DermNet, F17k, SkinDiseaseBD |
| Vitiligo | 386 | 481 | DermNet, F17k, SkinDiseaseBD |
| Psoriasis | 1,631 | 1,833 | DermNet, F17k |

**Duplicate filter:**
- **Old filter:** a 64-bit dHash, which flagged unrelated smooth-skin photos as duplicates and threw real data away.
- **New filter:** CLIP ViT-B/32 embedding cosine similarity, with thresholds calibrated by inspecting pairs in each band.
  - Anything at ≥ 0.95 against val/test is dropped (strict, so test accuracy isn't inflated).
  - Against train, only near-exact copies (≥ 0.98) are dropped.
- **Why it mattered:** 845 of the first 1,953 candidates were copies of test images. Without the filter they would have leaked.

**Other source notes:**
- **SkinDiseaseBD:** its raw photos are unlabelled. Each was labelled by unanimous vote of its 5 most CLIP-similar labelled augmented copies, which kept 21 photos from Bangladeshi patients.
- **Fitzpatrick17k:** about 80 % of its images sit on DermaAmin, which no longer resolves (not in the Wayback Machine either). Only the Atlas Dermatologico images were fetchable.
- **SkinCAP and the official Fitzpatrick17k form:** declined, because they need personal access forms.
- **Skin-tone confound:** we deliberately did *not* bulk-add light-skin-only images to just the two rare classes. The model could learn "light skin → Melasma/Seb Derm".

**Result** (3 seeds each, same teacher):

| | Test acc | Top-3 | Macro-F1 | Seb Derm recall |
|---|---|---|---|---|
| Control (original data) | 74.57 ± 0.40 | 95.86 | 67.83 | 37.3 |
| + extra data | 74.49 ± 0.39 | 96.02 | 68.07 | 41.2 |

**Verdict:** no measurable gain. The Seb Derm change is about one image out of 34.

**Melasma check:**
- Recall was unchanged (15/17).
- *Every* false Melasma call, in both models, was a face photo. Every Melasma training image is a face, so "face means Melasma" was already learned before any new data.
- The MEMI studio-crop theory did not hold.

## 4. Input guards

**Problem:**
- The skin check is an HSV+YCrCb colour mask, so it measures skin-*coloured* pixels. A G-Wagon on sand passes it.
- Softmax confidence is not a safe out-of-distribution signal, because classifiers can be very confident on junk.

**Test set built:**
- **Negatives:** 172 real non-skin Unsplash photos (`inference/test_images/negative/real/`, credits in `SOURCES.txt`) plus 36 synthetic ones.
- **Positives:** 56 curated lesion photos plus the full test split.

**Sweep** (`inference/sweep_guards.py`): thresholds chosen on **val** lesions only, so test is not used for choosing.

| Setting | Synthetic negatives accepted | Real non-skin accepted | Curated lesions rejected | Test lesions rejected | Test acc of accepted |
|---|---|---|---|---|---|
| Old (skin ≥ 0.15) | 5/36 | 81/172 | 1/56 | 245/2438 | 75.88 |
| Skin ≥ 0.05 only | 5/36 | 97/172 | 1/56 | 171/2438 | 75.65 |
| **Shipped: skin ≥ 0.05 + energy ≥ 2.37** | **0/36** | **63/172** | **2/56** | **213/2438** | **76.04** |
| Skin ≥ 0.15 + energy ≥ 2.45 | 0/36 | 31/172 | 2/56 | 357/2438 | 76.45 |

- **Energy score:** `logsumexp(logits)` of the student. It costs nothing extra.
- **What it achieves:** fewer non-skin photos get a diagnosis *and* fewer real lesions are rejected.
- **Detectors that lost:** Mahalanobis distance and k-NN similarity on the student's features both did worse than energy.
- **Live check:** `eval_guards.py` against the running server matched the offline sweep (64/208 negatives accepted, 2/56 positives rejected).
- **Not solved:** about 37 % of real non-skin photos still get a diagnosis. Thresholds can't fix that. It needs a trained "not a lesion" class (or outlier exposure), or branch C's CLIP check when online.
- **Model-specific:** the 2.37 cutoff fits one model only. Re-run `sweep_guards.py` whenever the served model changes.
- **Re-tuned Monday for the shipped 320 student** (clean splits, same rule: keep 97.5 % of val lesions): energy ≥ **2.31**. Synthetic negatives accepted 0/36, real non-skin 56/172, curated lesions rejected 2/56, clean-test lesions rejected 216/2,337 (9.2 %), accuracy on the accepted ones 76.24 %.
- **Bug caught in the sweep script:** on Windows, DataLoader workers re-import the module, so a transform swapped in at runtime silently fell back to 224 px inside the workers (the 320 model scored 69 % instead of 74.7 %). The transform is now passed into the Dataset explicitly.
- **Test fix:** 4 GradCAM tests failed only when CUDA was visible. The tests built inputs on the CPU while the model sat on the GPU, and now move the input to `DEVICE`. The suite is 89/89 passing.

## 5. Teacher retraining

`notebooks/train_teacher.py` retrains the EfficientNet-B3 teacher with notebook 03's "Teacher Final" recipe, and `train_dualkd.py --teacher` distils from it.

- **Teacher:** retrained on the extra data, it scores 73.30 % test, up from 71.82 %, and early-stopped at epoch 17.
- **Students:** distilled from it, they score **73.08 ± 0.95** against control's 74.57 ± 0.40. A better teacher made a worse student.

## 6. Accuracy experiments (Sunday)

**Shared setup:**
- Same script (`notebooks/train_dualkd.py`), split-matched B3 teacher, 3 seeds per arm, original (leaky) splits.
- Seed-to-seed spread is about ±0.4 points.
- A same-seed rerun can differ by about 2 points from GPU nondeterminism, so single runs are not evidence.

| Arm | Test acc | Top-3 | Macro-F1 | Verdict |
|---|---|---|---|---|
| Control (224 px) | 74.57 ± 0.40 | 95.86 | 67.83 ± 1.03 | baseline |
| + extra rare-class data | 74.49 ± 0.39 | 96.02 | 68.07 ± 0.42 | no gain |
| + retrained B3 teacher | 73.08 ± 0.95 | 95.65 | 65.96 ± 1.11 | worse |
| **320 px input** | **74.99 ± 1.33** | **96.23** | **70.03 ± 1.51** | **kept**: +2.2 macro-F1 (Psoriasis recall +5, Contact +3, Seb Derm +3) |
| Mixup α = 0.4 | 71.57 ± 0.95 | 95.94 | 65.93 ± 0.55 | worse by 3 points |
| Teacher = mean of 6 trained students | 73.40 ± 0.21 | 95.46 | 65.69 ± 1.07 | worse |
| 80-epoch cap (new-teacher arm, 1 run) | 71.62 | 95.94 | 64.27 | inconclusive: early-stopped before 40, so the cap never bound |

**Inference-time only** (CPU, cached logits, `.bench/acc/step1_results.md`):

| | Test acc | Cost | Verdict |
|---|---|---|---|
| Flip TTA on the production model | 74.98 → 75.06 | 4× | not worth shipping |
| Ensemble of 9 students + flip TTA | 77.2–77.6 | 9×–36× | real gain (+3, CI clear of 0), but only fits the online path (branch C), not the phone |

**Why a better teacher gave a worse student, twice:**
- Both the stronger B3 and the 77 % student ensemble had fit the training set (the students are at about 95 % train accuracy).
- On training images their soft targets are therefore near one-hot and add nothing beyond the labels.
- A teacher would need to be evaluated on data it never trained on (k-fold teachers) to help.

## 7. Label audit and the train/test leak

**Method:**
- Every image (13,021) got a dHash, a pHash and a CLIP embedding. Duplicate tiers were checked visually on sample grids.
- A confident-learning pass used 5-fold, duplicate-grouped logistic regression on the CLIP embeddings.
- A test image counts as "likely mislabelled" only when that probe **and** all 3 control students, which never trained on test, agree the label is wrong.

**Findings:**
- **Leak:**
  - 332 / 2,438 test images (13.6 %) have a pixel-identical copy in train/val, and 405 (16.6 %) counting re-crops of the same lesion. Val has the same problem (224 / 277).
  - Students score 80–84 % on leaked test images and about 73 % on the rest.
  - The served model's honest accuracy on unseen images was 73.3–73.7 %, not 74.98 %.
- **Conflicting duplicates:** 99 groups (212 images) where the same photo carries two labels. They come mostly from SkinDiseaseImage and DermNet folders: Eczema/Psoriasis 60, Psoriasis/Seb Derm 24, Eczema/Tinea 13.
- **Likely mislabelled test images:** about 130 (5.3 %). They are concentrated in Psoriasis (9.2 %), Contact Derm (8.1 %) and Seb Derm (17.6 %, 6/34). This noise sits on the Psoriasis/Eczema boundary, which is also the model's biggest confusion.
- **Junk images:** 31 histology/biopsy images, including at least one microscope slide, are mixed into the image data.

**Clean splits** (`.bench/labels/*_clean.csv`, originals untouched):
- Conflicting groups dropped.
- Train copies of val/test images dropped.
- Within-split duplicates removed.
- 64 strong flags dropped from **train only**. Val/test are never pruned on a model's say-so, because that biases the score toward the model.
- **Sizes:** train 6,577 / 7,800, val 1,798 / 1,951, test 2,337 / 2,438.

## 8. Clean-split baseline: 224 vs 320 (Monday)

Retrained on the clean splits, 3 seeds each. These are **the only accuracy numbers to report from now on**.

| | Test acc | Top-3 | Macro-F1 | Per-seed acc |
|---|---|---|---|---|
| 224 px | 72.03 ± 1.21 | 95.89 | 67.99 ± 0.66 | 71.80, 73.34, 70.95 |
| **320 px** | **73.70 ± 0.81** | **96.59** | **70.44 ± 0.37** | 73.51, 73.00, 74.58 |

| Class (test n) | 224 recall / F1 | 320 recall / F1 |
|---|---|---|
| Vitiligo (121) | 87.6 / 84.6 | 90.1 / 87.2 |
| Melasma (17) | 86.3 / 66.0 | 86.3 / 69.8 |
| Psoriasis (477) | 69.3 / 65.8 | 69.7 / 67.9 |
| Eczema (860) | 71.7 / 74.0 | 75.0 / 75.8 |
| Tinea (674) | 75.7 / 75.8 | 75.5 / 76.9 |
| Contact Dermatitis (160) | 57.9 / 60.0 | 61.5 / 60.3 |
| Seborrheic Dermatitis (28) | 44.0 / 49.8 | 47.6 / 55.2 |

- **Why 320 survives:**
  - +1.7 accuracy and +2.5 macro-F1, both larger than the seed spread.
  - The gains are on the texture-heavy dermatitis classes, which fits the hypothesis that 224 px throws away scale and texture detail.
- **Cost:** about 2× the compute per image. It is still tens of milliseconds on a desktop CPU (29 ms vs 22 ms measured). The weights file is the same 14 MB.
- **Production model on the clean test:** it scores 75.74, but it was trained on the leaky train split, which still holds copies of clean-test images, so that number is inflated and must not be quoted.
- **Seed choice for shipping:** seed 2, picked by **validation** accuracy (72.47 % vs 71.69 / 70.86), not test. Its test accuracy is 74.58 %. The number to report is the 3-seed mean, 73.70 ± 0.81.

## 9. RAM benchmark (CPU, whole serving stack)

**What was measured:** each configuration in a fresh process, mirroring `inference/server.py`:
1. Load the student.
2. Run a Grad-CAM forward and backward pass.
3. Load Whisper.
4. Transcribe a 4.9 s Urdu clip.

| Configuration | RAM after load | Peak | Image inference | 4.9 s clip |
|---|---|---|---|---|
| 224 student + our whisper-small | 2.06 GB | 2.59 GB | 22 ms | 6.1 s |
| **320 student + our whisper-small (shipped)** | **2.33 GB** | **2.85 GB** | 29 ms | 6.0 s |
| 320 student + turbo Whisper | 4.45 GB | 4.71 GB | 29 ms | 10.0 s |
| 320 student only, no ASR | 1.33 GB | 1.33 GB | 29 ms | – |

- **Python baseline:** about 770 MB of every row is just Python + PyTorch + transformers being imported.
- **Teacher:** the EfficientNet-B3 teacher is training-only and costs nothing at serving time.
- **Earlier per-branch numbers** (Saturday, still with the turbo ASR): main/A 4.0 GB, C 4.65–4.73 GB (adds CLIP), B 7.8 GB, rising to 9.2 GB with Urdu/Roman-Urdu translation loaded. That ordering is why B and C stay connected-mode add-ons.
- **Student by itself:** 3.47M params, about 40 MB of incremental RAM, 14.5 ms per image on a desktop CPU at 224. Dynamic int8 quantization did nothing, because MobileNet is almost all convolutions and that mode only quantizes Linear layers.

---

## What we kept and why

| Decision | Alternatives considered | Deciding evidence |
|---|---|---|
| CLIP as a *separate* distillation teacher (dual-KD) | Blended target; CLIP at inference | Only variant above baseline, at zero runtime cost |
| Our whisper-small Urdu fine-tune | turbo, CT2 turbo, community small, base, generic medium/large | Ties the turbo on unseen speech at about ⅓ of the compute and about half the RAM; base is too inaccurate |
| Position-based label masking in Whisper training | Value-based (`== pad`) masking | Value masking hid end-of-text and gave 95.7 % WER |
| CLIP-embedding duplicate filter | 64-bit dHash | dHash discarded real, unrelated images |
| Energy OOD score + skin threshold 0.05 | Skin threshold alone; Mahalanobis; k-NN | Fewer false accepts *and* fewer rejected lesions |
| "Not a skin lesion" output fitted on the **frozen** student | Training the 8th class jointly; thresholds only | Same rejection quality, zero cost to disease accuracy (joint training lost 1.6 points) |
| 320 px input | 224 px | +1.7 accuracy and +2.5 macro-F1 on the clean split, beyond the seed spread |
| Clean splits for all reported numbers | Original splits | 13.6–16.6 % train→test leak |
| 3 seeds per arm, report mean ± sd | Single runs | ±0.4 seed spread; about 2 points from GPU nondeterminism alone |
| Shipped seed chosen on val | Best test seed | Choosing on test would bias the reported number |

## What we dropped and why

| Tried | Result | Why it was dropped |
|---|---|---|
| CLIP blend (flat / confidence-weighted) | 69.03 / 47.13 % vs 71.70 % | Averaging teachers destroys their disagreement signal |
| Brain-inspired `altModels` (9 variants) | Best 54.4 % | Far below MobileNetV3; neuromodulators added nothing |
| Extra rare-class web data | 74.49 ± 0.39 vs 74.57 ± 0.40 | No measurable gain; the data comes from the same noisy sources |
| Retrained (stronger) B3 teacher | 73.08 ± 0.95 | Stronger teacher, weaker student |
| Student ensemble as teacher | 73.40 ± 0.21 | Same effect: its targets are near one-hot on training images |
| Mixup | 71.57 ± 0.95 | 3 points worse; blending lesions destroys the texture cues |
| Flip TTA | +0.08 | Costs 4× the inference |
| 9-student ensemble on device | ≈77.5 % | 9–36× compute. Kept as an option for the online branch C only. |
| 8th class trained jointly with the diseases | 72.10 ± 1.62 % vs 73.70 ± 0.81 % disease accuracy; Psoriasis recall 69.7 → 62.8 | Failed the bar set before training (no accuracy loss beyond seed noise). Scaly and cracked textures in the negatives probably pulled psoriasis plaques toward "not a lesion" |
| Generic `whisper-medium`, `whisper-large-v3-urdu`, CT2 turbo | – | Too large, or no browser/phone runtime |
| SkinCAP / Fitzpatrick17k access forms | – | Team declined the paperwork |
| Pre-re-split teacher (`.bench/models_before_retrain/teacher_final.pth`) | 78.6 % on today's test | Saw test images; never use it |

## Open issues and next steps

1. **Hand-review labels.**
   - Start with the ~130 suspect test images (`.bench/labels/test_likely_mislabelled.csv`, grids in `flags_<class>.jpg`), then the strong train flags.
   - Remove the 31 histology images.
2. **Group-aware split.** Keep all near-duplicates of one lesion in the same split so the leak cannot come back, then retrain **once**. Stop tuning methods.
3. **Re-tune the guards** for any future served model (done for the 320 student: 2.31), and update every place that still quotes 74.98 %.
4. **Non-skin photos:** mostly solved (section 11). 10/172 real non-skin photos still get a diagnosis, down from 56. The misses are pale, furry or textured scenes (a white dog on a speckled counter). More such photos in the negative set, or branch C's CLIP gate when online, would close the gap.
5. **Real-voice ASR test.** Record the 12 lines in `data/raw/asr/user_recordings/refs.tsv` and score both models. Watch خارش → خارج.
6. **Benchmark table:** rows for branches B and C on the clean split are still missing.
7. **Report framing:**
   - Lead with the leak ("found and fixed; honest ≈ 73 %").
   - Report top-3 (≈ 96–97 %), per-class recall and the guard behaviour.
   - Present the negative results as findings.
   - Possibly also report a merged "dermatitis" group (Eczema / Contact / Seb Derm) if the supervisor agrees.

## 10. Production deployment (PC + mobile PWA)

**Goal (set Saturday):** the whole product must work on a PC *and* on a phone, including offline, without a separate native app. So the phone target is an **installable PWA** that runs both models on the device.

### What runs where

| | PC / server | Phone (PWA) |
|---|---|---|
| Image model | PyTorch MobileNetV3 (320 px), `inference/server.py` | Same weights as ONNX (13 MB) on ONNX Runtime Web (WebAssembly) |
| Grad-CAM | Backward hooks in PyTorch | Closed form inside the ONNX graph (see below), same heatmap |
| Guards | `quality.py` (skin, blur, confidence, entropy, energy) | Same guards ported to JS, same thresholds read from `meta.json` |
| Speech-to-text | whisper-small Urdu fine-tune, PyTorch | Same fine-tune, int8 ONNX (330 MB) via transformers.js in a Web Worker, WebGPU when available |
| Storage | PostgreSQL | IndexedDB outbox, uploaded to the account when online |

### PC: Docker Compose (`deploy/`)

- **Services:** Postgres 16 (migrations applied on first boot), Express API, FastAPI inference (CPU-only PyTorch, 1 worker, health check requires the model to be loaded), and Caddy serving the built PWA and reverse-proxying `/api` and `/heatmaps`.
- **HTTPS is required, not optional:** service workers and microphone access only work in a secure context on phones. Caddy gets a Let's Encrypt certificate for a real domain automatically; `deploy/README.md` also covers a tunnel (no domain needed) and LAN use.
- **Production hardening:**
  - the API refuses to start without a JWT secret of at least 32 characters;
  - CORS origins and `trust proxy` are configurable (rate limiting needs the real client IP behind Caddy);
  - the mock-prediction fallback is **off** in production (503 instead), so a dead inference service can never turn into a fake diagnosis.
- **Bug fixed on the way:** patient result pages built heatmap links from `INFERENCE_URL`, which in Docker is an internal hostname a browser cannot reach. Links now go through `PUBLIC_HEATMAP_BASE`, via one helper shared with the clinician pages.
- **Measured:** images are inference 5.3 GB, API 225 MB, web 94 MB. Under load the inference container used 1.2 GiB (peak 1.6 GiB) with CPU-only PyTorch, lower than the 2.85 GB measured natively on Windows with the CUDA build.

### Phone: model export and checks

| Check | Result |
|---|---|
| Skin model ONNX vs PyTorch, logits | max difference 4 × 10⁻⁶ |
| Grad-CAM in the ONNX graph vs `server.py`'s hook-based Grad-CAM | max difference 1.5 × 10⁻⁵ |
| ONNX skin model, clean test split | **74.71 %** (PyTorch: 74.71 %) |
| Whisper ONNX fp32, FLEURS-100 / CV-unseen WER | 23.6 / 29.8 (PyTorch: 23.6 / 29.8) |
| **Whisper ONNX int8 (shipped to the phone)** | **23.3 / 30.4 WER**, CER 8.6 / 11.7, at 330 MB instead of 2.7 GB fp32 |
| JS preprocessing vs Pillow / OpenCV / `quality.py` (unit tests) | resize and colour conversions **bit-exact**; blur score within 0.01 %; guard decisions identical |

- **Grad-CAM without a backward pass:** ONNX Runtime cannot run backprop. In this architecture (features → global average pool → Linear → Hardswish → Linear) the gradient of a class logit with respect to every position of the last feature map is the same vector, W1ᵀ(hardswish′(z₁) ⊙ W2[c]) / (H·W). So the exported graph computes the CAM in the forward pass (`inference/export_mobile.py`).
- **Preprocessing parity:** torchvision's `Resize` is Pillow's fixed-point bilinear filter. The phone uses a line-by-line port of it instead of the canvas resampler, so the model sees the same pixels on both paths. JPEG decode resolution does not matter (74.75 / 74.71 / 74.67 % at 600 px / 1024 px / full decode), so phones decode at most 2048 px.
- **Why int8 for Whisper but fp32 for the skin model:** int8 cut Whisper from 2.7 GB to 330 MB with no measurable WER change. The skin model is only 13 MB, and MobileNet is almost all convolutions, which dynamic int8 does not touch (measured Saturday), so it stays fp32 and exact.
- **Whisper export steps** (reproducible, run in a separate venv with `optimum-onnx`, `onnxruntime`):
  1. `optimum-cli export onnx --model inference/models/asr/whisper-small-urdu-ours --task automatic-speech-recognition-with-past <out>`
  2. `onnxruntime.quantization.quantize_dynamic` on `encoder_model.onnx` and `decoder_model_merged.onnx` (weights `QUInt8`, `EnableSubgraph`), saved as `*_quantized.onnx`
  3. copy the configs, `tokenizer.json` and the two quantized files into `client/public/models/whisper-small-ur-v1/` (new folder name for every new model).
- **Export tooling snags (patched in the throwaway export venv, not in the repo):**
  - optimum's exporter breaks on Python 3.14, where `functools.partial` binds like a method when stored on a class;
  - transformers 5 saves `extra_special_tokens` in `tokenizer_config.json` as a list, where transformers 4 and transformers.js expect `additional_special_tokens`.
- **Bug caught:** the first guard sweep for the 320 model scored 69 % because Windows DataLoader workers re-import the module and silently fell back to 224 px. See section 4.

### Phone: app behaviour

- **Where a screening runs:** a toggle on the screening page (*This phone* / *Server*). The default is the phone on phones and installed PWAs, and the server on desktop browsers. If the server path fails because inference is down or the device is offline, the app falls back to the on-device model instead of showing an error.
- **Flow on the device:**
  1. The photo is checked and classified right after it is chosen, so bad photos are rejected before the voice step.
  2. Whisper warms up while the user records, and the voice note is transcribed on the phone.
  3. The screening is stored in IndexedDB and uploaded immediately when online: case, image, audio plus device transcript, prediction plus heatmap.
  4. Offline, the result page is shown from the device with a "saved on this phone" notice. The outbox uploads automatically when the connection returns, and a banner shows how many are waiting.
- **Server side of on-device results:**
  - `POST /api/screening/:id/device-result` stores the prediction exactly like a server one, so history, clinician review and the monitoring dashboard need no special cases. It validates strictly: shape, score ranges, `-onnx` model version, PNG-only heatmap of at most 2 MB.
  - `/voice` accepts a `deviceTranscript`, so the server does not transcribe the audio again.
  - On-device heatmaps are served from `/api/device-heatmaps/<uuid>.png`.
- **Caching:** the service worker precaches only the app shell (1.3 MB). The models are cached by the app on first use. The service worker deliberately does not cache `/models/` as well, which would have stored Whisper twice on the phone. Model folders are versioned (`skin-v2`, `whisper-small-ur-v1`) because the server marks them immutable.
- **Speed:** Caddy sends cross-origin isolation headers so ONNX Runtime can use several WebAssembly threads. Safari falls back to one thread.
- **Not changed:** the login session stays in `sessionStorage` (the project's security rule). A user who loses the connection mid-session keeps working on the device, but opening the installed app with no connection and no session still needs a login first.

### Verification (Monday evening)

All on this machine against the real Docker stack, with a headless Edge browser driven by Playwright in a phone-sized mobile context:

| Check | Result |
|---|---|
| Server tests (Jest) | 120 / 120, including 9 new ones (device results, device transcript, device heatmaps, production 503) |
| Client tests (Vitest) | 85 / 85, including 16 new preprocessing-parity tests |
| Inference tests (pytest) | 89 / 89 with the 320 model and the new threshold |
| API through Caddy | device result stored and its heatmap served (200 image/png); non-ONNX or out-of-range predictions rejected (400); missing heatmap 404; path traversal lands on the app shell; Urdu device transcript round-trips intact |
| Headers | COOP/COEP set (page is cross-origin isolated), `.wasm` as `application/wasm`, models `immutable`, `sw.js` `no-cache`, HSTS |
| Online screening on the "phone" | Vitiligo 83 % (the server gives 0.8276 on the same photo), heatmap rendered, saved as a normal server case; analysis about 1 s including the model load |
| Whisper in the browser (WASM, 4 threads, desktop CPU) | 12.2 s Urdu clip transcribed correctly in 6.8 s; first load of the 330 MB model 12 s from the local server |
| Offline screening | completes on the device in 0.6 s; result page with the heatmap shown from IndexedDB with the "saved on this phone" notice |
| Back online | the outbox uploads on its own; the local result link redirects to the new server case; server history shows both screenings |

**Bugs found by these tests and fixed before shipping:**
- **WebGPU and int8 Whisper:** they do not mix. The tab hung and crashed after 15 minutes even on the desktop RTX GPU, so Whisper now always runs on WebAssembly.
- **Double caching of Whisper:** the browser's HTTP cache refused the 237 MB decoder (`ERR_CACHE_WRITE_FAILURE`). Model downloads now skip the HTTP cache, since transformers.js already keeps the files in Cache Storage.
- **ONNX Runtime missing offline:** its loader was not cached until first use, so the first offline screening failed. Its two runtime files (~14 MB) are now precached when the app installs.
- **Duplicate uploads:** a background sync could have uploaded a screening the page was already uploading. Uploads are now guarded per record.
- **Broken logo in production builds:** the header, login and register pages loaded it from `/src/assets/...`, which exists only on the dev server.

**Not tested on physical phones yet.** Speed on a real mid-range Android phone (especially Whisper) is the first thing to measure after deploying.

### Deployment decisions

| Decision | Alternatives considered | Why |
|---|---|---|
| PWA with on-device models | Native Android/iOS app; phone browser calling the server | One codebase for PC and phone; works offline; no app-store step. The browser runtimes run our exact models |
| int8 Whisper on the phone | fp32 (2.7 GB); whisper-base | int8 kept WER within noise at 330 MB; base was about 15 WER points worse (Saturday) |
| Grad-CAM folded into the ONNX graph | No heatmap on the phone; server-only heatmaps | Same explanation offline, matching the server |
| Pillow/OpenCV preprocessing ported to JS | Canvas resize | Guarantees the phone sees the same pixels as the evaluation; pinned by tests |
| Docker Compose + Caddy | Native start scripts | One command on any PC/VPS; automatic HTTPS, which the PWA requires |
| No mock fallback in production | Keep the demo fallback | A fake prediction must never reach a patient |


## 11. "Not a skin lesion" output (Monday night)

**Problem:** with thresholds alone, 56 of 172 real non-skin photos (dogs, food, rooms, objects) still got a diagnosis. Thresholds on a 7-class model can only say "unsure", never "this is not skin at all".

**Data:** `notebooks/build_negatives.py` builds a non-lesion set from two public datasets:
- **DTD** (5,640 texture photos): scaly, cracked, blotchy, stained surfaces. These are the hard negatives because they look like lesions.
- **COCO val2017** (5,000 everyday photos): scenes, objects, animals, food. 115 photos that CLIP saw mainly as a face or close-up skin were dropped, since Melasma training images are face photos and lesion photos are skin close-ups.
- **Splits:** 80/10/10, giving 8,420 / 1,052 / 1,053. The external test negatives (172 real Unsplash photos, 36 synthetic images) were **never used for training or for picking thresholds**.

**The bar was set before training:** ship only if disease accuracy stays within seed noise (3-seed mean ≥ ~72.9 %) *and* clearly fewer non-skin photos get a diagnosis.

**Attempt 1: train an 8th class jointly** (`train_dualkd.py --neg-train-csv`; teacher and CLIP distillation on lesion images only). 3 seeds, about 1.6 h GPU:

| 3 seeds, clean split | Disease accuracy | Macro-F1 | Lesions rejected | Held-out non-lesions rejected |
|---|---|---|---|---|
| 7-class model (shipped) | 73.70 ± 0.81 | 70.44 ± 0.37 | – | – |
| Jointly trained 8-class | 72.10 ± 1.62 | 68.92 ± 2.87 | 0.3–0.4 % | 98.4–99.2 % |

Excellent rejection, but it **failed the accuracy bar**: −1.6 points, with Psoriasis recall dropping 69.7 → 62.8. Not shipped.

**Attempt 2 (shipped): fit the extra output on the frozen model** (`notebooks/fit_not_lesion_head.py`).
- **How:** the student's last layer maps a 512-d vector h to the 7 disease logits. One more row, z₈ = w·h + c, is fitted by logistic regression so that softmax over the 8 outputs gives P(not a lesion) = σ(z₈ − logsumexp(disease logits)).
- **Why it costs nothing:** the 7 disease rows are copied unchanged, so disease predictions and accuracy are *identical* to the shipped model (74.71 % on the clean test for both PyTorch and ONNX). Fitting takes about 2 minutes.
- **Thresholds:** both picked on validation lesions only (keep 99 % each): not-lesion probability < **0.866** and energy ≥ **2.25**.

| Guards, same images | Real non-skin accepted | Synthetic accepted | Held-out DTD/COCO accepted | Curated lesions rejected | Test lesions rejected | Test acc of accepted |
|---|---|---|---|---|---|---|
| Before (energy ≥ 2.31) | 56/172 | 0/36 | 410/1053 | 2/56 | 216/2337 (9.2 %) | 76.24 |
| **Now (not-lesion < 0.866 + energy ≥ 2.25)** | **10/172** | **0/36** | **53/1053** | **0/56** | **189/2337 (8.1 %)** | 75.74 |

- **Strictly better on every safety number:** far fewer junk photos get a diagnosis, and fewer real lesions are turned away. The small drop in "accuracy of accepted" is because hard lesions that used to be thrown away are now kept.
- **Animals** (held-out COCO photos, picked out with CLIP): dogs 17/18 rejected, cats 12/15, other animals 85/87. The misses are pale or furry animals on speckled surfaces. One white dog gets "Tinea, 48 %", which the app shows as a low-confidence result.
- **Behaviour:** when the not-lesion probability passes the threshold, the server returns 400 `NOT_A_LESION` and the app asks for a retake (English and Urdu), exactly like the no-skin check. The phone does the same on the device: the exported `skin-v3` model has 8 outputs and `meta.json` carries both thresholds. A browser check gave identical results to the server.
- **Compatibility:** server, export and app read the number of outputs from the model, so 7-output models still work unchanged.

| Decision | Alternatives | Why |
|---|---|---|
| Fit the not-lesion output on the frozen student | Joint 8-class training; thresholds only | Same rejection, no disease-accuracy cost, minutes instead of hours |
| Reject (retake) instead of showing "No disease" | Show an inconclusive result | A dog photo is not a screening; asking for a retake is clearer and matches the existing skin and blur checks |
| Thresholds keep 99 % of val lesions | Stricter thresholds (e.g. keep 97.5 %) | Stricter ones rejected curated lesions for little extra gain |


### 11b. Follow-up (8 Oct): close-up pets were getting through

**Report from testing the live app:** "most default to eczema when they're dogs". A close-up golden retriever puppy came back as **Eczema, 70 %**.

**Diagnosis**, by reproducing that exact photo through every check:
- The skin-colour filter passed it: cream fur makes 77 % of the pixels "skin-coloured".
- The not-lesion output gave only **0.43**; it rejects at 0.866.
- Energy and confidence both passed.

The not-lesion training data (DTD textures, COCO wide scenes) had almost no **close-up pet portraits**. The earlier "17/18 dogs rejected" check used COCO, which is mostly wide shots, so it missed this case. With nothing better to go on, the disease part fell back to its most common class, Eczema.

Also measured: a phone photo stored sideways costs about 7 points (73.8 % upright → 67.2 % / 65.7 % at 90° / 270°). The server does not yet apply the photo's EXIF orientation. Fixing that is still open.

**Fix:** added the **Oxford-IIIT Pet** dataset (7,390 cat and dog photos; 40 face/skin-like ones dropped by the same CLIP filter) to the non-lesion set, then refit only the not-lesion output on the frozen student (`fit_not_lesion_head.py`). The 7 disease outputs are unchanged, so accuracy stays at 74.71 % for the shipped seed. Threshold, chosen on validation lesions only (keep 99 %): **0.842**. Model file: `student_clean_res320_s2_notlesion_v2.pth`; phone model `skin-v4`.

| Full guards, same images | Synthetic accepted | Real non-skin accepted | Held-out DTD/COCO/**pets** accepted | Curated lesions rejected | Test lesions rejected |
|---|---|---|---|---|---|
| v1 (DTD + COCO) | 0/36 | 10/172 | 229/1788 | 0/56 | 189/2337 |
| **v2 (+ pets)** | 0/36 | 13/172 | **77/1788** | 0/56 | 188/2337 |

- **Non-lesion photos given a diagnosis:** 12.0 % → **4.5 %** across all 1,996 test negatives.
- **Held-out pet photos rejected:** 72.5 % → **96.1 %**.
- **The puppy:** not-lesion 0.43 → 0.91, now **rejected** ("please retake"), confirmed through the live app.
- **Real lesions:** curated still 41/56 correct with none rejected; live and offline answers identical.
- **Cost:** 3 more of the 172 Unsplash photos slip through (10 → 13). One linear output on frozen features is near its limit; the next step up would be a small dedicated head or, when online, branch C's CLIP gate.

### 11c. Follow-up (8 Oct): a general-image gate and a skin-colour bug

**What happened in testing:**
- A **baby on an armchair** was still read as Eczema, even after the pet fix. The skin model sees everything as skin texture, so its own not-lesion output cannot separate such photos (0.43 on the baby).
- A real **infant facial-eczema** photo was turned away as "no skin detected".

**Fix 1: lesion gate** (`notebooks/fit_lesion_gate.py`, `inference/models/lesion_gate.pth`, 17 MB):
- What it is: a logistic head on the **general ImageNet** features of a MobileNetV3-Large, which still knows dogs, babies and furniture. It runs before the skin model.
- Negatives added for it: people (3,000 LFW faces, plus the COCO and pet photos of people).
- Threshold: keeps 99 % of validation lesions.

| Rejected as not a lesion | Skin-model features | **Gate** |
|---|---|---|
| Held-out textures / scenes / pets / people | 94.2 % | **99.0 %** |
| Real Unsplash non-skin photos | 84.3 % | **100 %** |
| Synthetic negatives | 75.0 % | **100 %** |
| Test lesions wrongly rejected | 0.86 % | **0.4 %** (0 Melasma, 0/56 curated) |

The baby and the puppy are now both rejected in the live app.

**Fix 2: skin-colour pre-filter.** It only accepted hues 0–25, but red wraps around OpenCV's 0–180 hue circle, and pink or inflamed skin sits at 160–180 (91 % of that infant's cheek). With both ranges accepted:
- Real test lesions wrongly turned away: **4.3 % → 2.1 %**.
- The infant photo is now **Eczema 85 %** (correct).
- The phone's copy of the filter (`preprocess.js`) got the same fix, and its fixtures were regenerated.

**Costs:**
- About **+52 MiB** RAM in the inference container (605 → 657 MiB), and one extra small CNN pass per photo.
- **Not yet on the phone:** the on-device path still relies on the skin model's own not-lesion output.

**Next (not started):** a PyTorch-free server. PyTorch alone is 302 MB on import, against 53 MB for ONNX Runtime; the plan is saved in the project notes.
