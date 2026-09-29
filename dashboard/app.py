import os
from pathlib import Path
import psycopg2
import pandas as pd
import streamlit as st
import plotly.express as px
import plotly.graph_objects as go

# ── Page Configuration ───────────────────────────────────────────────────────
st.set_page_config(
    page_title="SkinSense — Runtime Device & Telemetry",
    page_icon="client/src/assets/logo.png" if os.path.exists("client/src/assets/logo.png") else "🟣",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Design Tokens & Custom CSS (Matches client/src/index.css) ────────────────
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');

    html, body, [class*="css"] {
        font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, sans-serif !important;
        background-color: #faf9fc;
        color: #14101c;
    }

    /* Primary Chassis Header */
    .chassis-header {
        background-color: #300060;
        border-bottom: 2px solid #1c0033;
        padding: 0.85rem 1.75rem;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.5rem;
    }

    .brand-title {
        color: #ffffff !important;
        font-size: 1.35rem;
        font-weight: 700;
        letter-spacing: -0.01em;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .brand-subtitle {
        color: #e6dcf4 !important;
        font-size: 0.8125rem;
        margin: 0;
    }

    /* Clinical Record Panels */
    .metric-panel {
        background: #ffffff;
        border: 1px solid #e2dee9;
        border-radius: 6px;
        padding: 1rem 1.25rem;
        height: 100%;
    }

    .panel-label {
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #635c70;
        margin-bottom: 0.25rem;
    }

    .panel-metric {
        font-size: 1.75rem;
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
        color: #14101c;
    }

    .panel-sub {
        font-size: 0.8125rem;
        color: #635c70;
        margin-top: 0.35rem;
    }

    /* Section Headers */
    .section-head {
        font-size: 1.0625rem;
        font-weight: 600;
        color: #14101c;
        border-bottom: 2px solid #14101c;
        padding-bottom: 0.5rem;
        margin-top: 1.5rem;
        margin-bottom: 1rem;
    }

    /* Custom Streamlit Buttons to match .btn-secondary */
    div.stButton > button {
        background-color: #ffffff;
        color: #2b2536;
        border: 1px solid #c9c3d4;
        border-radius: 3px;
        font-weight: 600;
        font-size: 0.8125rem;
        padding: 0.4rem 0.9rem;
        transition: all 0.15s ease;
    }

    div.stButton > button:hover {
        background-color: #f2f0f6;
        border-color: #a9a3b4;
        color: #14101c;
    }
</style>
""", unsafe_allow_html=True)

# ── Database Connection ───────────────────────────────────────────────────────
@st.cache_resource
def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=os.getenv("DB_PORT", 5432),
        database=os.getenv("DB_NAME", "skinsense"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "your_password_here"),
    )

def fetch_telemetry_records():
    conn = get_db_connection()
    query = """
        SELECT 
            dt.telemetry_id,
            dt.case_id,
            dt.device_cores,
            dt.device_memory_gb,
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
            p.top_condition,
            p.confidence_score,
            sc.status AS review_status
        FROM device_telemetry dt
        JOIN screening_cases sc ON dt.case_id = sc.case_id
        LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
        ORDER BY dt.created_at DESC;
    """
    return pd.read_sql(query, conn)

# ── Masthead (Matches client Header chassis) ──────────────────────────────────
logo_path = Path(__file__).resolve().parent.parent / "client" / "src" / "assets" / "logo.png"

col_head, col_action = st.columns([5, 1])

with col_head:
    head_html = f"""
    <div style="display: flex; align-items: center; gap: 0.85rem; margin-bottom: 0.5rem;">
        {'<img src="data:image/png;base64,' + __import__('base64').b64encode(open(logo_path, 'rb').read()).decode() + '" width="34" height="34" />' if logo_path.exists() else ''}
        <div>
            <div style="font-size: 1.375rem; font-weight: 700; color: #14101c; line-height: 1.2;">SkinSense</div>
            <div style="font-size: 0.8125rem; color: #635c70;">Runtime Device Profiling & Hardware Observability</div>
        </div>
    </div>
    """
    st.markdown(head_html, unsafe_allow_html=True)

with col_action:
    if st.button("Refresh Telemetry"):
        st.cache_data.clear()
        st.rerun()

# ── Load Data ─────────────────────────────────────────────────────────────────
try:
    df = fetch_telemetry_records()
except Exception as e:
    st.error(f"PostgreSQL connection failed: {e}")
    st.stop()

if df.empty:
    st.markdown("""
    <div style="background: #ffffff; border: 1px solid #e2dee9; border-radius: 6px; padding: 3rem; text-align: center; color: #635c70;">
        <div style="font-weight: 600; font-size: 0.9375rem; margin-bottom: 0.25rem;">No Screenings Profiled Yet</div>
        <div style="font-size: 0.8125rem;">Complete a patient screening via the web portal to capture runtime device metrics.</div>
    </div>
    """, unsafe_allow_html=True)
    st.stop()

# ── Summary KPI Strip ─────────────────────────────────────────────────────────
k1, k2, k3, k4, k5 = st.columns(5)

total_cases = len(df)
avg_server_ms = round(df["total_server_time_ms"].mean(), 1)
avg_inference_ms = round(df["model_inference_ms"].mean(), 1)
peak_vram_mb = round(df["gpu_vram_used_mb"].max(), 1)
low_res_count = len(df[(df["device_memory_gb"] <= 4) | (df["effective_connection"].isin(["3g", "2g", "slow-2g"]))])
low_res_pct = round((low_res_count / total_cases) * 100, 1)

with k1:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Total Profiled</div>
        <div class="panel-metric">{total_cases}</div>
        <div class="panel-sub">Recorded cases</div>
    </div>
    """, unsafe_allow_html=True)

with k2:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Avg Server Latency</div>
        <div class="panel-metric" style="color: #300060;">{avg_server_ms} <span style="font-size: 1rem;">ms</span></div>
        <div class="panel-sub">Total pipeline duration</div>
    </div>
    """, unsafe_allow_html=True)

with k3:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">MobileNetV3 Forward</div>
        <div class="panel-metric">{avg_inference_ms} <span style="font-size: 1rem;">ms</span></div>
        <div class="panel-sub">Tensor forward pass</div>
    </div>
    """, unsafe_allow_html=True)

