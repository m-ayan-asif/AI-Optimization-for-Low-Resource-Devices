jest.mock('../src/models/db', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/rateLimiter', () => ({
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/models/db');

const SECRET = process.env.JWT_SECRET;

function makeToken(overrides = {}) {
  return jwt.sign(
    { userId: 10, username: 'testpatient', role: 'patient', ...overrides },
    SECRET,
    { expiresIn: '1h' }
  );
}

const PATIENT_TOKEN = makeToken();
const CASE_ID = 'test-case-uuid-001';
const MINIMAL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA' +
  'AAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAA' +
  'AAAA/9oADAMBAAIRAxEAPwCwABmX/9k=',
  'base64'
);

// ─── POST /api/screening/create ──────────────────────────────────────────────

describe('POST /api/screening/create', () => {
  it('SUCCESS: creates a new screening case and returns case_id', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, status: 'pending', created_at: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const res = await request(app)
      .post('/api/screening/create')
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('case_id', CASE_ID);
    expect(res.body).toHaveProperty('status', 'pending');
  });

  it('ERROR: returns 401 when request has no auth token', async () => {
    const res = await request(app).post('/api/screening/create');
    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post('/api/screening/create')
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to create screening/i);
  });
});

// ─── POST /api/screening/:caseId/upload-image ────────────────────────────────

