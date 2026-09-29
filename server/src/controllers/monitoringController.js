const db = require('../models/db');

async function recordTelemetry(req, res) {
  try {
    const { caseId } = req.params;
    const {
      device_cores,
      device_memory_gb,
      client_ram_used_mb,
      effective_connection,
      client_rtt_ms,
      audio_processing_ms,
      browser_user_agent,
      image_preprocess_ms,
      model_inference_ms,
      gradcam_generation_ms,
      total_server_time_ms,
      server_ram_used_mb,
      gpu_vram_used_mb,
      device_type,
    } = req.body;

    const result = await db.query(
      `INSERT INTO device_telemetry (
        case_id,
        device_cores,
        device_memory_gb,
        client_ram_used_mb,
        effective_connection,
        client_rtt_ms,
        audio_processing_ms,
        browser_user_agent,
        image_preprocess_ms,
        model_inference_ms,
        gradcam_generation_ms,
        total_server_time_ms,
        server_ram_used_mb,
        gpu_vram_used_mb,
        device_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        caseId,
        device_cores || null,
        device_memory_gb || null,
        client_ram_used_mb || null,
        effective_connection || 'unknown',
        client_rtt_ms || null,
        audio_processing_ms || null,
        browser_user_agent || null,
        image_preprocess_ms || null,
        model_inference_ms || null,
        gradcam_generation_ms || null,
        total_server_time_ms || null,
        server_ram_used_mb || 0,
        gpu_vram_used_mb || 0,
        device_type || 'cpu',
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('recordTelemetry error:', err);
    res.status(500).json({ error: 'Failed to record device telemetry' });
  }
}

module.exports = { recordTelemetry };
