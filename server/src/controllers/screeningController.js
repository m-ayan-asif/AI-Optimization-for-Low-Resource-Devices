const db = require('../models/db');
const fs = require('fs');
const path = require('path');

const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:5001';
const INFERENCE_TIMEOUT_MS = parseInt(process.env.INFERENCE_TIMEOUT_MS, 10) || 12000;
const MAX_INFERENCE_RETRIES = 2;

// ── Helper: verifyCaseOwnership without breaking non-integer test IDs (e.g. 'c1') ──
async function verifyCaseOwnership(caseId, patientId) {
  if (!caseId || typeof caseId !== 'string' || !caseId.trim()) {
    const err = new Error('Invalid case identifier');
    err.status = 400;
    err.code = 'INVALID_CASE_ID';
    throw err;
  }

  // Cast both sides to text to support UUIDs, integers, and test strings ('c1')
  const result = await db.query(
    'SELECT case_id, patient_id, image_id, transcript_id, prediction_id, status FROM screening_cases WHERE case_id::text = $1::text',
    [caseId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Screening case not found');
    err.status = 404;
    err.code = 'CASE_NOT_FOUND';
    throw err;
  }

  if (patientId && result.rows[0].patient_id !== patientId) {
    const err = new Error('Unauthorized access to screening case');
    err.status = 403;
    err.code = 'UNAUTHORIZED_ACCESS';
    throw err;
  }

  return result.rows[0];
}

function validatePredictionShape(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.top_condition !== 'string' || !data.top_condition) return false;
  if (typeof data.confidence_score !== 'number' || isNaN(data.confidence_score)) return false;
  if (data.confidence_score < 0 || data.confidence_score > 1) return false;
  if (!data.all_scores || typeof data.all_scores !== 'object') return false;
  return true;
}

// ── Screening Endpoints ─────────────────────────────────────────────────

async function createScreening(req, res) {
  try {
    const patientId = req.user.userId;

    const result = await db.query(
      'INSERT INTO screening_cases (patient_id, status) VALUES ($1, $2) RETURNING case_id, status, created_at',
      [patientId, 'pending']
    );

    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [patientId, 'create_screening', 'screening_case', result.rows[0].case_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create screening error:', err);
    res.status(500).json({ error: 'Failed to create screening', code: 'DB_ERROR' });
  }
}

async function uploadImage(req, res) {
  try {
    const { caseId } = req.params;
    const file = req.file;

    // Check file presence before DB checks so standard upload error responses match tests
    if (!file) {
      return res.status(400).json({ error: 'No image file provided', code: 'EMPTY_FILE' });
    }

    const imageResult = await db.query(
      `INSERT INTO images (file_path, file_size, format, width, height)
       VALUES ($1, $2, $3, $4, $5) RETURNING image_id`,
      [file.path, file.size, file.mimetype === 'image/png' ? 'PNG' : 'JPEG', null, null]
    );

    await db.query('UPDATE screening_cases SET image_id = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id::text = $2::text', [
      imageResult.rows[0].image_id,
      caseId,
    ]);

    res.json({ image_id: imageResult.rows[0].image_id, message: 'Image uploaded' });
  } catch (err) {
    console.error('Upload image error:', err);
    res.status(500).json({ error: 'Image upload failed', code: 'UPLOAD_ERROR' });
  }
}

async function submitVoice(req, res) {
  try {
    const { caseId } = req.params;
    const { language, additionalText } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided', code: 'EMPTY_AUDIO' });
    }

    let asr;
    try {
      asr = await callASRService(req.file.path);
    } catch (asrErr) {
      console.warn('ASR service unavailable, storing audio without transcript:', asrErr.message);
      asr = {
        transcript_text: null,
        language: language === 'en' ? 'en' : 'ur',
        confidence_score: null,
        keywords: [],
        asr_compute_ms: null,
      };
    }

    let finalTranscript = asr.transcript_text;
    if (additionalText && additionalText.trim()) {
      finalTranscript = finalTranscript
        ? `${finalTranscript}\n\n[Written note: ${additionalText.trim()}]`
        : additionalText.trim();
    }

    const transcriptResult = await db.query(
      `INSERT INTO voice_transcripts (audio_file_path, transcript_text, language, confidence_score, duration_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING transcript_id`,
      [req.file.path, finalTranscript, asr.language, asr.confidence_score, null]
    );

    const transcriptId = transcriptResult.rows[0].transcript_id;

    for (const kw of asr.keywords) {
      await db.query(
        'INSERT INTO extracted_symptoms (transcript_id, symptom_text, keyword, confidence) VALUES ($1, $2, $3, $4)',
        [transcriptId, kw, kw, asr.confidence_score]
      );
    }

    await db.query('UPDATE screening_cases SET transcript_id = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id::text = $2::text', [
      transcriptId,
      caseId,
    ]);

    res.json({
      transcript_id: transcriptId,
      transcript_text: finalTranscript,
      keywords: asr.keywords,
      confidence: asr.confidence_score,
      asr_available: asr.transcript_text !== null,
    });
  } catch (err) {
    console.error('Voice submit error:', err);
    res.status(500).json({ error: 'Voice processing failed', code: 'VOICE_ERROR' });
  }
}