describe('POST /api/screening/:caseId/upload-image', () => {
  it('SUCCESS: uploads a JPEG and returns image_id', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ image_id: 42 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .attach('image', MINIMAL_JPEG, { filename: 'skin.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('image_id', 42);
    expect(res.body.message).toMatch(/uploaded/i);
  });

  it('SUCCESS: uploads a PNG file', async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    db.query
      .mockResolvedValueOnce({ rows: [{ image_id: 43 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .attach('image', pngHeader, { filename: 'skin.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('image_id', 43);
  });

  it('ERROR: returns 400 when no file is attached', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image file/i);
  });

  it('ERROR: rejects non-image MIME types (e.g. PDF)', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .attach('image', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });

    // Multer error propagates to the Express error handler → 500
    expect(res.status).toBe(500);
  });

  it('ERROR: returns 401 when request has no auth token', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .attach('image', MINIMAL_JPEG, { filename: 'skin.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws after upload', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .attach('image', MINIMAL_JPEG, { filename: 'skin.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/image upload failed/i);
  });
});

// ─── POST /api/screening/:caseId/voice ───────────────────────────────────────

describe('POST /api/screening/:caseId/voice', () => {
  // Minimal valid WAV: 44-byte header + 1 silent sample
  const silentWav = (() => {
    const buf = Buffer.alloc(46);
    buf.write('RIFF', 0);           buf.writeUInt32LE(38, 4);
    buf.write('WAVE', 8);           buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);      buf.writeUInt16LE(1, 20);   // PCM
    buf.writeUInt16LE(1, 22);       buf.writeUInt32LE(16000, 24); // 16 kHz mono
    buf.writeUInt32LE(32000, 28);   buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);      buf.write('data', 36);
    buf.writeUInt32LE(2, 40);
    return buf;
  })();

  it('SUCCESS: saves transcript with graceful ASR fallback when Python is unreachable', async () => {
    // callASRService will fail (ECONNREFUSED to localhost:5001), fallback activates
    db.query
      .mockResolvedValueOnce({ rows: [{ transcript_id: 7 }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE screening_cases

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('language', 'ur')
      .attach('audio', silentWav, { filename: 'recording.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transcript_id', 7);
    expect(res.body.asr_available).toBe(false); // fallback path
    expect(res.body.transcript_text).toBeNull();
  });

  it('SUCCESS: handles audio/webm;codecs=opus MIME type (Chrome default)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ transcript_id: 8 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('language', 'en')
      .attach('audio', Buffer.from('webm audio data'), { filename: 'recording.webm', contentType: 'audio/webm;codecs=opus' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('transcript_id');
  });

  it('ERROR: returns 400 when no audio file is attached', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .send({ language: 'ur' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no audio file/i);
  });

  it('ERROR: rejects non-audio MIME types (e.g. image/png)', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .attach('audio', Buffer.from('fake png'), { filename: 'bad.png', contentType: 'image/png' });

    expect(res.status).toBe(500); // multer rejects → error handler
  });

  it('ERROR: returns 401 with no auth token', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .field('language', 'ur')
      .attach('audio', silentWav, { filename: 'recording.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws after ASR fallback', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('language', 'ur')
      .attach('audio', silentWav, { filename: 'recording.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/voice processing failed/i);
  });
});

// ─── POST /api/screening/:caseId/inference ───────────────────────────────────

describe('POST /api/screening/:caseId/inference', () => {
  it('SUCCESS: falls back to mock prediction when image file path does not exist on disk', async () => {
    // DB returns a path that does not exist → callInferenceService throws → mock prediction used
    db.query
      .mockResolvedValueOnce({ rows: [{ file_path: '/nonexistent/test_image.jpg' }] })
      .mockResolvedValueOnce({ rows: [{ prediction_id: 55 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/inference`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('prediction_id', 55);
    expect(res.body).toHaveProperty('top_condition');
    expect(res.body).toHaveProperty('confidence_score');
    expect(res.body.model_version).toMatch(/mock/i);
  });

  it('ERROR: returns 400 when no image is linked to the case', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // no case/image found

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/inference`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image found/i);
  });

  it('ERROR: returns 400 when the case row exists but image_id is null', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_path: null }] });

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/inference`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image found/i);
  });

  it('ERROR: returns 401 with no auth token', async () => {
    const res = await request(app).post(`/api/screening/${CASE_ID}/inference`);
    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/inference`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/inference failed/i);
  });
});

// ─── GET /api/screening/:caseId/results ─────────────────────────────────────

describe('GET /api/screening/:caseId/results', () => {
  const mockRow = {
    case_id: CASE_ID,
    patient_id: 10,
    status: 'pending',
    transcript_id: null,
    heatmap_path: null,
    top_condition: 'Eczema',
    confidence_score: 0.87,
    transcript_text: null,
  };

  it('SUCCESS: returns case results with prediction data', async () => {
    db.query.mockResolvedValueOnce({ rows: [mockRow] });

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('top_condition', 'Eczema');
    expect(res.body).toHaveProperty('confidence_score', 0.87);
    expect(res.body.symptoms).toEqual([]);
  });

  it('SUCCESS: returns heatmap_url when heatmap_path is set', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...mockRow, heatmap_path: 'abc123.png' }] });

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.heatmap_url).toContain('abc123.png');
  });

  it('SUCCESS: fetches extracted symptoms when transcript_id is present', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...mockRow, transcript_id: 3, transcript_text: 'itching' }] })
      .mockResolvedValueOnce({ rows: [{ keyword: 'itching', confidence: 0.9 }] });

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.symptoms).toEqual([{ keyword: 'itching', confidence: 0.9 }]);
  });

  it('ERROR: returns 404 when the case does not exist or belongs to another patient', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/screening/nonexistent-case/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('ERROR: returns 401 with no auth token', async () => {
    const res = await request(app).get(`/api/screening/${CASE_ID}/results`);
    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch results/i);
  });
});

// ─── GET /api/screening/history/list ────────────────────────────────────────

describe('GET /api/screening/history/list', () => {
  it('SUCCESS: returns an array of cases for the authenticated patient', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { case_id: 'c1', status: 'pending', created_at: '2025-01-01', top_condition: 'Eczema', confidence_score: 0.8 },
        { case_id: 'c2', status: 'reviewed', created_at: '2025-01-02', top_condition: 'Psoriasis', confidence_score: 0.75 },
      ],
    });

    const res = await request(app)
      .get('/api/screening/history/list')
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('case_id', 'c1');
  });

  it('SUCCESS: returns an empty array when the patient has no cases', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/screening/history/list')
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('ERROR: returns 401 with no auth token', async () => {
    const res = await request(app).get('/api/screening/history/list');
    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .get('/api/screening/history/list')
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch history/i);
  });
});
