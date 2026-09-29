import base64
import os
from pathlib import Path
import psycopg2
import pandas as pd
import streamlit as st
import plotly.express as px
from dotenv import load_dotenv

from metrics import (
    classify_device,
    drop_first_run,
    fmt,
    low_resource_share,
    stage_medians,
    summarize,
)

# Load server/.env automatically without hardcoding credentials
server_env_path = Path(__file__).resolve().parent.parent / "server" / ".env"
if server_env_path.exists():
    load_dotenv(dotenv_path=server_env_path)

st.set_page_config(
    page_title="SkinSense — Runtime Device & Telemetry",
    page_icon="🟣",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── High-Contrast Typography & CSS ───────────────────────────────────────────
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500;600;700;800&display=swap');

    html, body, [class*="css"] {
        font-family: 'IBM Plex Sans', -apple-system, sans-serif !important;
        background-color: #faf9fc;
        color: #14101c;
    }

    /* Metric Panels */
    .metric-panel {
        background: #ffffff;
        border: 2px solid #dcd7e5;
        border-radius: 6px;
        padding: 1.1rem 1.25rem;
    }

    .panel-label {
        font-size: 0.8125rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #2b2536;
        margin-bottom: 0.35rem;
    }

    .panel-metric {
        font-size: 1.9rem;
        font-weight: 800;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
        color: #14101c;
    }

    .panel-sub {
        font-size: 0.875rem;
        font-weight: 600;
        color: #4a4356;
        margin-top: 0.4rem;
    }

    .section-head {
        font-size: 1.25rem;
        font-weight: 800;
        color: #14101c;
        border-bottom: 3px solid #14101c;
        padding-bottom: 0.5rem;
        margin-top: 2rem;
        margin-bottom: 1.25rem;
    }

    /* Refresh Button */
    div.stButton > button {
        background-color: #300060 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 4px !important;
        font-weight: 700 !important;
        font-size: 0.875rem !important;
        padding: 0.5rem 1.25rem !important;
    }

    /* High-Contrast Table Styling */
    .telemetry-table {
        width: 100%;
        border-collapse: collapse;
        background-color: #ffffff;
        border: 2px solid #c9c3d4;
        border-radius: 4px;
        overflow: hidden;
        margin-top: 0.5rem;
    }

    .telemetry-table th {
        background-color: #2b2536;
        color: #ffffff;
        font-weight: 700;
        font-size: 0.875rem;
        padding: 12px 14px;
        text-align: left;
        letter-spacing: 0.03em;
    }

    .telemetry-table td {
        padding: 12px 14px;
        border-bottom: 1px solid #e2dee9;
        font-size: 0.9375rem;
        font-weight: 600;
        color: #14101c;
        font-variant-numeric: tabular-nums;
    }

    .telemetry-table tr:hover {
        background-color: #f4f0fa;
    }

    .badge-net {
        background-color: #e6dcf4;
        color: #300060;
        padding: 3px 8px;
        border-radius: 3px;
        font-weight: 700;
        font-size: 0.8125rem;
    }
</style>
""", unsafe_allow_html=True)

# ── Database Connection ───────────────────────────────────────────────────────
# Use a READ-ONLY role for the dashboard (see documentation/SETUP_INSTRUCTIONS.md).
# DASHBOARD_DB_USER / DASHBOARD_DB_PASSWORD fall back to the app's DB_* settings;
# there is deliberately no hard-coded password default.
def _connect():
    user = os.getenv("DASHBOARD_DB_USER") or os.getenv("DB_USER", "postgres")
    password = os.getenv("DASHBOARD_DB_PASSWORD") or os.getenv("DB_PASSWORD")
    if not password:
        raise RuntimeError(
            "No database password configured. Set DASHBOARD_DB_PASSWORD (read-only role) "
            "or DB_PASSWORD in server/.env."
        )
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        database=os.getenv("DB_NAME", "skinsense"),
        user=user,
        password=password,
        connect_timeout=5,
        options="-c default_transaction_read_only=on",
    )


@st.cache_resource
def _cached_connection():
    return _connect()


def get_db_connection():
    conn = _cached_connection()
    if conn.closed:  # server restarted / idle timeout: reconnect
        _cached_connection.clear()
        conn = _cached_connection()
    return conn


TELEMETRY_QUERY = """
    SELECT
        dt.telemetry_id,
        dt.case_id,
        dt.device_cores,
        dt.device_memory_gb,
        dt.client_ram_used_mb,
        dt.effective_connection,
        dt.client_rtt_ms,
        dt.audio_processing_ms,
        dt.image_preprocess_ms,
        dt.model_inference_ms,
        dt.gradcam_generation_ms,
        dt.total_server_time_ms,
        dt.server_ram_used_mb,
        dt.gpu_vram_used_mb,
        dt.device_type,
        dt.created_at,
        COALESCE(p.top_condition, 'Screening In Progress') AS top_condition,
        p.confidence_score AS confidence_score,
        sc.status AS review_status
    FROM device_telemetry dt
    JOIN screening_cases sc ON dt.case_id = sc.case_id
    LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
    ORDER BY dt.created_at DESC;
"""


def fetch_telemetry_records():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(TELEMETRY_QUERY)
            columns = [c[0] for c in cur.description]
            rows = cur.fetchall()
        conn.rollback()  # read-only: just end the transaction
    except Exception:
        conn.rollback()
        raise
    df = pd.DataFrame.from_records(rows, columns=columns)
    for col in df.columns:
        if col not in ("top_condition", "effective_connection", "device_type", "review_status", "created_at"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df

# ── Masthead ──────────────────────────────────────────────────────────────────
logo_path = Path(__file__).resolve().parent.parent / "client" / "src" / "assets" / "logo.png"

logo_img = ""
if logo_path.exists():
    logo_b64 = base64.b64encode(logo_path.read_bytes()).decode()
    logo_img = f'<img src="data:image/png;base64,{logo_b64}" width="40" height="40" />'

col_head, col_action = st.columns([5, 1])

with col_head:
    head_html = f"""
    <div style="display: flex; align-items: center; gap: 0.85rem; margin-bottom: 0.5rem;">
        {logo_img}
        <div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #14101c; line-height: 1.2;">SkinSense</div>
            <div style="font-size: 0.875rem; font-weight: 600; color: #4a4356;">Runtime Device Profiling & Hardware Observability</div>
        </div>
    </div>
    """
    st.markdown(head_html, unsafe_allow_html=True)

with col_action:
    if st.button("Refresh Telemetry"):
        st.rerun()

# ── Load Data ─────────────────────────────────────────────────────────────────
try:
    df = fetch_telemetry_records()
except Exception as e:
    st.error(f"PostgreSQL Connection Error: {e}")
    st.stop()

if df.empty:
    st.markdown("""
    <div style="background: #ffffff; border: 2px solid #c9c3d4; border-radius: 6px; padding: 3rem; text-align: center; color: #14101c;">
        <div style="font-weight: 700; font-size: 1.1rem; margin-bottom: 0.5rem;">No Screenings Profiled Yet</div>
        <div style="font-size: 0.9rem; color: #4a4356;">Submit a screening via the web client to view runtime hardware telemetry.</div>
    </div>
    """, unsafe_allow_html=True)
    st.stop()

# ── Filters ───────────────────────────────────────────────────────────────────
df["device_class"] = classify_device(df)

f1, f2, f3 = st.columns([2, 2, 3])
with f1:
    class_choice = st.selectbox("Device profile", ["All", "Low-resource", "Standard", "Unknown"])
with f2:
    device_types = sorted(df["device_type"].dropna().unique().tolist())
    type_choice = st.multiselect("Inference device", device_types, default=device_types)
with f3:
    skip_cold = st.checkbox(
        "Exclude first run (cold start)",
        value=False,
        help="Drops the chronologically first profiled screening, which can include one-off warm-up costs.",
    )

view = df.copy()
if class_choice != "All":
    view = view[view["device_class"] == class_choice]
if device_types:
    view = view[view["device_type"].isin(type_choice) | view["device_type"].isna()]
if skip_cold:
    view = drop_first_run(view)

if view.empty:
    st.info("No screenings match the selected filters.")
    st.stop()

# ── KPI Strip ─────────────────────────────────────────────────────────────────
k1, k2, k3, k4, k5 = st.columns(5)

total_cases = len(view)
server_stats = summarize(view["total_server_time_ms"])
infer_stats = summarize(view["model_inference_ms"])
heap_stats = summarize(view["client_ram_used_mb"])
share = low_resource_share(view)

with k1:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Total Screenings</div>
        <div class="panel-metric">{total_cases}</div>
        <div class="panel-sub">Profiled runs</div>
    </div>
    """, unsafe_allow_html=True)

