"""
Tests for GET /health and POST /predict.

The model runs with random weights (no weights file at MODEL_PATH), so
predictions are meaningless, but the response *shape* and *status codes*
are fully exercised.
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

    def test_success_top_condition_is_one_of_the_seven_classes(self, client, png_bytes):
        valid_classes = {"Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"}
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert body["top_condition"] in valid_classes

    def test_success_confidence_score_is_between_0_and_1(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        assert 0.0 <= body["confidence_score"] <= 1.0

    def test_success_all_scores_contains_all_seven_classes(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        expected = {"Vitiligo", "Melasma", "Psoriasis", "Eczema", "Tinea", "Contact Dermatitis", "Seborrheic Dermatitis"}
        assert set(body["all_scores"].keys()) == expected

    def test_success_all_scores_sum_approximately_to_one(self, client, png_bytes):
        body = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")}).json()
        total = sum(body["all_scores"].values())
        assert abs(total - 1.0) < 0.01, f"Scores sum to {total}, expected ~1.0"

    def test_success_heatmap_file_is_written_to_disk(self, client, png_bytes):
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
        from PIL import Image
        import io
        img = Image.new("RGB", (2048, 2048), color=(128, 64, 32))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        res = client.post("/predict", files={"image": ("large.png", buf.getvalue(), "image/png")})
        assert res.status_code == 200
