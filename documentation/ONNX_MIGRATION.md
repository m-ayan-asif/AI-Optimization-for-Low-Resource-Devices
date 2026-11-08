# Moving the inference server from PyTorch to ONNX Runtime

**Date:** 7 November 2026 | **Pull request:** [#6](https://github.com/m-ayan-asif/AI-Optimization-for-Low-Resource-Devices/pull/6) | **Merge commit:** `9aaa3c8`

This records why the inference server moved to ONNX Runtime, what changed, what it achieved, and how each result was measured.

## Summary

The server now runs the same models without PyTorch. It uses far less memory and is faster, and it gives the same image results as before.

| Measure | PyTorch | ONNX Runtime | Change |
|---|---|---|---|
| Peak RAM, up to 6 requests at once | 5,222 MiB | **869 MiB** | 6× less |
| RAM after startup | 1,534 MiB | **507 MiB** | 3× less |
| Voice note, median | 5.2 s | **1.3 s** | 4× faster |
| Image request, median | 195 ms | **124 ms** | 1.6× faster |
| Image results that changed, out of 3,936 | – | **0** | Same status, error code and diagnosis |

**Limits of these results:**
- They were measured on one Windows machine, not in Docker.
- The Docker image has not been built with these changes.
- Whisper changed from fp32 to int8, so individual transcripts can differ slightly (section 5.3).

## 1. Why we made the change

The project's aim is screening on low-resource devices. Before this change:

- **The server was heavy.** It needed about 1.5 GB of RAM just to start. The Docker image was 5.3 GB, according to the [weekend report](WEEKEND_REPORT.md#10-production-deployment-pc--mobile-pwa).
- **PyTorch wasn't needed to serve.** It is built for training as well as running models. Importing it and `transformers` used 349 MiB before any model loaded.
- **The ONNX work already existed.** The PWA already ran the skin model and Whisper on ONNX, so the server and the phone were running two separate implementations of the same models.
- **It was already planned.** The weekend report listed a PyTorch-free server as the next step.

### Options considered

| Option | Decision | Reason |
|---|---|---|
| Keep PyTorch | Rejected | Highest RAM and largest install, with no benefit at serving time on a CPU |
| ONNX Runtime with the PWA's files | **Chosen** | Server and phone run identical student and Whisper files, already validated in the weekend report |
| ONNX Whisper at fp32 (2.7 GB) | Rejected | The weekend report measured about the same WER for int8, at 330 MB |
| A separate speech runtime such as faster-whisper | Not tested | It would keep two different Whisper builds, one for the server and one for the phone |

Training still needs PyTorch and was not changed. ONNX only replaces it for serving.

## 2. What changed

### Code

| File | Change |
|---|---|
| `inference/server.py` | Runs the models on ONNX Runtime. Guards and API response fields are unchanged |
| `inference/whisper_onnx.py` (new) | NumPy log-mel features and a greedy Whisper decoder, with no PyTorch or `transformers` |
| `inference/export_server.py` (new) | Exports the lesion gate with its threshold stored inside the file, and copies the student and Whisper files from the PWA folder |
| `inference/requirements.txt` | Serving packages only |
| `inference/requirements-dev.txt` (new) | Adds PyTorch and the tools for training, exporting and testing |
| `inference/tests/` | Tests build a tiny real ONNX model, so CI needs neither PyTorch nor Git LFS. New tests cover the decoder, audio formats, the voice queue and the memory settings |
| `inference/Dockerfile`, `.dockerignore`, `deploy/`, CI | No PyTorch or FFmpeg in the image; only ONNX models are copied in |

### Models

| Model | Before | After |
|---|---|---|
| Skin student | `.pth`, 14 MB, fp32 | `.onnx`, 14 MB, fp32, byte-identical to the phone's file |
| Lesion gate | `.pth`, 17 MB | `.onnx`, 16 MB, with the threshold stored as metadata |
| Whisper | `model.safetensors`, 967 MB, fp32 | `int8 .onnx`, 330 MB, byte-identical to the phone's files |

### Behaviour

- **Whisper is now int8** instead of fp32 on the server.
- **Voice notes are transcribed one at a time.** Simultaneous requests wait in a queue.
- **A missing model returns 503 `MODEL_NOT_LOADED`.** It used to return predictions from random weights tagged `-UNTRAINED`.
- **Grad-CAM comes from one forward pass.** The formula is built into the ONNX graph (`export_mobile.py`), replacing a second forward pass and a backward pass.
- **`model_version` on the server does not contain "onnx".** `ResultsPage.jsx` reads that word as "this ran on the phone".
- **Removed:** GPU serving and the turbo Whisper fallback.

## 3. How it was measured

**Machine:** Windows 11, 16 logical processors, 15.3 GB RAM.

**Software:** Python 3.14.3, ONNX Runtime 1.31.1, PyTorch 2.15.0 (CPU build).

**Settings:** 4 threads for each server. All PyTorch comparison figures are on the CPU, which is what production uses.

**Baseline:** the actual `server.py` from the commit before this change (`553a5ee`), not a reimplementation.

**Memory figures:** taken from the running server process, as resident memory and peak working set.

**The new server's environment:** installed from `requirements.txt` alone. PyTorch and `transformers` were not present, so any hidden dependency would have crashed it.

## 4. Results: speed and memory

### 4.1 Running service over real HTTP

Both servers received the same load.

| Measure | PyTorch | ONNX Runtime |
|---|---|---|
| RAM after startup | 1,534 MiB | 507 MiB |
| Peak RAM, one request at a time | 2,230 MiB | 705 MiB |
| Peak RAM, up to 6 requests at once | 5,222 MiB | 869 MiB |
| RAM settled after the load | 1,836 MiB | 595 MiB |
| Image request, median | 195 ms | 124 ms |
| Image request, p95 | 329 ms | 250 ms |

The load was 100 images one at a time, 6 voice notes one at a time, then 12 voice notes and 120 images with 6 running at once, then 400 more images.

The PyTorch peak may be understated. This machine has no FFmpeg, so its WebM voice notes failed instead of being decoded.

### 4.2 Voice notes

These are the same 9 WAV recordings, 2.2–8.3 s long, sent one at a time to each server.

| Measure | PyTorch (fp32) | ONNX Runtime (int8) |
|---|---|---|
| Median time | 5.19 s | 1.28 s |
| Time ÷ audio length, median | 1.56 | 0.45 |

A ratio below 1 means faster than real time. Part of this gain comes from int8 rather than from ONNX Runtime itself.

### 4.3 Model time alone

This covers the gate, the skin model and Grad-CAM, without the guards or heatmap saving, averaged over 3,536 images.

| PyTorch | ONNX Runtime |
|---|---|
| 117.9 ms | 23.0 ms |

### 4.4 Startup and install size

| Measure | PyTorch | ONNX Runtime |
|---|---|---|
| Import time | 4.0 s | 0.2 s |
| RAM after imports | 349 MiB | 56 MiB |
| Main packages on disk | 694 MB (`torch`, `torchvision`, `transformers`) | 56 MB (`onnxruntime`, `tokenizers`) |

These are Windows package sizes. The Docker image size has not been re-measured.

## 5. Results: quality

### 5.1 Image results

The old and new `server.py` both ran on the CPU over the same 3,936 images:

| Source | Images |
|---|---|
| Validation and test splits of a new leak-free split (section 7) | 3,536 |
| Skin images outside the 7 classes (melanoma, nevi) | 300 |
| Local test uploads | 99 |
| Non-lesion photo (the e2e fixture) | 1 |

| Check | Result |
|---|---|
| Same HTTP status | 3,936 / 3,936 |
| Same error code | 3,936 / 3,936 |
| Same status | 3,936 / 3,936 |
| Same top condition | 3,936 / 3,936 |
| Largest difference in any class score | 0.0001 (rounding in the stored values) |
| Heatmaps compared | 3,612 |
| Largest heatmap pixel difference | 3 / 255 |

Every outcome was exercised, and the counts were identical on both servers:

| Outcome | Images |
|---|---|
| Classified | 3,569 |
| Not a lesion | 147 |
| No skin detected | 124 |
| Too blurry | 53 |
| Inconclusive (out of scope) | 43 |

**This shows the two servers give the same answers. It is not a new accuracy measurement,** and the reported accuracy is unchanged. The weekend report measured the ONNX student at 74.71% on the clean test split, the same as PyTorch for that model. The number to report remains the 3-seed mean, 73.70 ± 0.81%.

### 5.2 Why the image results did not change

The ONNX student holds the same weights at the same fp32 precision, so it performs the same calculation. The gains come from removing work around that calculation: PyTorch's training machinery and the extra Grad-CAM passes.

### 5.3 Speech

Whisper did change, because int8 rounds the weights.

| Check | Result |
|---|---|
| WER, FLEURS-100 / unseen Common Voice, int8 | 23.3% / 30.4% (weekend report) |
| WER, same sets, fp32 | 23.6% / 29.8% (weekend report) |
| New decoder vs `transformers.js` on the same int8 files | 12 / 12 recordings identical |
| Log-mel features vs `transformers` | Largest difference 2 × 10⁻⁵; filter bank identical |
| Transcripts: old fp32 vs new int8 | 5 / 9 identical; lowest similarity 0.89 |

WER is about the same: slightly better on one set and slightly worse on the other. The accurate claim is **no measurable change in WER**, not "no change". The new decoder gives the same text as the code already running on phones.

WER was not re-measured for this change, because the Urdu test sets were not available locally. The recordings used here are short local test clips with no reference transcripts, so they can show whether two outputs match but not which is more correct.

### 5.4 End to end and test suites

The real Express API and Postgres ran against the new service, using a throwaway database, and passed 15 of 15 checks: login, case creation, image upload, WAV and WebM voice notes, inference, results, heatmap, history and not-a-lesion rejection.

| Suite | Result |
|---|---|
| Inference, with PyTorch and `transformers` | 139 passed |
| Inference, without them (as in CI) | 137 passed, 2 skipped |
| Server (Jest) | 121 passed |
| Client (Vitest) | 88 passed |
| Dashboard | 25 passed |
| GitHub Actions on `main` (`9aaa3c8`) | Passed |

## 6. The memory settings

Switching to ONNX Runtime was not enough by itself. With its default settings, 6 requests at once used 2.3 GB, and the memory stayed in use afterwards.

| Setting | Peak with 6 at once | Settled after load |
|---|---|---|
| ONNX Runtime defaults | 2,314 MiB | 2,108 MiB, later 1,151 MiB |
| Voice queue + memory arena off | **869 MiB** | **595 MiB** |

- **Voice queue:** parallel decodes share the same CPU threads, so they gain little and multiply the RAM.
- **Memory arena off:** ONNX Runtime's arena keeps memory after a busy moment instead of releasing it.

Voice notes did not get slower: the median was 1.4 s with these settings on an idle machine.

## 7. What was learned during testing

These matter if anyone repeats the measurements.

- **`CUDA_VISIBLE_DEVICES=` (empty) does not hide the GPU here.** The first baseline ran on the GPU without warning and scored up to 0.0014 differently. Setting it to `-1` fixed this, and `device_type` in the telemetry shows which device ran.
- **`TestClient` makes PyTorch look like it leaks.** Under FastAPI's `TestClient`, PyTorch grew by about 4.3 MB per image on the CPU and repeatedly hit a 3 GB safety stop, and the earlier GPU run reached about 7 GB. Over real HTTP it stayed flat (2,027 to 2,021 MiB across 400 images), so this is not a production leak. The cause was not confirmed; a new thread per request is the likely reason. Measure memory against a running service.
- **Bare-model numbers are too low.** An early benchmark of the models alone suggested about 0.8 GB. The real service was higher before the memory settings in section 6, because the web framework, OpenCV and PyAV also use memory.
- **The test images are not the team's original split.** The clean-split lists were not available locally, so a new split was built from the raw datasets, keeping patients and near-duplicates together. That doesn't affect an old-vs-new comparison, but its figures can't be compared with 73.70%.

## 8. Trade-offs and what remains

### Trade-offs accepted

- Individual transcripts can differ from fp32, with about the same WER.
- No GPU serving. Production runs on the CPU, but a machine with a GPU no longer benefits from it.
- No turbo Whisper fallback.
- Voice notes queue, so a burst of them waits longer, though each one is faster.
- The server's Whisper decoder is now our own code rather than a library's. Tests pin it against `transformers` and it was checked against `transformers.js`.

### Not done yet

| Item | Why it matters |
|---|---|
| **Build and run the Docker image** | It has not been built since these changes, and this is how the project deploys. PyTorch, FFmpeg and `libsndfile` were removed, so a Linux-only failure is possible |
| Measure RAM inside Docker | Every figure here is from Windows. `INFERENCE_MEM_LIMIT` stays at 4 GB until this is done |
| Run the Playwright suite against the new server | It does not run in CI |
| Check Usman's testing branch | `feature/testing-robustness-and-benchmarking` changes `ci.yml` and adds `test_model_regression.py`, which may expect PyTorch |
| Measure WER on real Urdu speech | The accuracy figures come from existing test sets, not from patients |
| Test on a physical phone | Still open from the weekend report. This change did not touch the phone code |

### Possible next step

The lesion gate is now an ONNX file, so it could also ship to the phone, which currently has no gate. This would add about 16 MB and has not been tested in a browser.

## 9. Repeating the comparison

The comparison scripts were one-off tools and are not in the repo, and neither are the raw results. To repeat it:

1. Get the old server with `git show 553a5ee:inference/server.py`, and run it with `requirements-dev.txt`.
2. Run the new server from a clean environment using only `requirements.txt`.
3. Set `CUDA_VISIBLE_DEVICES=-1`, and use the same thread count for both.
4. Send the same images to each `/predict` and compare status, `code`, `top_condition`, `all_scores` and the heatmap pixels.
5. Measure memory on a running server over real HTTP, not through `TestClient`.

Rebuild the served models with `python inference/export_server.py`.

## Related documents

- [Weekend report](WEEKEND_REPORT.md): how the models were chosen, and the int8 and Grad-CAM work (section 10)
- [Deployment guide](../deploy/README.md)
- [Testing guide](TESTING.md)
