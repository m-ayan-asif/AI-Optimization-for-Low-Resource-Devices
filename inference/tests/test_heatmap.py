"""
Tests for GET /heatmaps/{filename}.

A real heatmap PNG is created by running /predict first, then its filename
is retrieved from the response.  We also test 404 paths and a path-traversal
attempt.
"""

import os


class TestHeatmapEndpoint:
    def _generate_heatmap_filename(self, client, png_bytes):
        """Helper: POST /predict and return the heatmap_path from the response."""
        res = client.post("/predict", files={"image": ("skin.png", png_bytes, "image/png")})
        assert res.status_code == 200, f"predict failed: {res.text}"
        return res.json()["heatmap_path"]

    # ── Success ───────────────────────────────────────────────────────────────

    def test_success_returns_200_for_existing_heatmap(self, client, png_bytes):
        filename = self._generate_heatmap_filename(client, png_bytes)
        res = client.get(f"/heatmaps/{filename}")
        assert res.status_code == 200

    def test_success_content_type_is_image_png(self, client, png_bytes):
        filename = self._generate_heatmap_filename(client, png_bytes)
        res = client.get(f"/heatmaps/{filename}")
        assert res.headers["content-type"].startswith("image/png")

    def test_success_response_body_is_non_empty(self, client, png_bytes):
        filename = self._generate_heatmap_filename(client, png_bytes)
        res = client.get(f"/heatmaps/{filename}")
        assert len(res.content) > 0

    def test_success_heatmap_has_valid_png_signature(self, client, png_bytes):
        filename = self._generate_heatmap_filename(client, png_bytes)
        res = client.get(f"/heatmaps/{filename}")
        # PNG files start with the 8-byte signature
        assert res.content[:8] == b"\x89PNG\r\n\x1a\n"

    # ── Errors ────────────────────────────────────────────────────────────────

    def test_error_404_for_nonexistent_filename(self, client):
        res = client.get("/heatmaps/does_not_exist.png")
        assert res.status_code == 404
        assert "error" in res.json()

    def test_error_404_for_random_uuid_filename(self, client):
        res = client.get("/heatmaps/00000000-0000-0000-0000-000000000000.png")
        assert res.status_code == 404

    # ── Security ──────────────────────────────────────────────────────────────

    def test_security_path_traversal_attempt_returns_404(self, client):
        """
        A path-traversal payload like ../../../etc/passwd must not return 200.
        FastAPI's routing URL-decodes the path parameter, so the HEATMAP_DIR join
        produces a path outside the heatmap directory.  The os.path.exists check
        for a real system file would return True on Linux, so the server SHOULD
        sanitise the filename.  At minimum, we assert it does NOT return 200.
        """
        res = client.get("/heatmaps/../../../etc/passwd")
        assert res.status_code in (400, 404, 422), (
            f"Path traversal returned unexpected status {res.status_code}"
        )

    def test_security_absolute_path_payload_does_not_leak_files(self, client):
        res = client.get("/heatmaps/%2Fetc%2Fpasswd")
        assert res.status_code in (400, 404, 422)

    # ── Edge cases ────────────────────────────────────────────────────────────

    def test_edge_filename_with_no_extension_returns_404(self, client):
        res = client.get("/heatmaps/noPngExtension")
        assert res.status_code == 404

    def test_edge_empty_filename_segment_returns_404_or_405(self, client):
        res = client.get("/heatmaps/")
        assert res.status_code in (404, 405, 422)