with k2:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Server Latency (median)</div>
        <div class="panel-metric" style="color: #300060;">{fmt(server_stats["median"])} <span style="font-size: 1rem;">ms</span></div>
        <div class="panel-sub">p95 {fmt(server_stats["p95"], "ms")} &middot; n={server_stats["n"]}</div>
    </div>
    """, unsafe_allow_html=True)

with k3:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">MobileNetV3 Forward (median)</div>
        <div class="panel-metric">{fmt(infer_stats["median"])} <span style="font-size: 1rem;">ms</span></div>
        <div class="panel-sub">p95 {fmt(infer_stats["p95"], "ms")} &middot; n={infer_stats["n"]}</div>
    </div>
    """, unsafe_allow_html=True)

with k4:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Client JS Heap (median)</div>
        <div class="panel-metric" style="color: #0f7a43;">{fmt(heap_stats["median"], digits=1)} <span style="font-size: 1rem;">MB</span></div>
        <div class="panel-sub">Page heap, Chromium only &middot; n={heap_stats["n"]} of {total_cases}</div>
    </div>
    """, unsafe_allow_html=True)

with k5:
    pct_text = "—" if share["known"] == 0 else f'{share["pct"]}%'
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Low-Resource Devices</div>
        <div class="panel-metric" style="color: #a15c00;">{pct_text}</div>
        <div class="panel-sub">{share["low"]} of {share["known"]} classifiable (&le;4 GB or &le;3G) &middot; {share["unknown"]} unknown</div>
    </div>
    """, unsafe_allow_html=True)

