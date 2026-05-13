/**
 * Integration tests for /api/auth routes (register, login, logout, profile).
 *
 * Mocking strategy:
 *  - db.query       → jest.fn() so each test controls exactly what rows the DB returns
 *                     without touching a real database.  Chain .mockResolvedValueOnce()
 *                     calls in the order the controller executes its queries.
 *  - rateLimiter    → passthrough no-ops; rate limiting is not under test here.
 *  - bcryptjs       → hash always returns a fixed string; compare is a jest.fn() whose
 *                     return value is set per-test.  Avoids the real 300 ms bcrypt cost.
 *
 * jest.mock() calls are hoisted to the top of the file by Babel/Jest before any imports
 * run, so the mocked versions are in place when `require('../src/app')` is evaluated.
 */

// Mocks are hoisted before all imports by Jest
jest.mock('../src/models/db', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/rateLimiter', () => ({
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
  strictLimiter: (req, res, next) => next(),
}));
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mockedhash'),
  compare: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/models/db');
const { clearBlacklist } = require('../src/models/tokenBlacklist');

const SECRET = process.env.JWT_SECRET;

// Creates a signed JWT for the test user; overrides let individual tests set
// role, userId, or expiry without duplicating the sign() call everywhere.
function makeToken(overrides = {}) {
  return jwt.sign(
    { userId: 1, username: 'alice', role: 'patient', ...overrides },
    SECRET,
    { expiresIn: '1h' }
  );
}

// The token blacklist is an in-memory Set.  Clear it before each test so a
// token blacklisted by one test cannot affect the next.
beforeEach(() => {
  clearBlacklist();
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('SUCCESS: registers a patient with all profile fields', async () => {
    // The controller runs four sequential queries: duplicate check, users INSERT,
    // patient_profiles INSERT, audit_logs INSERT.  Each mockResolvedValueOnce()
    // corresponds to one query in that order.
    db.query
      .mockResolvedValueOnce({ rows: [] })  // duplicate check → none found
      .mockResolvedValueOnce({ rows: [{ user_id: 1, username: 'alice', role: 'patient' }] })
      .mockResolvedValueOnce({ rows: [] })  // patient_profiles INSERT
      .mockResolvedValueOnce({ rows: [] }); // audit_logs INSERT

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@test.com', password: 'pass123', role: 'patient', age: 25, gender: 'F', region: 'Islamabad' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ username: 'alice', role: 'patient' });
    const decoded = jwt.verify(res.body.token, SECRET);
    expect(decoded.userId).toBe(1);
  });

  it('SUCCESS: registers a clinician', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 2, username: 'dr_sara', role: 'clinician' }] })
      .mockResolvedValueOnce({ rows: [] })  // clinician_profiles INSERT
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'dr_sara', email: 'sara@clinic.com', password: 'securepass', role: 'clinician' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('clinician');
    expect(res.body).toHaveProperty('token');
  });

  it('SUCCESS: registers a patient with minimal fields (no age/gender/region)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 3, username: 'bob', role: 'patient' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', email: 'bob@test.com', password: 'pass123' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
  });

  it('SUCCESS: defaults role to patient when role is omitted', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 4, username: 'dave', role: 'patient' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'dave', email: 'dave@test.com', password: 'pass123' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('patient');
  });

  // Age validation tests (two-layer defence: HTML min/max on the client, plus server
  // guard in the register controller).  These tests verify the server layer catches
  // invalid values regardless of what the client sends.
  it('ERROR: returns 400 for a negative age', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@test.com', password: 'pass123', age: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/age/i);
  });

  it('ERROR: returns 400 for an age above 120', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@test.com', password: 'pass123', age: 999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/age/i);
  });

  it('ERROR: returns 400 for a decimal age', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@test.com', password: 'pass123', age: 25.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/age/i);
  });

  it('ERROR: returns 400 for age zero', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@test.com', password: 'pass123', age: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/age/i);
  });

  it('SUCCESS: accepts valid boundary ages (1 and 120)', async () => {
    for (const age of [1, 120]) {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ user_id: age, username: `user${age}`, role: 'patient' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: `user${age}`, email: `user${age}@test.com`, password: 'pass123', age });
      expect(res.status).toBe(201);
    }
  });

  it('ERROR: returns 409 when username or email is already taken', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: 99 }] }); // duplicate found

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', email: 'alice@test.com', password: 'pass123' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken/i);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'charlie', email: 'charlie@test.com', password: 'pass123' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/registration failed/i);
  });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('SUCCESS: returns a JWT for valid credentials', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ user_id: 1, username: 'alice', email: 'alice@test.com', password_hash: '$2b$12$mockedhash', role: 'patient' }],
      })
      .mockResolvedValueOnce({ rows: [] }); // audit log
    bcrypt.compare.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'pass123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user).toMatchObject({ username: 'alice', role: 'patient' });
  });

  it('ERROR: returns 401 for an unknown username', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // user not found

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'pass123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('ERROR: returns 401 for a correct username but wrong password', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 1, username: 'alice', password_hash: '$2b$12$mockedhash', role: 'patient' }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('ERROR: returns 500 when the database throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'pass123' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/login failed/i);
  });

  it('EDGE: does not leak which field (username vs password) is wrong', async () => {
    // Security requirement: both "user not found" and "wrong password" must return
    // the identical error message so an attacker cannot enumerate valid usernames.
    db.query.mockResolvedValueOnce({ rows: [] });
    const res1 = await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'x' });

    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 1, username: 'alice', password_hash: '$2b$12$mockedhash', role: 'patient' }],
    });
    bcrypt.compare.mockResolvedValueOnce(false);
    const res2 = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'bad' });

    expect(res1.body.error).toBe(res2.body.error);
  });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('SUCCESS: blacklists the token and returns success', async () => {
    const token = makeToken();
    db.query.mockResolvedValueOnce({ rows: [] }); // audit log

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('EDGE: blacklisted token is rejected on subsequent authenticated requests', async () => {
    // Logout adds the token to the in-memory blacklist.  A second request with the
    // same token must fail even though the JWT signature is still valid and not expired.
    const token = makeToken();
    db.query.mockResolvedValue({ rows: [] });

    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);

    // Same token should now be rejected
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('ERROR: returns 401 with no Authorization header', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws during logout', async () => {
    const token = makeToken();
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/logout failed/i);
  });
});

