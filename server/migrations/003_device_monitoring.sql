-- Migration 003: Runtime device and system monitoring
-- Safe to run on a fresh database AND on one where an earlier draft of this
-- table already exists (every statement is idempotent).
BEGIN;

CREATE TABLE IF NOT EXISTS device_telemetry (
    telemetry_id          SERIAL PRIMARY KEY,
    case_id               INTEGER REFERENCES screening_cases(case_id) ON DELETE CASCADE,
    -- client-reported (browser-dependent: any of these can legitimately be NULL)
    device_cores          INTEGER,
    device_memory_gb      FLOAT,          -- navigator.deviceMemory (rounded, capped at 8, Chromium only)
    client_ram_used_mb    FLOAT,          -- JS heap of the page (performance.memory, Chromium only)
    effective_connection  VARCHAR(20),    -- NULL / 'unknown' when the Network Information API is missing
    client_rtt_ms         INTEGER,
    audio_processing_ms   INTEGER,
    browser_user_agent    TEXT,
    -- server-reported (inference service)
    image_preprocess_ms   INTEGER,
    model_inference_ms    INTEGER,
    gradcam_generation_ms INTEGER,
    total_server_time_ms  INTEGER,
    server_ram_used_mb    FLOAT,
    gpu_vram_used_mb      FLOAT,
    device_type           VARCHAR(20),
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Databases created from the first draft of this migration lack this column.
ALTER TABLE device_telemetry ADD COLUMN IF NOT EXISTS client_ram_used_mb FLOAT;

-- One telemetry row per screening case: keep the newest, drop older duplicates,
-- then enforce it so repeated posts cannot skew the averages.
DELETE FROM device_telemetry a
USING device_telemetry b
WHERE a.case_id = b.case_id AND a.telemetry_id < b.telemetry_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telemetry_case ON device_telemetry(case_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON device_telemetry(created_at);

COMMIT;
