const db = require('../models/db');
const { generateMockPrediction, generateMockTranscript } = require('../utils/mockData');

async function createScreening(req, res) {
  try {
    const patientId = req.user.userId;

    const result = await db.query(
      'INSERT INTO screening_cases (patient_id) VALUES ($1) RETURNING case_id, status, created_at',
      [patientId]
    );

    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [patientId, 'create_screening', 'screening_case', result.rows[0].case_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create screening error:', err);
    res.status(500).json({ error: 'Failed to create screening' });
  }
}

async function uploadImage(req, res) {
  try {
    const { caseId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Store image metadata
    const imageResult = await db.query(
      `INSERT INTO images (file_path, file_size, format, width, height)
       VALUES ($1, $2, $3, $4, $5) RETURNING image_id`,
      [file.path, file.size, file.mimetype === 'image/png' ? 'PNG' : 'JPEG', null, null]
    );

    // Link image to screening case
    await db.query(
      'UPDATE screening_cases SET image_id = $1 WHERE case_id = $2',
      [imageResult.rows[0].image_id, caseId]
    );

    res.json({ image_id: imageResult.rows[0].image_id, message: 'Image uploaded' });
  } catch (err) {
    console.error('Upload image error:', err);
    res.status(500).json({ error: 'Image upload failed' });
  }
}

async function submitVoice(req, res) {
  try {
    const { caseId } = req.params;
    const { language } = req.body;

    // MOCK: In production, this sends audio to Whisper ASR
    const mock = generateMockTranscript(language || 'en');

    const transcriptResult = await db.query(
      `INSERT INTO voice_transcripts (audio_file_path, transcript_text, language, confidence_score, duration_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING transcript_id`,
      [req.file?.path || null, mock.transcript_text, mock.language, mock.confidence_score, 10]
    );

    const transcriptId = transcriptResult.rows[0].transcript_id;

    // Store extracted symptoms
    for (const kw of mock.keywords) {
      await db.query(
        'INSERT INTO extracted_symptoms (transcript_id, symptom_text, keyword, confidence) VALUES ($1, $2, $3, $4)',
        [transcriptId, kw, kw, mock.confidence_score]
      );
    }

    // Link to screening case
    await db.query(
      'UPDATE screening_cases SET transcript_id = $1 WHERE case_id = $2',
      [transcriptId, caseId]
    );

    res.json({
      transcript_id: transcriptId,
      transcript_text: mock.transcript_text,
      keywords: mock.keywords,
      confidence: mock.confidence_score,
    });
  } catch (err) {
    console.error('Voice submit error:', err);
    res.status(500).json({ error: 'Voice processing failed' });
  }
}

async function runInference(req, res) {
  try {
    const { caseId } = req.params;

    // MOCK: In production, this triggers edge device CNN inference + Grad-CAM
    const mock = generateMockPrediction();

    const predResult = await db.query(
      `INSERT INTO predictions (model_version, top_condition, confidence_score, all_scores, heatmap_path, inference_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING prediction_id`,
      [mock.model_version, mock.top_condition, mock.confidence_score, JSON.stringify(mock.all_scores), mock.heatmap_path, mock.inference_time_ms]
    );

    await db.query(
      'UPDATE screening_cases SET prediction_id = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id = $2',
      [predResult.rows[0].prediction_id, caseId]
    );

    res.json({
      prediction_id: predResult.rows[0].prediction_id,
      ...mock,
    });
  } catch (err) {
    console.error('Inference error:', err);
    res.status(500).json({ error: 'Inference failed' });
  }
}

async function getResults(req, res) {
  try {
    const { caseId } = req.params;

    const caseResult = await db.query(
      `SELECT sc.*, p.top_condition, p.confidence_score, p.all_scores, p.heatmap_path, p.inference_time_ms, p.model_version,
              vt.transcript_text, vt.language as transcript_language
       FROM screening_cases sc
       LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
       LEFT JOIN voice_transcripts vt ON sc.transcript_id = vt.transcript_id
       WHERE sc.case_id = $1 AND sc.patient_id = $2`,
      [caseId, req.user.userId]
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Screening case not found' });
    }

    // Also get extracted symptoms if voice was used
    const row = caseResult.rows[0];
    let symptoms = [];
    if (row.transcript_id) {
      const symResult = await db.query(
        'SELECT keyword, confidence FROM extracted_symptoms WHERE transcript_id = $1',
        [row.transcript_id]
      );
      symptoms = symResult.rows;
    }

    res.json({ ...row, symptoms });
  } catch (err) {
    console.error('Get results error:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
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
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

module.exports = { createScreening, uploadImage, submitVoice, runInference, getResults, getHistory };