async function submitTextInput(req, res) {
  try {
    const { caseId } = req.params;
    const { text, language } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided', code: 'EMPTY_TEXT' });
    }

    const dbLanguage = language === 'en' ? 'en' : 'ur';

    const transcriptResult = await db.query(
      `INSERT INTO voice_transcripts (audio_file_path, transcript_text, language, confidence_score, duration_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING transcript_id`,
      [null, text.trim(), dbLanguage, 1.0, null]
    );

    const transcriptId = transcriptResult.rows[0].transcript_id;

    await db.query('UPDATE screening_cases SET transcript_id = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id::text = $2::text', [
      transcriptId,
      caseId,
    ]);

    res.json({
      transcript_id: transcriptId,
      transcript_text: text.trim(),
      keywords: [],
      confidence: 1.0,
      asr_available: false,
    });
  } catch (err) {
    console.error('Text input error:', err);
    res.status(500).json({ error: 'Text submission failed', code: 'TEXT_ERROR' });
  }
}

async function runInference(req, res) {
  try {
    const { caseId } = req.params;

    const caseResult = await db.query(
      `SELECT i.file_path FROM screening_cases sc
       JOIN images i ON sc.image_id = i.image_id
       WHERE sc.case_id::text = $1::text`,
      [caseId]
    );

    if (caseResult.rows.length === 0 || !caseResult.rows[0].file_path) {
      return res.status(400).json({ error: 'No image found for this screening case', code: 'IMAGE_MISSING' });
    }

    const imagePath = caseResult.rows[0].file_path;
    let prediction;
    let isMock = false;

    try {
      prediction = await callInferenceWithRetry(imagePath, MAX_INFERENCE_RETRIES);
    } catch (inferenceErr) {
      if (inferenceErr.status === 400 || inferenceErr.status === 413) {
        return res.status(inferenceErr.status).json({
          error: inferenceErr.message,
          code: inferenceErr.code || 'VALIDATION_FAILED'
        });
      }

      console.warn('Inference microservice failed, applying graceful mock fallback:', inferenceErr.message);
      const { generateMockPrediction } = require('../utils/mockData');
      prediction = generateMockPrediction();
      isMock = true;
    }

    if (!validatePredictionShape(prediction)) {
      const { generateMockPrediction } = require('../utils/mockData');
      prediction = generateMockPrediction();
      isMock = true;
    }

    const predResult = await db.query(
      `INSERT INTO predictions (model_version, top_condition, confidence_score, all_scores, heatmap_path, inference_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING prediction_id`,
      [
        prediction.model_version || (isMock ? 'v0.1.0-mock' : 'mobilenetv3-large-distilled-v1'),
        prediction.top_condition,
        prediction.confidence_score,
        JSON.stringify(prediction.all_scores),
        prediction.heatmap_path || null,
        prediction.inference_time_ms || 0,
      ]
    );

    const predictionId = predResult.rows[0].prediction_id;

    // Direct telemetry write if telemetry table exists
    const telemetry = prediction.telemetry || {};
    try {
      await db.query(
        `INSERT INTO device_telemetry (
           case_id,
           image_preprocess_ms,
           model_inference_ms,
           gradcam_generation_ms,
           total_server_time_ms,
           server_ram_used_mb,
           gpu_vram_used_mb,
           device_type,
           blur_score,
           entropy,
           confidence_margin
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (case_id) DO UPDATE SET
           image_preprocess_ms = EXCLUDED.image_preprocess_ms,
           model_inference_ms = EXCLUDED.model_inference_ms,
           gradcam_generation_ms = EXCLUDED.gradcam_generation_ms,
           total_server_time_ms = EXCLUDED.total_server_time_ms,
           server_ram_used_mb = EXCLUDED.server_ram_used_mb,
           gpu_vram_used_mb = EXCLUDED.gpu_vram_used_mb,
           device_type = EXCLUDED.device_type,
           blur_score = EXCLUDED.blur_score,
           entropy = EXCLUDED.entropy,
           confidence_margin = EXCLUDED.confidence_margin`,
        [
          caseId,
          telemetry.image_preprocess_ms ?? null,
          telemetry.model_inference_ms ?? prediction.inference_time_ms ?? null,
          telemetry.gradcam_generation_ms ?? null,
          telemetry.total_server_time_ms ?? null,
          telemetry.server_ram_used_mb ?? null,
          telemetry.gpu_vram_used_mb ?? null,
          telemetry.device_type ?? 'cpu',
          telemetry.blur_score ?? null,
          telemetry.entropy ?? null,
          telemetry.confidence_margin ?? null
        ]
      );
    } catch (_) {
      // Non-fatal if telemetry table mock is unconfigured
    }

    await db.query(
      'UPDATE screening_cases SET prediction_id = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id::text = $2::text',
      [predictionId, caseId]
    );

    res.json({
      prediction_id: predictionId,
      ...prediction,
      is_mock: isMock
    });
  } catch (err) {
    console.error('Inference error:', err);
    res.status(500).json({ error: 'Inference failed', code: 'INFERENCE_FAILURE' });
  }
}

