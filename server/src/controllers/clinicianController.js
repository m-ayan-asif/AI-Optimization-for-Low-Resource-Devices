const db = require('../models/db');

const INFERENCE_URL = process.env.INFERENCE_URL || 'http://localhost:5001';

async function getCases(req, res) {
  try {
    const { status } = req.query;

    let query = `
      SELECT sc.case_id, sc.status, sc.created_at, sc.updated_at,
             u.username AS patient_username,
             p.top_condition, p.confidence_score,
             cf.decision
      FROM screening_cases sc
      JOIN patient_profiles pp ON sc.patient_id = pp.patient_id
      JOIN users u ON pp.patient_id = u.user_id
      LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
      LEFT JOIN clinician_feedback cf ON cf.case_id = sc.case_id
    `;

    const params = [];
    if (status) {
      query += ' WHERE sc.status = $1';
      params.push(status);
    }

    query += ' ORDER BY sc.created_at DESC LIMIT 100';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('getCases error:', err);
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
}

async function getCaseDetail(req, res) {
  try {
    const { caseId } = req.params;

    const caseResult = await db.query(
      `SELECT sc.*,
              u.username AS patient_username,
              pp.age, pp.gender, pp.region,
              i.file_path AS image_file_path,
              p.top_condition, p.confidence_score, p.all_scores, p.heatmap_path,
              p.inference_time_ms, p.model_version,
              vt.transcript_text, vt.language AS transcript_language,
              cf.decision, cf.corrected_diagnosis, cf.notes AS feedback_notes,
              cf.created_at AS feedback_at,
              cu.username AS reviewer_username
       FROM screening_cases sc
       JOIN patient_profiles pp ON sc.patient_id = pp.patient_id
       JOIN users u ON pp.patient_id = u.user_id
       LEFT JOIN images i ON sc.image_id = i.image_id
       LEFT JOIN predictions p ON sc.prediction_id = p.prediction_id
       LEFT JOIN voice_transcripts vt ON sc.transcript_id = vt.transcript_id
       LEFT JOIN clinician_feedback cf ON cf.case_id = sc.case_id
       LEFT JOIN users cu ON cf.clinician_id = cu.user_id
       WHERE sc.case_id = $1`,
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
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

    // Audit: clinician viewed this case
    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [req.user.userId, 'clinician_view_case', 'screening_case', caseId]
    );

    res.json({ ...row, symptoms, heatmap_url });
  } catch (err) {
    console.error('getCaseDetail error:', err);
    res.status(500).json({ error: 'Failed to fetch case details' });
  }
}

async function submitFeedback(req, res) {
  try {
    const { caseId } = req.params;
    const clinicianId = req.user.userId;
    const { decision, corrected_diagnosis, notes } = req.body;

    if (!decision || !['accept', 'dispute', 'correct'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision. Must be accept, dispute, or correct.' });
    }

    if (decision === 'correct' && !corrected_diagnosis?.trim()) {
      return res.status(400).json({ error: 'corrected_diagnosis is required when decision is correct.' });
    }

    const caseCheck = await db.query(
      'SELECT case_id FROM screening_cases WHERE case_id = $1',
      [caseId]
    );
    if (caseCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }

    // Check for existing feedback on this case
    const existing = await db.query(
      'SELECT feedback_id FROM clinician_feedback WHERE case_id = $1',
      [caseId]
    );

    if (existing.rows.length > 0) {
      await db.query(
        `UPDATE clinician_feedback
         SET clinician_id = $1, decision = $2, corrected_diagnosis = $3, notes = $4, created_at = CURRENT_TIMESTAMP
         WHERE case_id = $5`,
        [clinicianId, decision, corrected_diagnosis?.trim() || null, notes?.trim() || null, caseId]
      );
    } else {
      await db.query(
        `INSERT INTO clinician_feedback (case_id, clinician_id, decision, corrected_diagnosis, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [caseId, clinicianId, decision, corrected_diagnosis?.trim() || null, notes?.trim() || null]
      );
    }

    // Mark case as reviewed
    await db.query(
      'UPDATE screening_cases SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE case_id = $2',
      ['reviewed', caseId]
    );

    // Audit log
    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [clinicianId, `clinician_${decision}`, 'screening_case', caseId]
    );

    res.json({ success: true, message: 'Feedback submitted successfully.' });
  } catch (err) {
    console.error('submitFeedback error:', err);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
}

async function getStats(req, res) {
  try {
    const clinicianId = req.user.userId;

    const totalResult = await db.query(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int AS pending_count,
        COUNT(CASE WHEN status = 'reviewed' THEN 1 END)::int AS reviewed_count,
        COUNT(*)::int AS total_count
      FROM screening_cases
    `);

    const feedbackResult = await db.query(`
      SELECT
        COUNT(CASE WHEN decision = 'accept' THEN 1 END)::int AS accepted,
        COUNT(CASE WHEN decision = 'dispute' THEN 1 END)::int AS disputed,
        COUNT(CASE WHEN decision = 'correct' THEN 1 END)::int AS corrected,
        COUNT(*)::int AS total_reviewed
      FROM clinician_feedback
      WHERE clinician_id = $1
    `, [clinicianId]);

    res.json({
      ...totalResult.rows[0],
      my_feedback: feedbackResult.rows[0],
    });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

module.exports = { getCases, getCaseDetail, submitFeedback, getStats };
