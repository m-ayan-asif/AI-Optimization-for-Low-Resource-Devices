"""
Tests for GET /health and POST /predict.

The model runs with random weights (MODEL_PATH points to a nonexistent file),
so the predicted class and confidence values are arbitrary.  What we can still
assert rigorously:
  - Response shape: all required JSON keys are present.
  - Numeric contracts: confidence_score in [0, 1]; all_scores sums to ~1.0
    (softmax property holds regardless of weights).
  - Class membership: top_condition is one of the seven valid class names.
  - Side effects: heatmap PNG is written to HEATMAP_DIR after a successful call.
  - Error handling: non-image bytes, empty body, and truncated JPEG all 400.
"""

import os


# ─── GET /health ──────────────────────────────────────────────────────────────

class TestHealth:
    def test_success_returns_200(self, client):
        res = client.get("/health")
        assert res.status_code == 200

    def test_success_contains_expected_keys(self, client):
        body = client.get("/health").json()
        assert "status" in body
        assert "model" in body
        assert "device" in body
        assert "classes" in body

    def test_success_status_is_ok(self, client):
        assert client.get("/health").json()["status"] == "ok"

    def test_success_classes_contains_all_seven_conditions(self, client):
        classes = client.get("/health").json()["classes"]
        expected = {"Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"}
        assert set(classes) == expected

    def test_success_health_reports_model_state(self, client):
        body = client.get("/health").json()
        assert body["model_loaded"] is False          # tests run without weights
        assert body["model_version"].endswith("-UNTRAINED")
        assert body["warmed_up"] is True

    def test_success_asr_model_not_loaded_shown_in_status(self, client):
        # ASR_MODEL_PATH is nonexistent, so asr_pipe is None
        body = client.get("/health").json()
        assert "not loaded" in body["asr_model"]


# ─── POST /predict ────────────────────────────────────────────────────────────

