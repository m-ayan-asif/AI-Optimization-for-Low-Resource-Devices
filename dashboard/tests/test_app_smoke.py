"""
Smoke test: run the Streamlit app headlessly against a fake DB connection and
check it renders honest numbers (no fabricated defaults, NULLs excluded).
"""
import datetime as dt
import sys
from pathlib import Path
from unittest import mock

import pytest

pytest.importorskip("streamlit")
from streamlit.testing.v1 import AppTest  # noqa: E402

APP = str(Path(__file__).resolve().parent.parent / "app.py")
COLUMNS = [
    "telemetry_id", "case_id", "device_cores", "device_memory_gb", "client_ram_used_mb",
    "effective_connection", "client_rtt_ms", "audio_processing_ms", "image_preprocess_ms",
    "model_inference_ms", "gradcam_generation_ms", "total_server_time_ms", "server_ram_used_mb",
    "gpu_vram_used_mb", "device_type", "created_at", "top_condition", "confidence_score", "review_status",
]


@pytest.fixture(autouse=True)
def _fresh_streamlit_cache():
    """The app caches its DB connection with st.cache_resource; isolate each test."""
    import streamlit as st
    st.cache_resource.clear()
    yield
    st.cache_resource.clear()


@pytest.fixture(autouse=True)
def _ignore_real_env_file(monkeypatch):
    """
    app.py loads server/.env at start-up. On a developer machine that file holds
    the real DB password and would silently re-populate the variables these tests
    remove, so the "missing password" test only passed on machines without the
    file (e.g. CI). Make the tests hermetic by turning load_dotenv into a no-op.
    """
    import dotenv
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: False)


def row(i, mem, heap, conn, infer, total, conf=0.8):
    return (i, i, 4, mem, heap, conn, 100, None, 30, infer, 120, total, 10.0, 0.0, "cpu",
            dt.datetime(2026, 9, 30, 10, i), "Eczema", conf, "pending")


class FakeCursor:
    def __init__(self, rows):
        self.rows, self.description = rows, [(c,) for c in COLUMNS]
    def execute(self, _q): pass
    def fetchall(self): return self.rows
    def __enter__(self): return self
    def __exit__(self, *a): return False


class FakeConn:
    closed = False
    def __init__(self, rows): self.rows = rows
    def cursor(self): return FakeCursor(self.rows)
    def rollback(self): pass


def run(rows, monkeypatch):
    monkeypatch.setenv("DB_PASSWORD", "x")
    sys.path.insert(0, str(Path(APP).parent))
    with mock.patch("psycopg2.connect", return_value=FakeConn(rows)):
        at = AppTest.from_file(APP, default_timeout=30)
        at.run()
    return at


def test_renders_median_and_never_invents_heap_value(monkeypatch):
    rows = [row(1, 4.0, None, "3g", 90, 300), row(2, 8.0, None, "4g", 110, 340), row(3, 2.0, None, "unknown", 100, 320)]
    at = run(rows, monkeypatch)
    assert not at.exception
    html = " ".join(m.value for m in at.markdown)
    assert "24.8" not in html                 # the old fabricated COALESCE default
    assert "n=0 of 3" in html                 # no heap data was reported: shown honestly
    assert "Server Latency (median)" in html
    assert ">320" in html.replace(" ", "") or "320" in html


def test_empty_table_shows_empty_state(monkeypatch):
    at = run([], monkeypatch)
    assert not at.exception
    assert any("No Screenings Profiled Yet" in m.value for m in at.markdown)


def test_missing_password_is_reported_not_defaulted(monkeypatch):
    monkeypatch.delenv("DB_PASSWORD", raising=False)
    monkeypatch.delenv("DASHBOARD_DB_PASSWORD", raising=False)
    at = AppTest.from_file(APP, default_timeout=30)
    at.run()
    assert any("No database password configured" in e.value for e in at.error)