# ── High-Contrast Visual Charts ───────────────────────────────────────────────
st.markdown('<div class="section-head">Runtime Architecture & Device Profiling</div>', unsafe_allow_html=True)

col_chart1, col_chart2 = st.columns(2)

with col_chart1:
    stage_df = stage_medians(view)

    fig_stages = px.bar(
        stage_df,
        x="Stage",
        y="Duration",
        text_auto=".1f",
        color="Stage",
        color_discrete_map={
            "Image Prep": "#5b2b9e",
            "Inference": "#300060",
            "Grad-CAM": "#6d4aad",
            "Audio Prep": "#8b6cb8",
        },
    )
    fig_stages.update_traces(
        textposition="outside",
        textfont=dict(size=14, color="#14101c", family="IBM Plex Sans"),
        marker_line_color="#14101c",
        marker_line_width=1.5,
    )
    fig_stages.update_layout(
        plot_bgcolor="#ffffff",
        paper_bgcolor="#ffffff",
        margin=dict(l=30, r=20, t=30, b=30),
        yaxis=dict(
            title=dict(text="<b>Duration (ms)</b>", font=dict(size=15, color="#14101c")),
            tickfont=dict(size=13, color="#14101c"),
            gridcolor="#e2dee9",
            zerolinecolor="#14101c",
            zerolinewidth=2,
        ),
        xaxis=dict(
            title=dict(text="<b>Pipeline Stage</b>", font=dict(size=15, color="#14101c")),
            tickfont=dict(size=13, color="#14101c"),
        ),
        showlegend=False,
    )
    st.markdown('<div class="panel-label">Pipeline Stage Latency, median (ms)</div>', unsafe_allow_html=True)
    st.plotly_chart(fig_stages, use_container_width=True)

