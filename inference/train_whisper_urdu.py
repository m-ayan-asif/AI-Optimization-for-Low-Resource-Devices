"""
Fine-tune openai/whisper-small for Urdu ASR (single 8 GB GPU, Windows-safe: no DataLoader workers).

Training data : FLEURS ur_pk train (x FLEURS_UPSAMPLE) + Common Voice Urdu "processed-expanded" train.
Held out      : FLEURS ur_pk TEST is never trained on (also used to drop any leaking train sentence).
Monitoring    : a fixed 400-clip slice of the Common Voice validation split (loss only).
Final eval    : WER/CER on the full FLEURS ur_pk test split.

Usage (from repo root):
    python inference/train_whisper_urdu.py --data-dir <dir with fleurs parquet + cv/> --smoke
    python inference/train_whisper_urdu.py --data-dir <dir> --max-steps 5000
"""
import argparse
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import io
import os
import queue
import random
import re
import threading
import time
import unicodedata

import jiwer
import librosa
import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
import torch
import torch.nn.functional as F
from transformers import WhisperForConditionalGeneration, WhisperProcessor

p = argparse.ArgumentParser()
p.add_argument("--data-dir", required=True)
p.add_argument("--base", default="openai/whisper-small")
p.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "asr", "whisper-small-urdu-ours"))
p.add_argument("--max-steps", type=int, default=5000, help="optimizer steps")
p.add_argument("--batch", type=int, default=8)
p.add_argument("--accum", type=int, default=2)
p.add_argument("--lr", type=float, default=1e-5)
p.add_argument("--warmup", type=int, default=200)
p.add_argument("--fleurs-upsample", type=int, default=2)
p.add_argument("--save-every", type=int, default=1000)
p.add_argument("--eval-batch", type=int, default=16)
p.add_argument("--smoke", action="store_true", help="tiny run: 6 optimizer steps, 48 eval clips, saves to <out>-smoke")
p.add_argument("--seed", type=int, default=0)
args = p.parse_args()

random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
DEV = "cuda"
if args.smoke:
    args.max_steps, args.save_every, args.out = 6, 10**9, args.out + "-smoke"

# ── text normalisation (same on train targets, eval refs and eval hyps) ────
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_DIAC = re.compile(r"[ً-ٰٟۖ-ۭـ]")  # harakat, tatweel, quranic marks


def norm(t):
    t = unicodedata.normalize("NFKC", t).lower()
    t = _DIAC.sub("", t)
    t = _PUNCT.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


# ── data: keep compressed audio bytes in RAM, decode per batch ─────────────
def load_parquet(path, text_cols, limit=None):
    pf = pq.ParquetFile(path)
    rows = []
    for rg in range(pf.num_row_groups):
        t = pf.read_row_group(rg, columns=["audio"] + text_cols).to_pylist()
        for r in t:
            text = next((r[c] for c in text_cols if r.get(c)), None)
            if text and r["audio"] and r["audio"].get("bytes"):
                rows.append((r["audio"]["bytes"], norm(text)))
        if limit and len(rows) >= limit:
            break
    return rows[:limit] if limit else rows


D = args.data_dir
lim = 200 if args.smoke else None
fl_test = load_parquet(os.path.join(D, "parquet-data/ur_pk/test-00000-of-00001.parquet"), ["transcription", "raw_transcription"], 48 if args.smoke else None)
test_texts = {t for _, t in load_parquet(os.path.join(D, "parquet-data/ur_pk/test-00000-of-00001.parquet"), ["transcription", "raw_transcription"])}
fl_train = load_parquet(os.path.join(D, "parquet-data/ur_pk/train-00000-of-00001.parquet"), ["transcription", "raw_transcription"], lim)
cv_train = []
for f in sorted(os.listdir(os.path.join(D, "cv/data"))):
    if f.startswith("train-"):
        cv_train += load_parquet(os.path.join(D, "cv/data", f), ["sentence"], lim)
        if lim: break
cv_val = []
for f in sorted(os.listdir(os.path.join(D, "cv/data"))):
    if f.startswith("validation-"):
        cv_val = load_parquet(os.path.join(D, "cv/data", f), ["sentence"], 400)

leak = sum(1 for _, t in cv_train + fl_train if t in test_texts)
train = [x for x in cv_train + fl_train * args.fleurs_upsample if x[1] not in test_texts]
print(f"FLEURS train {len(fl_train)} (x{args.fleurs_upsample}), CV train {len(cv_train)}, CV val {len(cv_val)}, "
      f"FLEURS test {len(fl_test)}; dropped {leak} train clips whose text appears in FLEURS test; total train {len(train)}", flush=True)


def decode(b):
    a, sr = sf.read(io.BytesIO(b), dtype="float32", always_2d=False)
    if a.ndim > 1:
        a = a.mean(1)
    if sr != 16000:
        a = librosa.resample(a, orig_sr=sr, target_sr=16000)
    return a[: 16000 * 30]


proc = WhisperProcessor.from_pretrained(args.base)
tok, fe = proc.tokenizer, proc.feature_extractor
tok.set_prefix_tokens(language="urdu", task="transcribe")


def make_batch(items):
    audio = [decode(b) for b, _ in items]
    ids = [tok(t).input_ids[:448] for _, t in items]
    return audio, ids


def batches(data, bs, shuffle, loop):
    """Background thread decodes audio + tokenises; main thread does mel + GPU work."""
    q = queue.Queue(maxsize=6)

    def work():
        while True:
            order = list(range(len(data)))
            if shuffle:
                random.shuffle(order)
            for i in range(0, len(order) - (bs - 1 if loop else 0), bs):
                q.put(make_batch([data[j] for j in order[i:i + bs]]))
            if not loop:
                q.put(None); return

    threading.Thread(target=work, daemon=True).start()
    while True:
        b = q.get()
        if b is None:
            return
        yield b


