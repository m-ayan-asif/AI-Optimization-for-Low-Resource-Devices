/**
 * Integration tests for /api/screening routes.
 *
 * Mocking strategy:
 *  - db.query       → jest.fn() controls all database responses per-test.
 *  - rateLimiter    → passthrough no-ops (not under test).
 *  - Python inference service (localhost:5001) → NOT mocked deliberately.
 *    Tests that would normally call the Python service instead rely on the
 *    natural ECONNREFUSED to trigger the Express fallback path. This validates
 *    the graceful-degradation behaviour without needing a running Python server.
 *
 * Fixtures:
 *  - MINIMAL_JPEG   → a real 1×1 pixel JPEG in base64; multer's MIME filter
 *                     requires a legitimate content-type header AND buffer.
 *  - silentWav      → a hand-crafted 44-byte WAV header with one silent sample;
 *                     enough to satisfy the audio multer filter.
 */

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

// A structurally valid 1×1 JPEG (base64-encoded). Using a real JPEG byte sequence
// ensures multer's file-type check passes — a random buffer would be rejected.
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
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: null }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ image_id: 42 }] }) // insert image
      .mockResolvedValueOnce({ rows: [] }); // update case

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
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: null }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ image_id: 43 }] }) // insert image
      .mockResolvedValueOnce({ rows: [] }); // update case

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

  it('ERROR: returns 403 when trying to upload image to another patient case', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 999 }] }); // different patient

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/upload-image`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .attach('image', MINIMAL_JPEG, { filename: 'skin.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('ERROR: returns 500 when the database throws after upload', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockRejectedValueOnce(new Error('DB error')); // insert image throws

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
  // Hand-crafted RIFF/WAV buffer: 44-byte header + 1 silent 16-bit sample.
  // Built inline so the test file has no external binary fixture dependency.
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
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ transcript_id: 7 }] }) // insert transcript
      .mockResolvedValueOnce({ rows: [] }); // update case

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
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ transcript_id: 8 }] }) // insert transcript
      .mockResolvedValueOnce({ rows: [] }); // update case

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

    // multer's fileFilter throws a MulterError; the Express error handler converts it to 500.
    expect(res.status).toBe(500);
  });

  it('ERROR: returns 401 with no auth token', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .field('language', 'ur')
      .attach('audio', silentWav, { filename: 'recording.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 403 when submitting voice to another patient case', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 999 }] }); // different patient

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('language', 'ur')
      .attach('audio', silentWav, { filename: 'recording.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('ERROR: returns 500 when the database throws after ASR fallback', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockRejectedValueOnce(new Error('DB error')); // insert throws

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
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: 1 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ file_path: '/nonexistent/test_image.jpg' }] }) // image lookup
      .mockResolvedValueOnce({ rows: [{ prediction_id: 55 }] }) // insert prediction
      .mockResolvedValueOnce({ rows: [] }) // device telemetry insert
      .mockResolvedValueOnce({ rows: [] }); // update case

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
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: null }] }) // ownership check
      .mockResolvedValueOnce({ rows: [] }); // join with images yields no rows

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/inference`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image found/i);
  });

  it('ERROR: returns 400 when the case row exists but image_id is null', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: null }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ file_path: null }] }); // image lookup has null file_path

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

  it('ERROR: returns 403 when running inference on another patient case', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 999 }] }); // different patient

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/inference`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: 1 }] }) // ownership check
      .mockRejectedValueOnce(new Error('DB error')); // image lookup throws

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
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [mockRow] }); // case results query

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('top_condition', 'Eczema');
    expect(res.body).toHaveProperty('confidence_score', 0.87);
    expect(res.body.symptoms).toEqual([]);
  });

  it('SUCCESS: returns heatmap_url when heatmap_path is set', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ ...mockRow, heatmap_path: 'abc123.png' }] }); // case results

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('heatmap_url');
    expect(res.body.heatmap_url).toContain('abc123.png');
  });

  it('SUCCESS: fetches extracted symptoms when transcript_id is present', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ ...mockRow, transcript_id: 3, transcript_text: 'itching' }] }) // case results
      .mockResolvedValueOnce({ rows: [{ keyword: 'itching', confidence: 0.9 }] }); // symptoms query

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.symptoms).toEqual([{ keyword: 'itching', confidence: 0.9 }]);
  });

  it('ERROR: returns 404 when the case does not exist or belongs to another patient', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // case not found

    const res = await request(app)
      .get(`/api/screening/nonexistent-case/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('ERROR: returns 403 when accessing another patient results', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 999 }] }); // different patient

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/unauthorized/i);
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

// ─── On-device (PWA) results ─────────────────────────────────────────────────

