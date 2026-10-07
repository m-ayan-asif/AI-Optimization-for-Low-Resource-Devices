jest.mock('../src/models/db', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/rateLimiter', () => ({
  loginLimiter: (req, res, next) => next(),
  registerLimiter: (req, res, next) => next(),
  apiLimiter: (req, res, next) => next(),
  strictLimiter: (req, res, next) => next(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const db = require('../src/models/db');
const { clearBlacklist, addToBlacklist } = require('../src/models/tokenBlacklist');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function token(role, userId = 10) {
  return jwt.sign({ userId, username: `user_${userId}`, role }, SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  db.query.mockReset();
  clearBlacklist();
});

describe('Security & RBAC Enforcement', () => {
  it('blocks patient from accessing clinician review statistics', async () => {
    const res = await request(app)
      .get('/api/clinician/stats')
      .set('Authorization', `Bearer ${token('patient', 101)}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/insufficient permissions/i);
  });

  it('blocks patient from submitting clinician feedback', async () => {
    const res = await request(app)
      .post('/api/clinician/cases/case-99/feedback')
      .set('Authorization', `Bearer ${token('patient', 101)}`)
      .send({ decision: 'accept' });
    expect(res.status).toBe(403);
  });

  it('allows clinician to access review stats', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ pending_count: 5, reviewed_count: 10, total_count: 15 }] })
      .mockResolvedValueOnce({ rows: [{ accepted: 8, disputed: 1, corrected: 1, total_reviewed: 10 }] });

    const res = await request(app)
      .get('/api/clinician/stats')
      .set('Authorization', `Bearer ${token('clinician', 500)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_count', 15);
  });

  it('rejects revoked tokens immediately', async () => {
    const userToken = token('patient', 105);
    addToBlacklist(userToken);

    const res = await request(app)
      .get('/api/screening/history/list')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('returns 404 and does not leak case existence when foreign user attempts fetch', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // Ownership check returns empty

    const res = await request(app)
      .get('/api/screening/case-secret-999/results')
      .set('Authorization', `Bearer ${token('patient', 101)}`);
    expect(res.status).toBe(404);
  });
});