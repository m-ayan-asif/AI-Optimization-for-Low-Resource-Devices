"""
Torch-free Whisper for the inference service: our Urdu whisper-small fine-tune (int8 ONNX, the same files the PWA runs).

log_mel() matches transformers' WhisperFeatureExtractor (pinned by tests/test_whisper_onnx.py) and WhisperOnnx.transcribe()
is the greedy decode that generation_config.json describes.
"""
import json
import os

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

SAMPLE_RATE = 16000
N_FFT = 400
HOP_LENGTH = 160
N_MELS = 80
CHUNK_SAMPLES = 30 * SAMPLE_RATE  # Whisper's fixed input window
ENCODER_FILE = "encoder_model_quantized.onnx"
DECODER_FILE = "decoder_model_merged_quantized.onnx"


def _hz_to_mel(freq):
    # Slaney scale: linear below 1 kHz, logarithmic above
    freq = np.asarray(freq, dtype=np.float64)
    logstep = 27.0 / np.log(6.4)
    return np.where(freq < 1000.0, 3.0 * freq / 200.0, 15.0 + logstep * np.log(np.maximum(freq, 1e-10) / 1000.0))


def _mel_to_hz(mel):
    mel = np.asarray(mel, dtype=np.float64)
    logstep = np.log(6.4) / 27.0
    return np.where(mel < 15.0, 200.0 * mel / 3.0, 1000.0 * np.exp(logstep * (mel - 15.0)))


def mel_filter_bank():
    """Slaney-normalised triangular filters, shape (N_FFT // 2 + 1, N_MELS)."""
    fft_freqs = np.linspace(0, SAMPLE_RATE // 2, N_FFT // 2 + 1)
    edges = _mel_to_hz(np.linspace(_hz_to_mel(0.0), _hz_to_mel(SAMPLE_RATE / 2), N_MELS + 2))
    widths = np.diff(edges)
    slopes = edges[None, :] - fft_freqs[:, None]
    down = -slopes[:, :-2] / widths[:-1]
    up = slopes[:, 2:] / widths[1:]
    filters = np.maximum(0.0, np.minimum(down, up))
    return filters * (2.0 / (edges[2:] - edges[:-2]))[None, :]


_MEL_FILTERS = mel_filter_bank()
_WINDOW = np.hanning(N_FFT + 1)[:-1]  # periodic Hann


def log_mel(audio):
    """Whisper's input for one window: (1, N_MELS, 3000) float32, zero-padded or truncated to 30 s."""
    audio = np.asarray(audio, dtype=np.float32)[:CHUNK_SAMPLES]
    audio = np.pad(audio, (0, CHUNK_SAMPLES - len(audio)))
    padded = np.pad(audio, N_FFT // 2, mode="reflect")
    n_frames = 1 + (len(padded) - N_FFT) // HOP_LENGTH
    frames = np.lib.stride_tricks.sliding_window_view(padded, N_FFT)[::HOP_LENGTH][:n_frames]
    power = np.abs(np.fft.rfft(frames * _WINDOW, axis=1)) ** 2
    mel = np.log10(np.maximum(1e-10, power @ _MEL_FILTERS)).T[:, :-1]  # Whisper drops the last frame
    mel = np.maximum(mel, mel.max() - 8.0)
    return ((mel + 4.0) / 4.0)[None].astype(np.float32)


def session_options(threads):
    """ONNX Runtime's memory arena never hands back what a busy moment grabbed, so it stays off on this low-RAM service."""
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    return options


class WhisperOnnx:
    """Thread-safe: ONNX Runtime sessions allow concurrent run() calls and a decode keeps its state on the stack."""

    def __init__(self, model_dir, threads=4):
        options = session_options(threads)
        providers = ["CPUExecutionProvider"]
        self.encoder = ort.InferenceSession(os.path.join(model_dir, ENCODER_FILE), options, providers=providers)
        self.decoder = ort.InferenceSession(os.path.join(model_dir, DECODER_FILE), options, providers=providers)
        self.tokenizer = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        with open(os.path.join(model_dir, "generation_config.json"), encoding="utf-8") as fh:
            gen = json.load(fh)
        with open(os.path.join(model_dir, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.prompt = [gen["decoder_start_token_id"], gen["lang_to_id"]["<|ur|>"], gen["task_to_id"]["transcribe"],
                       gen["no_timestamps_token_id"]]
        self.suppress = gen.get("suppress_tokens") or []
        self.begin_suppress = gen.get("begin_suppress_tokens") or []
        self.eos = gen["eos_token_id"]
        self.max_new_tokens = gen.get("max_length", 448) - len(self.prompt)
        heads = cfg["decoder_attention_heads"]
        self.empty_past = np.zeros((1, heads, 0, cfg["d_model"] // heads), np.float32)
        self.past_names = [i.name for i in self.decoder.get_inputs() if i.name.startswith("past_key_values")]
        self.output_names = [o.name for o in self.decoder.get_outputs()]

    def _decode(self, encoder_states):
        ids = list(self.prompt)
        generated, past, encoder_past = [], None, {}
        for step in range(self.max_new_tokens):
            feed = {"encoder_hidden_states": encoder_states}
            if past is None:
                feed["input_ids"] = np.array([ids], np.int64)
                feed["use_cache_branch"] = np.array([False])
                feed.update({name: self.empty_past for name in self.past_names})
            else:
                feed["input_ids"] = np.array([[ids[-1]]], np.int64)
                feed["use_cache_branch"] = np.array([True])
                feed.update(past)
            logits, *present = self.decoder.run(self.output_names, feed)
            scores = logits[0, -1].copy()
            scores[self.suppress] = -np.inf
            if step == 0:
                scores[self.begin_suppress] = -np.inf
            token = int(scores.argmax())
            current = {n.replace("present", "past_key_values"): v for n, v in zip(self.output_names[1:], present)}
            # The cross-attention cache is computed once, on the first step; later steps return it empty
            if past is None:
                encoder_past = {n: v for n, v in current.items() if ".encoder." in n}
            current.update(encoder_past)
            past = current
            if token == self.eos:
                break
            ids.append(token)
            generated.append(token)
        return generated

    def transcribe(self, audio):
        """Transcribes 16 kHz mono float32 audio as Urdu. Longer clips are cut into consecutive 30 s windows."""
        audio = np.asarray(audio, dtype=np.float32)
        parts = []
        for start in range(0, max(len(audio), 1), CHUNK_SAMPLES):
            states = self.encoder.run(None, {"input_features": log_mel(audio[start:start + CHUNK_SAMPLES])})[0]
            parts.append(self.tokenizer.decode(self._decode(states), skip_special_tokens=True).strip())
        return " ".join(p for p in parts if p)
