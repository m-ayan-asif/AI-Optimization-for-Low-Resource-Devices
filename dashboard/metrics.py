"""
Pure-pandas helpers for the monitoring dashboard (no Streamlit / DB imports),
so the numbers shown to the supervisor can be unit-tested.

Rules applied everywhere:
  * NULL means "not reported" and is EXCLUDED from statistics. It is never
    replaced by a default value.
  * Latency is summarised with median and p95, not the mean, because a single
    slow outlier (cold start, GC pause) would otherwise dominate the average.
"""
from typing import Dict

import numpy as np
import pandas as pd

SLOW_CONNECTIONS = {"slow-2g", "2g", "3g"}
LOW_RAM_GB = 4  # navigator.deviceMemory is capped/rounded; 4 means "4 GB or less"

STAGE_COLUMNS = {
    "Image Prep": "image_preprocess_ms",
    "Inference": "model_inference_ms",
    "Grad-CAM": "gradcam_generation_ms",
    "Audio Prep": "audio_processing_ms",
}


def summarize(series: pd.Series) -> Dict[str, float]:
    """n / median / p95 / mean over the non-null values (NaN when n == 0)."""
    values = pd.to_numeric(series, errors="coerce").dropna()
    if values.empty:
        return {"n": 0, "median": np.nan, "p95": np.nan, "mean": np.nan}
    return {
        "n": int(values.size),
        "median": float(values.median()),
        "p95": float(np.percentile(values, 95)),
        "mean": float(values.mean()),
    }


def classify_device(df: pd.DataFrame) -> pd.Series:
    """
    'Low-resource' if RAM <= 4 GB or the network is <= 3G,
    'Standard'     if at least one indicator is known and none is low,
    'Unknown'      if the browser reported neither (e.g. Safari/Firefox).
    """
    mem = pd.to_numeric(df["device_memory_gb"], errors="coerce")
    conn = df["effective_connection"].where(df["effective_connection"] != "unknown")

    low = (mem <= LOW_RAM_GB) | conn.isin(SLOW_CONNECTIONS)
    known = mem.notna() | conn.notna()

    out = pd.Series("Unknown", index=df.index, dtype="object")
    out[known & ~low] = "Standard"
    out[known & low] = "Low-resource"
    return out


def low_resource_share(df: pd.DataFrame) -> Dict[str, float]:
    """Share of low-resource devices among rows where the device class is known."""
    if df.empty:
        return {"low": 0, "known": 0, "unknown": 0, "pct": np.nan}
    cls = classify_device(df)
    known = int((cls != "Unknown").sum())
    low = int((cls == "Low-resource").sum())
    return {
        "low": low,
        "known": known,
        "unknown": int((cls == "Unknown").sum()),
        "pct": round(100.0 * low / known, 1) if known else np.nan,
    }


def drop_first_run(df: pd.DataFrame) -> pd.DataFrame:
    """Remove the chronologically first run (model warm-up / cold-start artefact)."""
    if len(df) <= 1:
        return df
    return df.drop(index=pd.to_datetime(df["created_at"]).idxmin())


def stage_medians(df: pd.DataFrame) -> pd.DataFrame:
    """Median duration per pipeline stage; stages with no data are omitted."""
    rows = []
    for label, col in STAGE_COLUMNS.items():
        s = summarize(df[col]) if col in df else {"n": 0, "median": np.nan}
        if s["n"] > 0:
            rows.append({"Stage": label, "Duration": s["median"], "n": s["n"]})
    return pd.DataFrame(rows, columns=["Stage", "Duration", "n"])


def fmt(value, unit: str = "", digits: int = 0) -> str:
    """Format a number for display; '—' for missing values."""
    if value is None or pd.isna(value):
        return "—"
    number = round(float(value), digits)
    text = f"{int(number)}" if digits == 0 else f"{number:.{digits}f}"
    return f"{text} {unit}".strip()
