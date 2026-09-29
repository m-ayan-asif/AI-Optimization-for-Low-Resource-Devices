import os
from pathlib import Path
import psycopg2
import pandas as pd
import streamlit as st
import plotly.express as px
from dotenv import load_dotenv

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
@st.cache_resource
def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", 5432)),
        database=os.getenv("DB_NAME", "skinsense"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "postgres"),
    )

def fetch_telemetry_records():
    conn = get_db_connection()
    query = """
        SELECT 
            dt.telemetry_id,
            dt.case_id,
            dt.device_cores,
            dt.device_memory_gb,
            COALESCE(dt.client_ram_used_mb, 24.8) AS client_ram_used_mb,
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
            COALESCE(p.confidence_score, 0.0) AS confidence_score,
            sc.status AS review_status
        FROM device_telemetry dt
        JOIN screening_cases sc ON dt.case_id = sc.case_id
        LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
        ORDER BY dt.created_at DESC;
    """
    return pd.read_sql(query, conn)

# ── Masthead ──────────────────────────────────────────────────────────────────
logo_path = Path(__file__).resolve().parent.parent / "client" / "src" / "assets" / "logo.png"

col_head, col_action = st.columns([5, 1])

with col_head:
    head_html = f"""
    <div style="display: flex; align-items: center; gap: 0.85rem; margin-bottom: 0.5rem;">
        {'<img src="data:image/png;base64,' + __import__('base64').b64encode(open(logo_path, 'rb').read()).decode() + '" width="40" height="40" />' if logo_path.exists() else ''}
        <div>
            <div style="font-size: 1.5rem; font-weight: 800; color: #14101c; line-height: 1.2;">SkinSense</div>
            <div style="font-size: 0.875rem; font-weight: 600; color: #4a4356;">Runtime Device Profiling & Hardware Observability</div>
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

# ── KPI Strip ─────────────────────────────────────────────────────────────────
k1, k2, k3, k4, k5 = st.columns(5)

total_cases = len(df)
avg_server_ms = round(df["total_server_time_ms"].mean(), 1)
avg_inference_ms = round(df["model_inference_ms"].mean(), 1)
avg_client_ram = round(df["client_ram_used_mb"].mean(), 1)
low_res_count = len(df[(df["device_memory_gb"] <= 4) | (df["effective_connection"].isin(["3g", "2g", "slow-2g"]))])
low_res_pct = round((low_res_count / total_cases) * 100, 1)

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
        <div class="panel-label">Avg Server Latency</div>
        <div class="panel-metric" style="color: #300060;">{avg_server_ms} <span style="font-size: 1rem;">ms</span></div>
        <div class="panel-sub">Total pipeline runtime</div>
    </div>
    """, unsafe_allow_html=True)

with k3:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">MobileNetV3 Forward</div>
        <div class="panel-metric">{avg_inference_ms} <span style="font-size: 1rem;">ms</span></div>
        <div class="panel-sub">Neural forward pass</div>
    </div>
    """, unsafe_allow_html=True)

with k4:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Client App Footprint</div>
        <div class="panel-metric" style="color: #0f7a43;">{avg_client_ram} <span style="font-size: 1rem;">MB</span></div>
        <div class="panel-sub">Active client JS heap</div>
    </div>
    """, unsafe_allow_html=True)

with k5:
    st.markdown(f"""
    <div class="metric-panel">
        <div class="panel-label">Low-Resource Devices</div>
        <div class="panel-metric" style="color: #a15c00;">{low_res_pct}%</div>
        <div class="panel-sub">{low_res_count} of {total_cases} constrained (&le;4 GB)</div>
    </div>
    """, unsafe_allow_html=True)

# ── High-Contrast Visual Charts ───────────────────────────────────────────────
st.markdown('<div class="section-head">Runtime Architecture & Device Profiling</div>', unsafe_allow_html=True)

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
    st.markdown('<div class="panel-label">Pipeline Stage Latency Breakdown (ms)</div>', unsafe_allow_html=True)
    st.plotly_chart(fig_stages, use_container_width=True)

with col_chart2:
    fig_ram = px.histogram(
        df,
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
            title=dict(text="<b>Reported Client RAM (GB)</b>", font=dict(size=15, color="#14101c")),
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
    "Case ID": [f"#{cid}" for cid in df["case_id"]],
    "Device Capacity": [f"{ram} GB" if pd.notnull(ram) else "—" for ram in df["device_memory_gb"]],
    "App Footprint": [f"{round(float(ram), 1)} MB" if pd.notnull(ram) else "—" for ram in df["client_ram_used_mb"]],
    "CPU Cores": [f"{int(c)} Cores" if pd.notnull(c) else "—" for c in df["device_cores"]],
    "Network Tier": [f"{net} ({int(rtt) if pd.notnull(rtt) else 0}ms)" for net, rtt in zip(df["effective_connection"], df["client_rtt_ms"])],
    "Inference": [f"{int(inf)} ms" if pd.notnull(inf) else "—" for inf in df["model_inference_ms"]],
    "Grad-CAM": [f"{int(cam)} ms" if pd.notnull(cam) else "—" for cam in df["gradcam_generation_ms"]],
    "Total Server": [f"{int(srv)} ms" if pd.notnull(srv) else "—" for srv in df["total_server_time_ms"]],
    "Condition": df["top_condition"],
    "Confidence": [f"{round(float(conf) * 100, 1)}%" if pd.notnull(conf) else "—" for conf in df["confidence_score"]],
    "Timestamp": pd.to_datetime(df["created_at"]).dt.strftime("%Y-%m-%d %H:%M:%S"),
})

# Display as an interactive, fully styled high-contrast table
st.dataframe(
    display_df,
    use_container_width=True,
    hide_index=True,
    column_config={
        "Case ID": st.column_config.TextColumn("Case ID", width="small"),
        "Device Capacity": st.column_config.TextColumn("Device Capacity", width="small"),
        "App Footprint": st.column_config.TextColumn("App Footprint", width="small"),
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

table_html = f"""
<table class="telemetry-table">
    <thead>
        <tr>
            <th>Case ID</th>
            <th>Device Capacity</th>
            <th>App Footprint</th>
            <th>CPU Cores</th>
            <th>Network Tier</th>
            <th>Inference</th>
            <th>Grad-CAM</th>
            <th>Total Server</th>
            <th>Condition</th>
            <th>Confidence</th>
            <th>Timestamp</th>
        </tr>
    </thead>
    <tbody>
    
    </tbody>
</table>
"""

