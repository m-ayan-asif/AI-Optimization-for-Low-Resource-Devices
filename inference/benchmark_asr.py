"""CPU benchmark of a Whisper checkpoint on the first N clips of FLEURS ur_pk test: WER/CER, sec/utterance,
real-time factor and RSS. Produced the ASR comparison table (turbo 25.5% / community small 26.4% / base 40.6% /
ours 23.6% WER on N=100). Runs on CPU in fp32 on purpose - that's the deployment target.

    python inference/benchmark_asr.py <name> <model_dir> --fleurs-test <ur_pk test parquet> [--out-dir DIR] [--n 100]
"""
import argparse, os, sys, io, json, time, unicodedata, re
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
import numpy as np, soundfile as sf, librosa, torch, psutil, pyarrow.parquet as pq, jiwer
from transformers import AutoProcessor, AutoModelForSpeechSeq2Seq

ap = argparse.ArgumentParser()
ap.add_argument("name"); ap.add_argument("path")
ap.add_argument("--fleurs-test", required=True); ap.add_argument("--out-dir", default="."); ap.add_argument("--n", type=int, default=100)
a = ap.parse_args()
name, path, N = a.name, a.path, a.n
torch.set_num_threads(4)

def norm(s):
    s = unicodedata.normalize("NFC", s)
    s = s.replace("\u0640", "")                      # tatweel
    s = "".join(c for c in s if not unicodedata.category(c).startswith(("P", "S", "M")) or c == "\u0654")  # drop punctuation/symbols/diacritics
    s = re.sub(r"[\u064b-\u065f\u0670]", "", s)      # Arabic diacritics
    return re.sub(r"\s+", " ", s).strip().lower()

rows = pq.read_table(a.fleurs_test).slice(0, N).to_pylist()
p = psutil.Process()
proc = AutoProcessor.from_pretrained(path)
model = AutoModelForSpeechSeq2Seq.from_pretrained(path, torch_dtype=torch.float32).eval()
load_rss = p.memory_info().rss / 2**20
refs, hyps, times, durs = [], [], [], []
for r in rows:
    au, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
    if au.ndim > 1: au = au.mean(1)
    if sr != 16000: au = librosa.resample(au, orig_sr=sr, target_sr=16000)
    durs.append(len(au) / 16000)
    feats = proc(au[:16000 * 30], sampling_rate=16000, return_tensors="pt").input_features
    t = time.time()
    with torch.no_grad():
        ids = model.generate(feats, language="urdu", task="transcribe", num_beams=1, max_new_tokens=200)
    times.append(time.time() - t)
    hyps.append(proc.batch_decode(ids, skip_special_tokens=True)[0])
    refs.append(r["raw_transcription"])
nr, nh = [norm(x) for x in refs], [norm(x) for x in hyps]
keep = [i for i, x in enumerate(nr) if x]
out = {"model": name, "n": len(keep),
       "wer": round(100 * jiwer.wer([nr[i] for i in keep], [nh[i] for i in keep]), 1),
       "cer": round(100 * jiwer.cer([nr[i] for i in keep], [nh[i] for i in keep]), 1),
       "sec_per_utt": round(float(np.mean(times)), 2), "audio_s_mean": round(float(np.mean(durs)), 1),
       "rtf": round(float(np.sum(times) / np.sum(durs)), 2),
       "load_rss_mb": round(load_rss), "peak_wset_mb": round(p.memory_info().peak_wset / 2**20),
       "over30s": int(sum(d > 30 for d in durs)), "empty_hyp": int(sum(not x for x in nh))}
json.dump({"summary": out, "refs": refs, "hyps": hyps}, open(os.path.join(a.out_dir, f"asr_{name}.json"), "w", encoding="utf-8"), ensure_ascii=False)
print(json.dumps(out))
