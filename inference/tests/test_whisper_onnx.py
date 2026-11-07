"""
Tests for whisper_onnx.py: the torch-free log-mel features and greedy decoder.

log_mel() must match transformers' WhisperFeatureExtractor, because the model only understands those exact features.
The GOLDEN values were produced by that extractor (transformers 5.22), so CI can catch a drift without installing it;
test_parity_with_transformers compares directly when transformers is available.
"""
import json
import os

import numpy as np
import pytest

from quality import is_lfs_pointer
from whisper_onnx import CHUNK_SAMPLES, ENCODER_FILE, N_MELS, WhisperOnnx, log_mel, mel_filter_bank, session_options

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_MODEL = os.path.join(HERE, "..", "models", "asr", "whisper-small-urdu-onnx")
REAL_ENCODER = os.path.join(REAL_MODEL, ENCODER_FILE)
needs_real_model = pytest.mark.skipif(
    not os.path.exists(REAL_ENCODER) or is_lfs_pointer(REAL_ENCODER), reason="real Whisper files not pulled from LFS")
GOLDEN = {"mean": -0.9041261672973633, "std": 0.10915844887495041, "min": -0.9112812280654907, "max": 1.0887187719345093,
          "bin_10_20": 0.99925297498703}


def tones(seconds=1.0):
    t = np.arange(int(16000 * seconds)) / 16000
    return (0.1 * np.sin(2 * np.pi * 440 * t) + 0.05 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32)


class TestLogMel:
    def test_success_shape_and_dtype(self):
        mel = log_mel(tones())
        assert mel.shape == (1, N_MELS, 3000)
        assert mel.dtype == np.float32

    def test_success_matches_the_pinned_transformers_output(self):
        mel = log_mel(tones())[0]
        assert float(mel.mean()) == pytest.approx(GOLDEN["mean"], abs=1e-4)
        assert float(mel.std()) == pytest.approx(GOLDEN["std"], abs=1e-4)
        assert float(mel.min()) == pytest.approx(GOLDEN["min"], abs=1e-4)
        assert float(mel.max()) == pytest.approx(GOLDEN["max"], abs=1e-4)
        assert float(mel[10, 20]) == pytest.approx(GOLDEN["bin_10_20"], abs=1e-4)

    def test_success_parity_with_transformers(self):
        transformers = pytest.importorskip("transformers")
        extractor = transformers.WhisperFeatureExtractor(feature_size=N_MELS)
        rng = np.random.default_rng(0)
        for seconds in (0.1, 7.3, 30.0, 45.0):
            audio = tones(seconds) + 0.01 * rng.normal(size=int(16000 * seconds)).astype(np.float32)
            ref = extractor(audio, sampling_rate=16000, return_tensors="np").input_features
            assert np.abs(ref - log_mel(audio)).max() < 1e-3

    def test_edge_silence_does_not_produce_nan(self):
        assert np.isfinite(log_mel(np.zeros(16000, np.float32))).all()

    def test_edge_empty_audio_is_padded(self):
        assert log_mel(np.zeros(0, np.float32)).shape == (1, N_MELS, 3000)

    def test_edge_longer_audio_is_truncated_to_one_window(self):
        long = tones(40)
        assert np.array_equal(log_mel(long), log_mel(long[:CHUNK_SAMPLES]))


class TestSessionOptions:
    def test_success_memory_arena_stays_off_and_threads_are_applied(self):
        # With the arena on, the service stayed at 2.1 GB after a burst of requests instead of returning to about 0.6 GB
        options = session_options(3)
        assert options.enable_cpu_mem_arena is False
        assert options.intra_op_num_threads == 3


class TestMelFilterBank:
    def test_success_shape_and_non_negative(self):
        filters = mel_filter_bank()
        assert filters.shape == (201, N_MELS)
        assert (filters >= 0).all()

    def test_success_every_filter_covers_some_frequency(self):
        assert (mel_filter_bank().sum(axis=0) > 0).all()


class FakeEncoder:
    def __init__(self):
        self.calls = 0

    def run(self, names, feed):
        self.calls += 1
        assert feed["input_features"].shape == (1, N_MELS, 3000)
        return [np.zeros((1, 4, 8), np.float32)]


