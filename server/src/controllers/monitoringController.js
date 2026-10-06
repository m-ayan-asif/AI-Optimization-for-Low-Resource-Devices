const db = require('../models/db');

/**
 * Allowed fields and their valid ranges. Anything outside the range (or not a
 * finite number) is rejected with a 400 instead of being stored, so a buggy or
 * malicious client cannot pollute the monitoring data.
 */
const NUMERIC_FIELDS = {
  device_cores: { min: 1, max: 256, integer: true },
  device_memory_gb: { min: 0.1, max: 1024 },
  client_ram_used_mb: { min: 0, max: 65536 },
  client_rtt_ms: { min: 0, max: 60000, integer: true },
  audio_processing_ms: { min: 0, max: 600000, integer: true },
  image_preprocess_ms: { min: 0, max: 600000, integer: true },
  model_inference_ms: { min: 0, max: 600000, integer: true },
  gradcam_generation_ms: { min: 0, max: 600000, integer: true },
  total_server_time_ms: { min: 0, max: 600000, integer: true },
  server_ram_used_mb: { min: 0, max: 1048576 },
  gpu_vram_used_mb: { min: 0, max: 1048576 },
};

const CONNECTION_TYPES = ['slow-2g', '2g', '3g', '4g', 'unknown'];
const DEVICE_TYPES = ['cpu', 'cuda', 'mps'];
const MAX_USER_AGENT_LENGTH = 300;

/**
 * Returns { values } on success or { error } describing the first bad field.
 * Missing / null fields are stored as NULL (never coerced to 0), because 0 and
 * "not reported" mean different things and would distort averages.
 */
function parseTelemetry(body) {
  const values = {};

  for (const [field, rule] of Object.entries(NUMERIC_FIELDS)) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
      values[field] = null;
      continue;
    }
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num) || num < rule.min || num > rule.max) {
      return { error: `Invalid value for ${field}` };
    }
    if (rule.integer && !Number.isInteger(num)) {
      values[field] = Math.round(num);
    } else {
      values[field] = num;
    }
  }

  const conn = body.effective_connection;
  if (conn === undefined || conn === null || conn === '') {
    values.effective_connection = 'unknown';
  } else if (CONNECTION_TYPES.includes(conn)) {
    values.effective_connection = conn;
  } else {
    return { error: 'Invalid value for effective_connection' };
  }

  const dev = body.device_type;
  if (dev === undefined || dev === null || dev === '') {
    values.device_type = null;
  } else if (DEVICE_TYPES.includes(dev)) {
    values.device_type = dev;
  } else {
    return { error: 'Invalid value for device_type' };
  }

  const ua = body.browser_user_agent;
  if (ua === undefined || ua === null || ua === '') {
    values.browser_user_agent = null;
  } else if (typeof ua === 'string') {
    values.browser_user_agent = ua.slice(0, MAX_USER_AGENT_LENGTH);
  } else {
    return { error: 'Invalid value for browser_user_agent' };
  }

  return { values };
}

async function recordTelemetry(req, res) {
  try {
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    const parsed = parseTelemetry(req.body || {});
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    // Ownership: a patient may only attach telemetry to their own case.
    const owned = await db.query(
      'SELECT case_id FROM screening_cases WHERE case_id = $1 AND patient_id = $2',
      [caseId, req.user.userId]
    );
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: 'Screening case not found' });
    }

    const v = parsed.values;

    // COALESCE(EXCLUDED.x, device_telemetry.x): a value the client did not report
    // (NULL) must never erase a value already stored, such as the server-side timings
    // written by runInference. A value that IS reported still replaces the old one.
    const result = await db.query(
      `INSERT INTO device_telemetry (
        case_id, device_cores, device_memory_gb, client_ram_used_mb,
        effective_connection, client_rtt_ms, audio_processing_ms, browser_user_agent,
        image_preprocess_ms, model_inference_ms, gradcam_generation_ms,
        total_server_time_ms, server_ram_used_mb, gpu_vram_used_mb, device_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (case_id) DO UPDATE SET
        device_cores          = COALESCE(EXCLUDED.device_cores,          device_telemetry.device_cores),
        device_memory_gb      = COALESCE(EXCLUDED.device_memory_gb,      device_telemetry.device_memory_gb),
        client_ram_used_mb    = COALESCE(EXCLUDED.client_ram_used_mb,    device_telemetry.client_ram_used_mb),
        effective_connection  = COALESCE(EXCLUDED.effective_connection,  device_telemetry.effective_connection),
        client_rtt_ms         = COALESCE(EXCLUDED.client_rtt_ms,         device_telemetry.client_rtt_ms),
        audio_processing_ms   = COALESCE(EXCLUDED.audio_processing_ms,   device_telemetry.audio_processing_ms),
        browser_user_agent    = COALESCE(EXCLUDED.browser_user_agent,    device_telemetry.browser_user_agent),
        image_preprocess_ms   = COALESCE(EXCLUDED.image_preprocess_ms,   device_telemetry.image_preprocess_ms),
        model_inference_ms    = COALESCE(EXCLUDED.model_inference_ms,    device_telemetry.model_inference_ms),
        gradcam_generation_ms = COALESCE(EXCLUDED.gradcam_generation_ms, device_telemetry.gradcam_generation_ms),
        total_server_time_ms  = COALESCE(EXCLUDED.total_server_time_ms,  device_telemetry.total_server_time_ms),
        server_ram_used_mb    = COALESCE(EXCLUDED.server_ram_used_mb,    device_telemetry.server_ram_used_mb),
        gpu_vram_used_mb      = COALESCE(EXCLUDED.gpu_vram_used_mb,      device_telemetry.gpu_vram_used_mb),
        device_type           = COALESCE(EXCLUDED.device_type,           device_telemetry.device_type)
      RETURNING telemetry_id, case_id, created_at`,
      [
        caseId,
        v.device_cores,
        v.device_memory_gb,
        v.client_ram_used_mb,
        v.effective_connection,
        v.client_rtt_ms,
        v.audio_processing_ms,
        v.browser_user_agent,
        v.image_preprocess_ms,
        v.model_inference_ms,
        v.gradcam_generation_ms,
        v.total_server_time_ms,
        v.server_ram_used_mb,
        v.gpu_vram_used_mb,
        v.device_type,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('recordTelemetry error:', err);
    res.status(500).json({ error: 'Failed to record device telemetry' });
  }
}

module.exports = { recordTelemetry, parseTelemetry };
