-- Migration 004: Add guard calibration metrics and true compute duration
BEGIN;

ALTER TABLE device_telemetry
  ADD COLUMN IF NOT EXISTS blur_score FLOAT,
  ADD COLUMN IF NOT EXISTS entropy FLOAT,
  ADD COLUMN IF NOT EXISTS confidence_margin FLOAT,
  ADD COLUMN IF NOT EXISTS asr_compute_ms INTEGER;

COMMIT;