class FakeDecoder:
    """Plays back a list of token ids and records how the cache was fed."""

    def __init__(self, tokens, vocab=100):
        self.tokens, self.vocab, self.feeds, self.step = tokens, vocab, [], 0

    def run(self, names, feed):
        self.feeds.append(feed)
        logits = np.zeros((1, feed["input_ids"].shape[1], self.vocab), np.float32)
        logits[0, -1, self.tokens[self.step]] = 10.0
        self.step += 1
        empty = np.zeros((1, 2, 0, 4), np.float32)
        filled = np.full((1, 2, self.step, 4), self.step, np.float32)
        present = [logits]
        for name in names[1:]:
            present.append(filled if ".decoder." in name or self.step == 1 else empty)
        return present


class FakeTokenizer:
    def decode(self, ids, skip_special_tokens=True):
        return " ".join(str(i) for i in ids)


def make_whisper(decoder):
    w = WhisperOnnx.__new__(WhisperOnnx)
    w.encoder, w.decoder, w.tokenizer = FakeEncoder(), decoder, FakeTokenizer()
    w.prompt, w.suppress, w.begin_suppress, w.eos, w.max_new_tokens = [90, 91, 92, 93], [], [], 99, 20
    w.empty_past = np.zeros((1, 2, 0, 4), np.float32)
    w.past_names = ["past_key_values.0.decoder.key", "past_key_values.0.encoder.key"]
    w.output_names = ["logits", "present.0.decoder.key", "present.0.encoder.key"]
    return w


class TestGreedyDecode:
    def test_success_stops_at_end_of_text_and_skips_the_prompt(self):
        w = make_whisper(FakeDecoder([5, 6, 99]))
        assert w.transcribe(tones()) == "5 6"

    def test_success_first_step_sends_the_whole_prompt_without_cache(self):
        d = FakeDecoder([5, 99])
        make_whisper(d).transcribe(tones())
        assert d.feeds[0]["input_ids"].tolist() == [[90, 91, 92, 93]]
        assert d.feeds[0]["use_cache_branch"].tolist() == [False]

    def test_success_later_steps_send_one_token_and_keep_the_cross_attention_cache(self):
        d = FakeDecoder([5, 6, 99])
        make_whisper(d).transcribe(tones())
        assert d.feeds[1]["input_ids"].tolist() == [[5]]
        assert d.feeds[1]["use_cache_branch"].tolist() == [True]
        # The encoder cache only exists after step 1 and must still be there at step 3 (value 1 = from the first step)
        assert d.feeds[2]["past_key_values.0.encoder.key"].shape[2] == 1
        assert d.feeds[2]["past_key_values.0.decoder.key"].shape[2] == 2

    def test_success_suppressed_tokens_are_never_chosen(self):
        w = make_whisper(FakeDecoder([7, 99]))
        w.suppress = [7]
        # With 7 suppressed the first scores are all zero or -inf, so argmax falls on another token
        assert "7" not in w.transcribe(tones()).split()

    def test_success_begin_suppress_applies_to_the_first_token_only(self):
        w = make_whisper(FakeDecoder([7, 7, 99]))
        w.begin_suppress = [7]
        assert w.transcribe(tones()).split()[1] == "7"

    def test_edge_stops_at_the_token_limit(self):
        w = make_whisper(FakeDecoder([5] * 30))
        assert len(w.transcribe(tones()).split()) == 20

    def test_success_long_audio_uses_consecutive_windows(self):
        class Repeating(FakeDecoder):
            def run(self, names, feed):
                self.step = 0 if feed["use_cache_branch"].tolist() == [False] else self.step
                return super().run(names, feed)

        w = make_whisper(Repeating([5, 99]))
        assert w.transcribe(tones(65)) == "5 5 5"
        assert w.encoder.calls == 3


@needs_real_model
class TestRealWhisper:
    @pytest.fixture
    def whisper(self):
        return WhisperOnnx(REAL_MODEL, threads=2)

    def test_success_prompt_is_urdu_transcribe_without_timestamps(self, whisper):
        with open(os.path.join(REAL_MODEL, "generation_config.json"), encoding="utf-8") as fh:
            gen = json.load(fh)
        assert whisper.prompt == [gen["decoder_start_token_id"], gen["lang_to_id"]["<|ur|>"], gen["task_to_id"]["transcribe"],
                                  gen["no_timestamps_token_id"]]

    def test_success_transcribe_returns_text_for_real_input(self, whisper):
        assert isinstance(whisper.transcribe(tones(1.0)), str)