class TestPredict:
    def test_success_returns_200_for_valid_png(self, client, png_bytes):
        res = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")})
        assert res.status_code == 200

    def test_success_returns_200_for_valid_jpeg(self, client, jpeg_bytes):
        res = client.post("/predict", files={"image": ("skin.jpg", jpeg_bytes, "image/jpeg")})
        assert res.status_code == 200

    def test_success_response_has_all_required_keys(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        required = {"model_version", "top_condition", "confidence_score", "all_scores", "heatmap_path", "inference_time_ms"}
        assert required.issubset(body.keys())

    def test_success_top_condition_is_a_class_or_inconclusive(self, client, png_bytes):
        # With random weights the model is near-uniform, so the OOD guard reports
        # "No Disease / Inconclusive". Either outcome is a valid response.
        valid = {"Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis",
                 "Seborrheic Dermatitis", "No Disease / Inconclusive"}
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert body["top_condition"] in valid

    def test_success_status_is_classified_or_out_of_scope(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert body["status"] in ("classified", "out_of_scope")
        if body["status"] == "out_of_scope":
            assert body["top_condition"] == "No Disease / Inconclusive"

    def test_success_untrained_weights_are_tagged_in_model_version(self, client, png_bytes):
        # Tests run without real weights; the response must say so.
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert body["model_version"].endswith("-UNTRAINED")

    def test_success_telemetry_block_has_profiling_fields(self, client, png_bytes):
        t = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()["telemetry"]
        for key in ("image_preprocess_ms", "model_inference_ms", "gradcam_generation_ms",
                    "total_server_time_ms", "server_ram_used_mb", "gpu_vram_used_mb",
                    "device_type", "blur_score", "entropy", "confidence_margin"):
            assert key in t
        assert t["server_ram_used_mb"] >= 0
        assert t["total_server_time_ms"] >= t["model_inference_ms"]

    # ── Runtime guards ────────────────────────────────────────────────────────

    def test_guard_flat_image_rejected_as_too_blurry(self, client, blurry_png_bytes):
        res = client.post("/predict", files={"image": ("flat.png", blurry_png_bytes, "image/png")})
        assert res.status_code == 400
        assert res.json()["code"] == "IMAGE_TOO_BLURRY"

    def test_guard_non_skin_image_rejected(self, client, non_skin_png_bytes):
        res = client.post("/predict", files={"image": ("blue.png", non_skin_png_bytes, "image/png")})
        assert res.status_code == 400
        assert res.json()["code"] == "NO_SKIN_DETECTED"

    def test_guard_oversized_upload_rejected(self, client):
        res = client.post("/predict", files={"image": ("big.png", b"0" * (10 * 1024 * 1024 + 1), "image/png")})
        assert res.status_code == 413
        assert res.json()["code"] == "FILE_TOO_LARGE"

    def test_success_confidence_score_is_between_0_and_1(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert 0.0 <= body["confidence_score"] <= 1.0

    def test_success_all_scores_contains_all_seven_classes(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        expected = {"Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"}
        assert set(body["all_scores"].keys()) == expected

    def test_success_all_scores_sum_approximately_to_one(self, client, png_bytes):
        # Softmax outputs always sum to 1 regardless of the input weights.
        # A tolerance of 0.01 accounts for float32 rounding during JSON serialisation.
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        total = sum(body["all_scores"].values())
        assert abs(total - 1.0) < 0.01, f"Scores sum to {total}, expected ~1.0"

    def test_success_heatmap_file_is_written_to_disk(self, client, png_bytes):
        # Verifies the side effect: /predict must save the Grad-CAM overlay PNG
        # to HEATMAP_DIR so GET /heatmaps/{filename} can serve it later.
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        heatmap_filename = body["heatmap_path"]
        assert heatmap_filename.endswith(".png")
        full_path = os.path.join(os.environ["HEATMAP_DIR"], heatmap_filename)
        assert os.path.exists(full_path), f"Heatmap file not found at {full_path}"

    def test_success_inference_time_ms_is_positive_integer(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert isinstance(body["inference_time_ms"], int)
        assert body["inference_time_ms"] > 0

    def test_success_model_version_is_a_string(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert isinstance(body["model_version"], str)
        assert len(body["model_version"]) > 0

    def test_error_returns_400_for_non_image_bytes(self, client):
        res = client.post("/predict", files={"image": ("notanimage.txt", b"hello world", "text/plain")})
        assert res.status_code == 400
        assert "error" in res.json()

    def test_error_returns_400_for_empty_bytes(self, client):
        res = client.post("/predict", files={"image": ("empty.png", b"", "image/png")})
        assert res.status_code == 400

    def test_error_returns_400_for_truncated_jpeg(self, client):
        res = client.post("/predict", files={"image": ("bad.jpg", b"\xff\xd8\xff", "image/jpeg")})
        assert res.status_code == 400

    def test_edge_large_image_is_resized_and_processed(self, client):
        # The preprocessing pipeline must resize any input to IMG_SIZE×IMG_SIZE before
        # feeding it to the model.  A 2048×2048 image must still succeed.
        import io
        import numpy as np
        from PIL import Image
        rng = np.random.default_rng(5)
        arr = np.clip(np.array([200, 150, 100], dtype=float) + rng.normal(0, 12, (2048, 2048, 1)), 0, 255)
        img = Image.fromarray(arr.astype("uint8"), "RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        res = client.post("/predict", files={"image": ("large.png", buf.getvalue(), "image/png")})
        assert res.status_code == 200




# ─── 8-output models: the trained "not a skin lesion" class ──────────────────

class TestNotALesionClass:
    """The served model can have an 8th output, "not a skin lesion". A photo that scores high on it is rejected
    with NOT_A_LESION (like NO_SKIN_DETECTED) instead of getting a diagnosis; otherwise the 7 disease outputs are
    used exactly as before."""

    def _eight_class_model(self, not_lesion_bias):
        import torch
        import server
        m = server.build_student_large(8)
        with torch.no_grad():
            m.classifier[3].bias.zero_()
            m.classifier[3].bias[7] = not_lesion_bias
        return m.to(server.DEVICE).eval()

    def _patch(self, monkeypatch, model):
        import server
        monkeypatch.setattr(server, "model", model)
        monkeypatch.setattr(server, "grad_cam", server.GradCAM(model))
        monkeypatch.setattr(server, "HAS_NOT_LESION_CLASS", True)

    def test_error_rejects_photo_the_model_calls_not_a_lesion(self, client, png_bytes, monkeypatch):
        self._patch(monkeypatch, self._eight_class_model(not_lesion_bias=50.0))
        res = client.post("/predict", files={"image": ("x.png", png_bytes, "image/png")})
        assert res.status_code == 400
        body = res.json()
        assert body["code"] == "NOT_A_LESION"
        assert body["not_lesion_probability"] > 0.99

    def test_success_lesion_photo_uses_only_the_seven_disease_outputs(self, client, png_bytes, monkeypatch):
        self._patch(monkeypatch, self._eight_class_model(not_lesion_bias=-50.0))
        res = client.post("/predict", files={"image": ("x.png", png_bytes, "image/png")})
        assert res.status_code == 200
        body = res.json()
        assert len(body["all_scores"]) == 7
        assert abs(sum(body["all_scores"].values()) - 1.0) < 0.01
        assert body["telemetry"]["not_lesion_probability"] < 0.01