with k4:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Peak GPU Allocation</div>
        <div class="panel-metric">{peak_vram_mb} <span style="font-size: 1rem;">MB</span></div>
        <div class="panel-sub">Max VRAM consumption</div>
    </div>
    """, unsafe_allow_html=True)

with k5:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Low-Resource Devices</div>
        <div class="panel-metric" style="color: #a15c00;">{low_res_pct}%</div>
        <div class="panel-sub">{low_res_count} of {total_cases} constrained</div>
    </div>
    """, unsafe_allow_html=True)

# ── Comparative Latency & Hardware Analytics ──────────────────────────────────
st.markdown('<div class="section-head">Runtime Architecture Profile</div>', unsafe_allow_html=True)

col_chart1, col_chart2 = st.columns(2)

with col_chart1:
    stages = {
        "Image Prep": df["image_preprocess_ms"].mean(),
        "Inference": df["model_inference_ms"].mean(),
        "Grad-CAM": df["gradcam_generation_ms"].mean(),
        "Audio Prep": df["audio_processing_ms"].mean(),
    }
    stage_df = pd.DataFrame({"Stage": list(stages.keys()), "Duration": list(stages.values())})

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
            "Audio Prep": "#a890d8",
        },
    )
    fig_stages.update_layout(
        plot_bgcolor="#faf9fc",
        paper_bgcolor="#ffffff",
        margin=dict(l=20, r=20, t=20, b=20),
        yaxis_title="Duration (ms)",
        xaxis_title="",
        showlegend=False,
        font=dict(family="IBM Plex Sans", color="#14101c"),
    )
    st.markdown("""
    <div style="background: #ffffff; border: 1px solid #e2dee9; border-radius: 6px; padding: 1rem;">
        <div class="panel-label">Pipeline Stage Averages (ms)</div>
    """, unsafe_allow_html=True)
    st.plotly_chart(fig_stages, use_container_width=True)
    st.markdown("</div>", unsafe_allow_html=True)

with col_chart2:
    fig_ram = px.histogram(
        df,
        x="device_memory_gb",
        nbins=6,
        color_discrete_sequence=["#300060"],
    )
    fig_ram.update_layout(
        plot_bgcolor="#faf9fc",
        paper_bgcolor="#ffffff",
        margin=dict(l=20, r=20, t=20, b=20),
        xaxis_title="Reported Client RAM (GB)",
        yaxis_title="Screening Count",
        font=dict(family="IBM Plex Sans", color="#14101c"),
    )
    st.markdown("""
    <div style="background: #ffffff; border: 1px solid #e2dee9; border-radius: 6px; padding: 1rem;">
        <div class="panel-label">User Device RAM Distribution</div>
    """, unsafe_allow_html=True)
    st.plotly_chart(fig_ram, use_container_width=True)
    st.markdown("</div>", unsafe_allow_html=True)

# ── Detailed Historical Telemetry Log ─────────────────────────────────────────
st.markdown('<div class="section-head">Profiled Screenings Log</div>', unsafe_allow_html=True)

display_df = df[[
    "case_id",
    "device_memory_gb",
    "device_cores",
    "effective_connection",
    "client_rtt_ms",
    "model_inference_ms",
    "gradcam_generation_ms",
    "total_server_time_ms",
    "gpu_vram_used_mb",
    "top_condition",
    "confidence_score",
    "created_at",
]].copy()

display_df.columns = [
    "Case ID",
    "Device RAM (GB)",
    "CPU Cores",
    "Network",
    "RTT (ms)",
    "Inference (ms)",
    "Grad-CAM (ms)",
    "Server Total (ms)",
    "VRAM (MB)",
    "Predicted Condition",
    "Confidence",
    "Timestamp",
]

display_df["Confidence"] = (display_df["Confidence"] * 100).round(1).astype(str) + "%"
display_df["Timestamp"] = pd.to_datetime(display_df["Timestamp"]).dt.strftime("%Y-%m-%d %H:%M:%S")

st.dataframe(
    display_df,
    use_container_width=True,
    hide_index=True,
)