async function callInferenceWithRetry(imagePath, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await callInferenceService(imagePath);
    } catch (err) {
      if (err.status === 400 || err.status === 413) {
        throw err;
      }
      attempt++;
      if (attempt > maxRetries) throw err;
      await new Promise((res) => setTimeout(res, attempt * 300));
    }
  }
}

async function callInferenceService(imagePath) {
  const absolutePath = path.resolve(imagePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Image file not found: ${absolutePath}`);
  }

  const FormData = require('form-data');
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

  const formData = new FormData();
  formData.append('image', fs.createReadStream(absolutePath));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

  try {
    const response = await fetch(`${INFERENCE_URL}/predict`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      let parsed = {};
      try { parsed = JSON.parse(errBody); } catch (_) {}
      const err = new Error(parsed.error || parsed.detail || errBody || 'Inference service error');
      err.status = response.status;
      err.code = parsed.code || (response.status === 413 ? 'FILE_TOO_LARGE' : 'INFERENCE_ERROR');
      throw err;
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('Inference request timed out');
      timeoutErr.status = 504;
      timeoutErr.code = 'INFERENCE_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callASRService(audioPath) {
  const absolutePath = path.resolve(audioPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Audio file not found: ${absolutePath}`);
  }

  const FormData = require('form-data');
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

  const formData = new FormData();
  formData.append('audio', fs.createReadStream(absolutePath));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${INFERENCE_URL}/transcribe`, {
      method: 'POST',
      body: formData,
      headers: formData.getHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`ASR service returned ${response.status}: ${errBody}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getResults(req, res) {
  try {
    const { caseId } = req.params;

    const caseResult = await db.query(
      `SELECT sc.*, p.top_condition, p.confidence_score, p.all_scores, p.heatmap_path, p.inference_time_ms, p.model_version,
              vt.transcript_text, vt.language as transcript_language,
              cf.decision as clinician_decision, cf.corrected_diagnosis, cf.notes as clinician_notes,
              cf.created_at as reviewed_at, cu.username as reviewer_username
       FROM screening_cases sc
       LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
       LEFT JOIN voice_transcripts vt ON sc.transcript_id = vt.transcript_id
       LEFT JOIN clinician_feedback cf ON cf.case_id = sc.case_id
       LEFT JOIN users cu ON cf.clinician_id = cu.user_id
       WHERE sc.case_id::text = $1::text AND sc.patient_id = $2`,
      [caseId, req.user.userId]
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Screening case not found', code: 'CASE_NOT_FOUND' });
    }

    const row = caseResult.rows[0];
    let symptoms = [];
    if (row.transcript_id) {
      const symResult = await db.query(
        'SELECT keyword, confidence FROM extracted_symptoms WHERE transcript_id = $1',
        [row.transcript_id]
      );
      symptoms = symResult.rows;
    }

    let heatmap_url = null;
    if (row.heatmap_path) {
      heatmap_url = `${INFERENCE_URL}/heatmaps/${row.heatmap_path}`;
    }

    const isMock = Boolean(
      row.model_version?.includes('mock') ||
      row.model_version?.includes('UNTRAINED')
    );

    res.json({ ...row, symptoms, heatmap_url, is_mock: isMock });
  } catch (err) {
    console.error('Get results error:', err);
    res.status(500).json({ error: 'Failed to fetch results', code: 'RESULTS_ERROR' });
  }
}

async function getHistory(req, res) {
  try {
    const patientId = req.user.userId;

    const result = await db.query(
      `SELECT sc.case_id, sc.status, sc.created_at, p.top_condition, p.confidence_score
       FROM screening_cases sc
       LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
       WHERE sc.patient_id = $1
       ORDER BY sc.created_at DESC
       LIMIT 50`,
      [patientId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to fetch history', code: 'HISTORY_ERROR' });
  }
}

module.exports = {
  createScreening,
  uploadImage,
  submitVoice,
  submitTextInput,
  runInference,
  getResults,
  getHistory,
};
