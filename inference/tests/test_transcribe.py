"""
Tests for POST /transcribe.

Test environment setup (see conftest.py):
  ASR_MODEL_PATH is set to a nonexistent directory before server.py is imported,
  so the Whisper pipeline (asr_pipe) is None at startup.  Every request to
  /transcribe therefore returns 503 Service Unavailable.

What these tests verify:
  1. The 503 contract holds for all audio MIME types (WAV, WebM, MP4).
  2. The JSON error body has an 'error' key mentioning the unavailable model.
  3. Input validation: an empty file may return 400 or 503 depending on which
     guard runs first — both status codes are acceptable.
  4. Edge cases: a 255-character filename and a None filename are handled
     without crashing (503 or FastAPI's own 422 validation error).
"""


class TestTranscribeNoASR:
    """When the Whisper model is not loaded, every request must return 503."""

    def test_error_503_with_valid_wav(self, client, wav_bytes):
        res = client.post("/transcribe", files={"audio": ("rec.wav", wav_bytes, "audio/wav")})
        assert res.status_code == 503

    def test_error_503_response_contains_error_key(self, client, wav_bytes):
        body = client.post("/transcribe", files={"audio": ("rec.wav", wav_bytes, "audio/wav")}).json()
        assert "error" in body

    def test_error_503_message_mentions_model_not_loaded(self, client, wav_bytes):
        body = client.post("/transcribe", files={"audio": ("rec.wav", wav_bytes, "audio/wav")}).json()
        assert "not loaded" in body["error"].lower() or "asr" in body["error"].lower()

    def test_error_503_with_webm_audio(self, client):
        res = client.post("/transcribe", files={"audio": ("rec.webm", b"fake webm data", "audio/webm")})
        assert res.status_code == 503

    def test_error_503_with_mp4_audio(self, client):
        res = client.post("/transcribe", files={"audio": ("rec.mp4", b"fake mp4 data", "audio/mp4")})
        assert res.status_code == 503

    def test_error_400_with_empty_audio_file(self, client):
        # Empty file is validated before ASR model check in the /transcribe route
        res = client.post("/transcribe", files={"audio": ("empty.wav", b"", "audio/wav")})
        # Either 400 (caught before ASR check) or 503 (ASR check fires first) are acceptable
        assert res.status_code in (400, 503)

    def test_error_response_is_json(self, client, wav_bytes):
        res = client.post("/transcribe", files={"audio": ("rec.wav", wav_bytes, "audio/wav")})
        assert res.headers["content-type"].startswith("application/json")

    def test_edge_very_large_filename_still_returns_503(self, client, wav_bytes):
        long_name = "a" * 255 + ".wav"
        res = client.post("/transcribe", files={"audio": (long_name, wav_bytes, "audio/wav")})
        assert res.status_code == 503

    def test_edge_no_filename_still_returns_503_or_422(self, client, wav_bytes):
        # When filename is None, FastAPI may fire its own 422 validator before our handler runs
        res = client.post("/transcribe", files={"audio": (None, wav_bytes, "audio/wav")})
        assert res.status_code in (422, 503)