describe('POST /api/screening/:caseId/device-result', () => {
  const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const validPrediction = {
    model_version: 'mobilenetv3-large-dualkd-clean320-v2-onnx',
    top_condition: 'Vitiligo',
    confidence_score: 0.83,
    status: 'classified',
    all_scores: { Vitiligo: 0.83, Eczema: 0.17 },
    inference_time_ms: 412,
    telemetry: { device_type: 'browser-wasm', model_inference_ms: 300 },
  };

  it('SUCCESS: stores an on-device prediction with its heatmap', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ prediction_id: 77 }] }) // insert prediction
      .mockResolvedValueOnce({ rows: [] }) // telemetry
      .mockResolvedValueOnce({ rows: [] }); // update case

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/device-result`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('prediction', JSON.stringify(validPrediction))
      .attach('heatmap', PNG_1X1, { filename: 'heatmap.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('prediction_id', 77);
    expect(res.body.is_mock).toBe(false);
    expect(res.body.heatmap_path).toMatch(/^device\/[0-9a-f-]{36}\.png$/);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO predictions'));
    expect(insert[1][0]).toBe(validPrediction.model_version);

    // The uploaded overlay is served without auth (an <img> cannot send the token) under an unguessable name
    const file = res.body.heatmap_path.slice('device/'.length);
    const img = await request(app).get(`/api/device-heatmaps/${file}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toMatch(/image\/png/);
  });

  it('ERROR: rejects a prediction that does not come from the on-device model', async () => {
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/device-result`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('prediction', JSON.stringify({ ...validPrediction, model_version: 'v0.1.0-mock' }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PREDICTION');
  });

  it('ERROR: rejects a model_version longer than the 50-character column instead of failing the insert', async () => {
    // 51 characters: the name the not-a-lesion phone model first shipped with; every upload then failed with a 500
    const tooLong = 'mobilenetv3-large-dualkd-clean320-notlesion-v4-onnx';
    expect(tooLong).toHaveLength(51);
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/device-result`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('prediction', JSON.stringify({ ...validPrediction, model_version: tooLong }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PREDICTION');
  });

  it('ERROR: rejects out-of-range scores and malformed JSON', async () => {
    const bad = await request(app)
      .post(`/api/screening/${CASE_ID}/device-result`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('prediction', JSON.stringify({ ...validPrediction, all_scores: { Vitiligo: 7 } }));
    expect(bad.status).toBe(400);

    const junk = await request(app)
      .post(`/api/screening/${CASE_ID}/device-result`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('prediction', '{not json');
    expect(junk.status).toBe(400);
  });

  it('ERROR: returns 403 for another patient case', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 999 }] });
    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/device-result`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('prediction', JSON.stringify(validPrediction));
    expect(res.status).toBe(403);
  });

  it('ERROR: returns 401 with no auth token', async () => {
    const res = await request(app).post(`/api/screening/${CASE_ID}/device-result`);
    expect(res.status).toBe(401);
  });

  it('ERROR: unknown device heatmap returns 404', async () => {
    const res = await request(app).get('/api/device-heatmaps/00000000-0000-0000-0000-000000000000.png');
    expect(res.status).toBe(404);
  });
});

describe('On-device transcripts and heatmap links', () => {
  it('SUCCESS: /voice keeps a transcript produced on the device instead of calling ASR', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ transcript_id: 9 }] }) // insert transcript
      .mockResolvedValueOnce({ rows: [] }); // update case

    const res = await request(app)
      .post(`/api/screening/${CASE_ID}/voice`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`)
      .field('language', 'ur')
      .field('deviceTranscript', 'مجھے خارش ہو رہی ہے')
      .attach('audio', Buffer.from('RIFF....WAVE'), { filename: 'recording.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(200);
    expect(res.body.transcript_text).toBe('مجھے خارش ہو رہی ہے');
    expect(res.body.asr_available).toBe(true);
  });

  it('SUCCESS: results link a device heatmap through the API, not the inference service', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, transcript_id: null, heatmap_path: 'device/abc.png' }] });

    const res = await request(app)
      .get(`/api/screening/${CASE_ID}/results`)
      .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.heatmap_url).toBe('/api/device-heatmaps/abc.png');
  });
});

describe('Production inference failure', () => {
  it('returns 503 instead of a mock prediction when NODE_ENV=production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      let prodApp;
      let prodDb;
      jest.isolateModules(() => {
        prodApp = require('../src/app');
        prodDb = require('../src/models/db');
      });
      prodDb.query
        .mockResolvedValueOnce({ rows: [{ case_id: CASE_ID, patient_id: 10, image_id: 1 }] }) // ownership
        .mockResolvedValueOnce({ rows: [{ file_path: '/nonexistent/test_image.jpg' }] }); // image lookup

      const res = await request(prodApp)
        .post(`/api/screening/${CASE_ID}/inference`)
        .set('Authorization', `Bearer ${PATIENT_TOKEN}`);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('INFERENCE_UNAVAILABLE');
      expect(prodDb.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO predictions'))).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
