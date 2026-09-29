-- Migration 003: Runtime Device and System Monitoring
BEGIN;

CREATE TABLE IF NOT EXISTS device_telemetry (
    telemetry_id SERIAL PRIMARY KEY,
    case_id INTEGER REFERENCES screening_cases(case_id) ON DELETE CASCADE,
    device_cores INTEGER,
    device_memory_gb FLOAT,
    effective_connection VARCHAR(20),
    client_rtt_ms INTEGER,
    audio_processing_ms INTEGER,
    browser_user_agent TEXT,
    image_preprocess_ms INTEGER,
    model_inference_ms INTEGER,
    gradcam_generation_ms INTEGER,
    total_server_time_ms INTEGER,
    server_ram_used_mb FLOAT,
    gpu_vram_used_mb FLOAT,
    device_type VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_case ON device_telemetry(case_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON device_telemetry(created_at);

COMMIT;