def to_gpu(audio, ids):
    feats = fe(audio, sampling_rate=16000, return_tensors="pt", device=DEV).input_features.to(DEV)
    L = max(map(len, ids))
    pad = tok.pad_token_id
    dec = torch.full((len(ids), L), pad, dtype=torch.long)
    for i, x in enumerate(ids):
        dec[i, : len(x)] = torch.tensor(x)
    # Mask padding by position, not by value: Whisper's pad id == eos id, so a value mask
    # would also hide the real <|endoftext|> and the model never learns to stop (endless repeats).
    lab = dec[:, 1:].clone()
    for i, x in enumerate(ids):
        lab[i, len(x) - 1:] = -100
    dec = dec.to(DEV)
    return feats, dec[:, :-1], lab.to(DEV)


# ── model ──────────────────────────────────────────────────────────────────
model = WhisperForConditionalGeneration.from_pretrained(args.base).to(DEV)
model.config.use_cache = False
model.config.apply_spec_augment = True          # light SpecAugment: regularises the small dataset
model.config.mask_time_prob, model.config.mask_feature_prob = 0.05, 0.0
model.gradient_checkpointing_enable()
opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
sched = torch.optim.lr_scheduler.LambdaLR(
    opt, lambda s: min(1.0, (s + 1) / args.warmup) * max(0.0, 1 - s / args.max_steps))
scaler = torch.amp.GradScaler()


def val_loss():
    model.eval(); tot, n = 0.0, 0
    with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
        for audio, ids in batches(cv_val[:48] if args.smoke else cv_val, 16, False, False):
            f, di, lab = to_gpu(audio, ids)
            lg = model(input_features=f, decoder_input_ids=di).logits
            tot += F.cross_entropy(lg.float().transpose(1, 2), lab, ignore_index=-100).item(); n += 1
    model.train()
    return tot / max(n, 1)


def save(path):
    os.makedirs(path, exist_ok=True)
    model.config.use_cache = True
    model.generation_config.language, model.generation_config.task = "urdu", "transcribe"
    model.generation_config.forced_decoder_ids = None
    model.save_pretrained(path, safe_serialization=True)
    proc.save_pretrained(path)
    model.config.use_cache = False


# ── train ──────────────────────────────────────────────────────────────────
print(f"Base val loss (CV val slice): {val_loss():.3f}", flush=True)
model.train()
torch.cuda.reset_peak_memory_stats()
t0 = time.time()
gen = batches(train, args.batch, True, True)
run, last = 0.0, time.time()
for step in range(1, args.max_steps + 1):
    for _ in range(args.accum):
        audio, ids = next(gen)
        f, di, lab = to_gpu(audio, ids)
        with torch.autocast("cuda", dtype=torch.float16):
            lg = model(input_features=f, decoder_input_ids=di).logits
        loss = F.cross_entropy(lg.float().transpose(1, 2), lab, ignore_index=-100) / args.accum
        scaler.scale(loss).backward(); run += loss.item()
    scaler.unscale_(opt)
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    scaler.step(opt); scaler.update(); opt.zero_grad(set_to_none=True); sched.step()
    if step % 50 == 0 or args.smoke:
        el = time.time() - t0
        print(f"step {step}/{args.max_steps} loss {run / (50 if not args.smoke else 1):.3f} lr {sched.get_last_lr()[0]:.2e} "
              f"{(time.time() - last) / (50 if not args.smoke else 1):.2f}s/step elapsed {el / 60:.1f}m "
              f"eta {el / step * (args.max_steps - step) / 60:.0f}m vram {torch.cuda.max_memory_allocated() / 2**30:.1f}G", flush=True)
        run, last = 0.0, time.time()
    if step % 500 == 0:
        print(f"  val loss {val_loss():.3f}", flush=True)
    if step % args.save_every == 0 and step < args.max_steps:
        save(args.out)
        print(f"  checkpoint saved (overwrites previous) at step {step}", flush=True)

train_min = (time.time() - t0) / 60
peak = torch.cuda.max_memory_allocated() / 2**30
save(args.out)
print(f"Final val loss {val_loss():.3f}; saved to {args.out}", flush=True)

# ── final eval: FLEURS ur_pk test ──────────────────────────────────────────
model.eval(); model.config.use_cache = True
hyps, refs = [], []
with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
    for audio, ids in batches(fl_test, args.eval_batch, False, False):
        f = fe(audio, sampling_rate=16000, return_tensors="pt", device=DEV).input_features.to(DEV)
        out = model.generate(f, language="urdu", task="transcribe", max_new_tokens=225, num_beams=1)
        hyps += [norm(t) for t in tok.batch_decode(out, skip_special_tokens=True)]
        refs += [norm(tok.decode(x, skip_special_tokens=True)) for x in ids]
pairs = [(r, h) for r, h in zip(refs, hyps) if r]
wer = jiwer.wer([r for r, _ in pairs], [h for _, h in pairs]) * 100
cer = jiwer.cer([r for r, _ in pairs], [h for _, h in pairs]) * 100
print(f"\nRESULT FLEURS ur_pk test ({len(pairs)} clips): WER {wer:.2f}%  CER {cer:.2f}%")
print(f"RESULT train time {train_min:.1f} min, peak VRAM (training) {peak:.2f} GiB")
for r, h in pairs[:3]:
    print("REF:", r, "\nHYP:", h)