with col_chart2:
    fig_ram = px.histogram(
        view.dropna(subset=["device_memory_gb"]),
        x="device_memory_gb",
        nbins=8,
        color_discrete_sequence=["#300060"],
    )
    fig_ram.update_traces(marker_line_color="#14101c", marker_line_width=1.5)
    fig_ram.update_layout(
        plot_bgcolor="#ffffff",
        paper_bgcolor="#ffffff",
        margin=dict(l=30, r=20, t=30, b=30),
        xaxis=dict(
            title=dict(text="<b>Reported Client RAM (GB, browser-rounded, max 8)</b>", font=dict(size=15, color="#14101c")),
            tickfont=dict(size=13, color="#14101c"),
            gridcolor="#e2dee9",
        ),
        yaxis=dict(
            title=dict(text="<b>Number of Screenings</b>", font=dict(size=15, color="#14101c")),
            tickfont=dict(size=13, color="#14101c"),
            gridcolor="#e2dee9",
            zerolinecolor="#14101c",
            zerolinewidth=2,
            dtick=1,
        ),
    )
    st.markdown('<div class="panel-label">Client Device Hardware Distribution</div>', unsafe_allow_html=True)
    st.plotly_chart(fig_ram, use_container_width=True)


# ── Detailed Historical Telemetry Log Table ───────────────────────────────────
st.markdown('<div class="section-head">Profiled Screenings Log</div>', unsafe_allow_html=True)

# Build a clean, properly typed DataFrame
display_df = pd.DataFrame({
    "Case ID": [f"#{cid}" for cid in view["case_id"]],
    "Device Class": view["device_class"].values,
    "Device Capacity": [fmt(v, "GB", 1) for v in view["device_memory_gb"]],
    "JS Heap": [fmt(v, "MB", 1) for v in view["client_ram_used_mb"]],
    "CPU Cores": [fmt(v, "cores") for v in view["device_cores"]],
    "Network Tier": [
        "—" if net in (None, "unknown") or pd.isna(net)
        else f"{net} ({fmt(rtt, 'ms')})"
        for net, rtt in zip(view["effective_connection"], view["client_rtt_ms"])
    ],
    "Inference": [fmt(v, "ms") for v in view["model_inference_ms"]],
    "Grad-CAM": [fmt(v, "ms") for v in view["gradcam_generation_ms"]],
    "Total Server": [fmt(v, "ms") for v in view["total_server_time_ms"]],
    "Condition": view["top_condition"].values,
    "Confidence": [fmt(float(c) * 100, "%", 1) if pd.notnull(c) else "—" for c in view["confidence_score"]],
    "Timestamp": pd.to_datetime(view["created_at"]).dt.strftime("%Y-%m-%d %H:%M:%S").values,
})

# Display as an interactive, fully styled high-contrast table
st.dataframe(
    display_df,
    use_container_width=True,
    hide_index=True,
    column_config={
        "Case ID": st.column_config.TextColumn("Case ID", width="small"),
        "Device Class": st.column_config.TextColumn("Device Class", width="small"),
        "Device Capacity": st.column_config.TextColumn("Device Capacity", width="small"),
        "JS Heap": st.column_config.TextColumn("JS Heap", width="small"),
        "CPU Cores": st.column_config.TextColumn("CPU Cores", width="small"),
        "Network Tier": st.column_config.TextColumn("Network Tier", width="medium"),
        "Inference": st.column_config.TextColumn("Inference", width="small"),
        "Grad-CAM": st.column_config.TextColumn("Grad-CAM", width="small"),
        "Total Server": st.column_config.TextColumn("Total Server", width="small"),
        "Condition": st.column_config.TextColumn("Condition", width="medium"),
        "Confidence": st.column_config.TextColumn("Confidence", width="small"),
        "Timestamp": st.column_config.TextColumn("Timestamp", width="medium"),
    }
)
