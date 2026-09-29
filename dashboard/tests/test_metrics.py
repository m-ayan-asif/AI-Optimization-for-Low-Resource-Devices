import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import metrics as m  # noqa: E402


def frame(**cols):
    n = max(len(v) for v in cols.values())
    base = {
        "device_memory_gb": [None] * n,
        "effective_connection": ["unknown"] * n,
        "created_at": pd.date_range("2026-09-30 10:00", periods=n, freq="min"),
    }
    base.update(cols)
    return pd.DataFrame(base)


class TestSummarize:
    def test_median_p95_mean(self):
        s = m.summarize(pd.Series(range(1, 101)))
        assert s["n"] == 100
        assert s["median"] == 50.5
        assert s["p95"] == pytest.approx(95.05)
        assert s["mean"] == 50.5

    def test_nulls_are_excluded_not_zeroed(self):
        s = m.summarize(pd.Series([10, None, 30]))
        assert s["n"] == 2 and s["median"] == 20 and s["mean"] == 20

    def test_all_null_returns_nan_and_zero_n(self):
        s = m.summarize(pd.Series([None, None], dtype="float"))
        assert s["n"] == 0 and np.isnan(s["median"])

    def test_outlier_moves_mean_but_not_median(self):
        s = m.summarize(pd.Series([100, 101, 99, 100, 5000]))
        assert s["median"] == 100
        assert s["mean"] > 1000

    def test_strings_are_coerced_or_dropped(self):
        assert m.summarize(pd.Series(["5", "x", "15"]))["median"] == 10


class TestClassifyDevice:
    def test_low_ram_is_low_resource(self):
        df = frame(device_memory_gb=[2, 4, 8])
        assert m.classify_device(df).tolist() == ["Low-resource", "Low-resource", "Standard"]

    def test_slow_network_is_low_resource(self):
        df = frame(device_memory_gb=[8, 8, 8], effective_connection=["3g", "2g", "4g"])
        assert m.classify_device(df).tolist() == ["Low-resource", "Low-resource", "Standard"]

    def test_nothing_reported_is_unknown_not_standard(self):
        df = frame(device_memory_gb=[None, None])
        assert m.classify_device(df).tolist() == ["Unknown", "Unknown"]

    def test_only_connection_known(self):
        df = frame(device_memory_gb=[None], effective_connection=["4g"])
        assert m.classify_device(df).tolist() == ["Standard"]


class TestLowResourceShare:
    def test_unknown_rows_are_not_counted_as_standard(self):
        df = frame(device_memory_gb=[2, 8, None, None])
        share = m.low_resource_share(df)
        assert share == {"low": 1, "known": 2, "unknown": 2, "pct": 50.0}

    def test_empty(self):
        assert m.low_resource_share(frame(device_memory_gb=[]).iloc[0:0])["known"] == 0

    def test_no_known_rows_gives_nan_pct(self):
        assert np.isnan(m.low_resource_share(frame(device_memory_gb=[None]))["pct"])


class TestDropFirstRun:
    def test_removes_earliest_row_only(self):
        df = frame(model_inference_ms=[900, 100, 110]).sample(frac=1, random_state=1)
        out = m.drop_first_run(df)
        assert len(out) == 2 and 900 not in out["model_inference_ms"].tolist()

    def test_single_row_is_kept(self):
        assert len(m.drop_first_run(frame(model_inference_ms=[5]))) == 1


class TestStageMedians:
    def test_omits_stages_without_data(self):
        df = frame(image_preprocess_ms=[10, 20], model_inference_ms=[100, 200],
                   gradcam_generation_ms=[50, 70], audio_processing_ms=[None, None])
        out = m.stage_medians(df)
        assert out["Stage"].tolist() == ["Image Prep", "Inference", "Grad-CAM"]
        assert out["Duration"].tolist() == [15, 150, 60]

    def test_missing_column_is_tolerated(self):
        assert m.stage_medians(frame(model_inference_ms=[1])).shape[0] == 1


class TestFmt:
    @pytest.mark.parametrize("value", [None, np.nan, pd.NA])
    def test_missing_values_show_dash(self, value):
        assert m.fmt(value, "ms") == "—"

    def test_integer_and_decimal(self):
        assert m.fmt(88.6, "ms") == "89 ms"
        assert m.fmt(14.123, "MB", 1) == "14.1 MB"

    def test_zero_is_shown_not_dashed(self):
        assert m.fmt(0, "ms") == "0 ms"
