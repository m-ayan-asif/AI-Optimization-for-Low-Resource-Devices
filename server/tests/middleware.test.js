/**
 * Unit-level tests for Express middleware: authenticate, requireRole, and the
 * two multer upload instances (imageUpload / audioUpload).
 *
 * Why a minimal test app instead of the real app?
 *  - Isolates middleware behaviour from route-level logic.
 *  - Avoids setting up a full DB-backed route tree just to test a header check.
 *  - `buildTestApp(role)` creates a single /probe route guarded only by the
 *    middleware under test; the route echoes req.user so we can assert on it.
 *  - `buildUploadApp(multerMiddleware)` wraps one multer instance with a generic
 *    error handler so MIME-rejection errors surface as 500 in tests.
 */

jest.mock('../src/models/db', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/rateLimiter', () => ({
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');
const { authenticate, requireRole } = require('../src/middleware/auth');
const { clearBlacklist, addToBlacklist } = require('../src/models/tokenBlacklist');

const SECRET = process.env.JWT_SECRET;

// Creates a minimal Express app whose only route is GET /probe, guarded by
// authenticate and optionally requireRole(role).  The handler echoes req.user
// so callers can assert on the decoded token payload.
function buildTestApp(role = null) {
  const app = express();
  app.use(express.json());

  const guards = role ? [authenticate, requireRole(role)] : [authenticate];

  app.get('/probe', ...guards, (req, res) => {
    res.json({ userId: req.user.userId, role: req.user.role });
  });

  return app;
}

// Clear the in-memory token blacklist between tests to prevent bleed-over.
beforeEach(() => {
  clearBlacklist();
});

// ─── authenticate middleware ─────────────────────────────────────────────────

describe('authenticate middleware', () => {
  const app = buildTestApp();

  it('SUCCESS: passes through with a valid token and attaches req.user', async () => {
    const token = jwt.sign({ userId: 5, username: 'carol', role: 'patient' }, SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: 5, role: 'patient' });
  });

  it('ERROR: returns 401 when Authorization header is absent', async () => {
    const res = await request(app).get('/probe');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('ERROR: returns 401 when scheme is not Bearer (e.g. Basic)', async () => {
    const res = await request(app)
      .get('/probe')
      .set('Authorization', 'Basic abc123');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('ERROR: returns 401 for a token signed with a different secret', async () => {
    const wrongToken = jwt.sign({ userId: 1 }, 'wrong_secret_entirely', { expiresIn: '1h' });

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${wrongToken}`);

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 401 for a structurally invalid (garbage) token', async () => {
    const res = await request(app)
      .get('/probe')
      .set('Authorization', 'Bearer not.a.jwt.token.at.all');

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 401 with TokenExpiredError message for an expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 1, username: 'alice', role: 'patient', exp: Math.floor(Date.now() / 1000) - 3600 },
      SECRET
    );

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('ERROR: returns 401 and revoked message for a blacklisted token', async () => {
    const token = jwt.sign({ userId: 1, username: 'alice', role: 'patient' }, SECRET, { expiresIn: '1h' });
    addToBlacklist(token);

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('EDGE: token with no "Bearer " prefix but correct format is rejected', async () => {
    const token = jwt.sign({ userId: 1 }, SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/probe')
      .set('Authorization', token); // no "Bearer " prefix

    expect(res.status).toBe(401);
  });
});

// ─── requireRole middleware ──────────────────────────────────────────────────

describe('requireRole middleware', () => {
  it('SUCCESS: allows a clinician token through a clinician-only route', async () => {
    const app = buildTestApp('clinician');
    const token = jwt.sign({ userId: 2, username: 'dr_sara', role: 'clinician' }, SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('clinician');
  });

  it('ERROR: returns 403 when a patient token hits a clinician-only route', async () => {
    const app = buildTestApp('clinician');
    const token = jwt.sign({ userId: 1, username: 'alice', role: 'patient' }, SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it('ERROR: returns 403 when a clinician token hits a patient-only route', async () => {
    const app = buildTestApp('patient');
    const token = jwt.sign({ userId: 2, username: 'dr_sara', role: 'clinician' }, SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/probe')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it('ERROR: returns 401 (not 403) when there is no token at all on a role-protected route', async () => {
    // authenticate runs before requireRole in the middleware chain.  A missing token
    // is an authentication failure (401), not an authorisation failure (403).
    const app = buildTestApp('clinician');
    const res = await request(app).get('/probe');
    expect(res.status).toBe(401);
  });
});

// ─── Upload middleware (MIME type filtering) ─────────────────────────────────

describe('Upload middleware MIME type filtering', () => {
  const { imageUpload, audioUpload } = require('../src/middleware/upload');

  // Wraps a single multer instance in a minimal Express app with an error
  // handler.  Multer calls cb(new Error(...)) on rejection; Express passes it
  // to the error handler, which returns 500 — letting us assert on the message.
  function buildUploadApp(multerMiddleware) {
    const app = express();
    app.post('/upload', multerMiddleware.single('file'), (req, res) => {
      res.json({ received: !!req.file });
    });
    app.use((err, req, res, next) => {
      res.status(500).json({ error: err.message });
    });
    return app;
  }

  describe('imageUpload', () => {
    const app = buildUploadApp(imageUpload);

    it('SUCCESS: accepts image/jpeg', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('jpeg data'), { filename: 'skin.jpg', contentType: 'image/jpeg' });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('SUCCESS: accepts image/png', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('png data'), { filename: 'skin.png', contentType: 'image/png' });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('ERROR: rejects image/gif', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('gif data'), { filename: 'anim.gif', contentType: 'image/gif' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/jpeg and png/i);
    });

    it('ERROR: rejects application/pdf', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('%PDF'), { filename: 'doc.pdf', contentType: 'application/pdf' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/jpeg and png/i);
    });
  });

  describe('audioUpload', () => {
    const app = buildUploadApp(audioUpload);

    it('SUCCESS: accepts audio/wav', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('wav data'), { filename: 'rec.wav', contentType: 'audio/wav' });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('SUCCESS: accepts audio/webm;codecs=opus (Chrome codec suffix)', async () => {
      // Chrome's MediaRecorder sends "audio/webm;codecs=opus" — the audioUpload
      // filter must use startsWith('audio/') rather than an exact equality check.
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('webm data'), { filename: 'rec.webm', contentType: 'audio/webm;codecs=opus' });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('SUCCESS: accepts audio/ogg', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('ogg data'), { filename: 'rec.ogg', contentType: 'audio/ogg' });
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('ERROR: rejects image/png submitted to audio endpoint', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('png data'), { filename: 'bad.png', contentType: 'image/png' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/unsupported audio format/i);
    });

    it('ERROR: rejects text/plain submitted to audio endpoint', async () => {
      const res = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('hello'), { filename: 'text.txt', contentType: 'text/plain' });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/unsupported audio format/i);
    });
  });
});
