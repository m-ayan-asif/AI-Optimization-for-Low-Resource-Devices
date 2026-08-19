const db = require('../models/db');
const fs = require('fs');
const path = require('path');

// Inference service URL — Python FastAPI running on port 5001
const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:5001';

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
    const { language, additionalText } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Attempt ASR — fall back gracefully if the model isn't loaded yet
    let asr;
    try {
      asr = await callASRService(req.file.path);
    } catch (asrErr) {
      console.warn('ASR unavailable, saving audio without transcript:', asrErr.message);
      asr = {
        transcript_text: null,
        language: language === 'en' ? 'en' : 'ur',
        confidence_score: null,
        keywords: [],
      };
    }

    // Append patient's written note to the ASR transcript when both are provided
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

    await db.query(
      'UPDATE screening_cases SET transcript_id = $1 WHERE case_id = $2',
      [transcriptId, caseId]
    );

    res.json({
      transcript_id: transcriptId,
      transcript_text: finalTranscript,
      keywords: asr.keywords,
      confidence: asr.confidence_score,
      asr_available: asr.transcript_text !== null,
    });
  } catch (err) {
    console.error('Voice submit error:', err);
    res.status(500).json({ error: 'Voice processing failed' });
  }
}

async function submitTextInput(req, res) {
  try {
    const { caseId } = req.params;
    const { text, language } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text provided' });
    }

    // Roman Urdu uses Latin script but is still Urdu — DB constraint allows only 'ur' | 'en'
    const dbLanguage = language === 'en' ? 'en' : 'ur';

    const transcriptResult = await db.query(
      `INSERT INTO voice_transcripts (audio_file_path, transcript_text, language, confidence_score, duration_seconds)
       VALUES ($1, $2, $3, $4, $5) RETURNING transcript_id`,
      [null, text.trim(), dbLanguage, 1.0, null]
    );

    const transcriptId = transcriptResult.rows[0].transcript_id;

    await db.query(
      'UPDATE screening_cases SET transcript_id = $1 WHERE case_id = $2',
      [transcriptId, caseId]
    );

    res.json({
      transcript_id: transcriptId,
      transcript_text: text.trim(),
      keywords: [],
      confidence: 1.0,
      asr_available: false,
    });
  } catch (err) {
    console.error('Text input error:', err);
    res.status(500).json({ error: 'Text submission failed' });
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

  const response = await fetch(`${INFERENCE_URL}/transcribe`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders(),
  });

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[callASRService] Python returned ${response.status}:`, errBody);
    throw new Error(`ASR service returned ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  console.log('[callASRService] Transcript received:', data.transcript_text?.slice(0, 80));
  return data;
}

async function runInference(req, res) {
  try {
    const { caseId } = req.params;

    // Get the image file path for this case
    const caseResult = await db.query(
      `SELECT i.file_path FROM screening_cases sc
       JOIN images i ON sc.image_id = i.image_id
       WHERE sc.case_id = $1`,
      [caseId]
    );

    if (caseResult.rows.length === 0 || !caseResult.rows[0].file_path) {
      return res.status(400).json({ error: 'No image found for this screening case' });
    }

    const imagePath = caseResult.rows[0].file_path;

    // Call Python inference service
    let prediction;
    try {
      prediction = await callInferenceService(imagePath);
    } catch (inferenceErr) {
      console.error('Inference service error:', inferenceErr.message);
      // Fallback to mock if inference service is down
      const { generateMockPrediction } = require('../utils/mockData');
      console.warn('Falling back to mock prediction');
      prediction = generateMockPrediction();
    }

    const predResult = await db.query(
      `INSERT INTO predictions (model_version, top_condition, confidence_score, all_scores, heatmap_path, inference_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING prediction_id`,
      [
        prediction.model_version,
        prediction.top_condition,
        prediction.confidence_score,
        JSON.stringify(prediction.all_scores),
        prediction.heatmap_path,
        prediction.inference_time_ms,
      ]
    );

    await db.query(
      'UPDATE screening_cases SET prediction_id = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id = $2',
      [predResult.rows[0].prediction_id, caseId]
    );

    res.json({
      prediction_id: predResult.rows[0].prediction_id,
      ...prediction,
    });
  } catch (err) {
    console.error('Inference error:', err);
    res.status(500).json({ error: 'Inference failed' });
  }
}

async function callInferenceService(imagePath) {
  const absolutePath = path.resolve(imagePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Image file not found: ${absolutePath}`);
  }

  const FormData = require('form-data');
  const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

  const formData = new FormData();
  formData.append('image', fs.createReadStream(absolutePath));

  const response = await fetch(`${INFERENCE_URL}/predict`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders(),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Inference service returned ${response.status}: ${errBody}`);
  }

  return await response.json();
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

    // Build heatmap URL if available
    let heatmap_url = null;
    if (row.heatmap_path) {
      heatmap_url = `${INFERENCE_URL}/heatmaps/${row.heatmap_path}`;
    }

    res.json({ ...row, symptoms, heatmap_url });
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

module.exports = { createScreening, uploadImage, submitVoice, submitTextInput, runInference, getResults, getHistory };