// ─── GET /api/auth/profile ───────────────────────────────────────────────────

describe('GET /api/auth/profile', () => {
  it('SUCCESS: returns patient user and profile data', async () => {
    const token = makeToken({ userId: 1, role: 'patient' });
    db.query
      .mockResolvedValueOnce({ rows: [{ user_id: 1, username: 'alice', email: 'alice@test.com', role: 'patient' }] })
      .mockResolvedValueOnce({ rows: [{ patient_id: 1, age: 25, gender: 'F', region: 'Islamabad' }] });

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'alice', role: 'patient' });
    expect(res.body.profile).toMatchObject({ age: 25, gender: 'F' });
  });

  it('SUCCESS: returns clinician user and profile data', async () => {
    const token = makeToken({ userId: 2, username: 'dr_sara', role: 'clinician' });
    db.query
      .mockResolvedValueOnce({ rows: [{ user_id: 2, username: 'dr_sara', email: 'sara@clinic.com', role: 'clinician' }] })
      .mockResolvedValueOnce({ rows: [{ clinician_id: 2 }] });

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('clinician');
  });

  it('SUCCESS: returns null profile when profile row does not exist yet', async () => {
    const token = makeToken({ userId: 5, role: 'patient' });
    db.query
      .mockResolvedValueOnce({ rows: [{ user_id: 5, username: 'new_user', email: 'new@test.com', role: 'patient' }] })
      .mockResolvedValueOnce({ rows: [] }); // no profile row

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
  });

  it('ERROR: returns 401 with no token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/authentication required/i);
  });

  it('ERROR: returns 401 with an expired token', async () => {
    const expiredToken = jwt.sign(
      { userId: 1, username: 'alice', role: 'patient', exp: Math.floor(Date.now() / 1000) - 3600 },
      SECRET
    );

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('ERROR: returns 401 with a tampered token (bad signature)', async () => {
    const validToken = makeToken();
    const tampered = validToken.slice(0, -10) + 'tampered!!';

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${tampered}`);

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 401 with a malformed Bearer value (no token after space)', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
  });

  it('ERROR: returns 500 when the database throws during profile fetch', async () => {
    const token = makeToken();
    db.query.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch profile/i);
  });
});
