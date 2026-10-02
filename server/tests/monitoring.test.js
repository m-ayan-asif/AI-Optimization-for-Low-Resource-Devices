/**
 * Integration tests for POST /api/monitoring/:caseId/telemetry.
 *
 * db.query is mocked; the real auth middleware and the real telemetry rate
 * limiter are used. The '../src/middleware/rateLimiter' partial mock mirrors the
 * other suites to prove the monitoring route does not depend on it.
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
const { parseTelemetry } = require('../src/controllers/monitoringController');

const SECRET = process.env.JWT_SECRET;
const token = (userId = 10) =>
  jwt.sign({ userId, username: `user${userId}`, role: 'patient' }, SECRET, { expiresIn: '1h' });
const TOKEN = token();

const FULL_PAYLOAD = {
  device_cores: 8,
  device_memory_gb: 4,
  client_ram_used_mb: 18.42,
  effective_connection: '3g',
  client_rtt_ms: 300,
  audio_processing_ms: 120,
  browser_user_agent: 'Mozilla/5.0 test',
  image_preprocess_ms: 35,
  model_inference_ms: 88,
  gradcam_generation_ms: 140,
  total_server_time_ms: 320,
  server_ram_used_mb: 12.5,
  gpu_vram_used_mb: 0,
  device_type: 'cpu',
};

const post = (caseId, body, tok = TOKEN) =>
  request(app)
    .post(`/api/monitoring/${caseId}/telemetry`)
    .set('Authorization', `Bearer ${tok}`)
    .send(body);

const mockOwnedCase = () => db.query.mockResolvedValueOnce({ rows: [{ case_id: 5 }] });
const mockInsert = () =>
  db.query.mockResolvedValueOnce({ rows: [{ telemetry_id: 1, case_id: 5, created_at: 'now' }] });

beforeEach(() => db.query.mockReset());

describe('POST /api/monitoring/:caseId/telemetry', () => {
  it('SUCCESS: stores a full payload and returns only ids', async () => {
    mockOwnedCase();
    mockInsert();
    const res = await post(5, FULL_PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ telemetry_id: 1, case_id: 5, created_at: 'now' });
    expect(res.body).not.toHaveProperty('browser_user_agent');
  });

  it('SUCCESS: ownership query is scoped to the authenticated user', async () => {
    mockOwnedCase();
    mockInsert();
    await post(5, FULL_PAYLOAD);
    expect(db.query.mock.calls[0][1]).toEqual([5, 10]);
  });

  it('SUCCESS: a real 0 is stored as 0, not NULL', async () => {
    mockOwnedCase();
    mockInsert();
    await post(5, { ...FULL_PAYLOAD, gpu_vram_used_mb: 0, client_rtt_ms: 0, server_ram_used_mb: 0 });
    const params = db.query.mock.calls[1][1];
    expect(params[13]).toBe(0); // gpu_vram_used_mb
    expect(params[5]).toBe(0); // client_rtt_ms
    expect(params[12]).toBe(0); // server_ram_used_mb
  });

  it('SUCCESS: missing browser-dependent fields are stored as NULL / unknown', async () => {
    mockOwnedCase();
    mockInsert();
    const res = await post(5, { device_cores: 4, model_inference_ms: 90 });
    expect(res.status).toBe(201);
    const params = db.query.mock.calls[1][1];
    expect(params[2]).toBeNull(); // device_memory_gb
    expect(params[3]).toBeNull(); // client_ram_used_mb
    expect(params[4]).toBe('unknown'); // effective_connection (never a fabricated "4g")
    expect(params[5]).toBeNull(); // client_rtt_ms
  });

  it('SUCCESS: accepts an empty body (everything NULL)', async () => {
    mockOwnedCase();
    mockInsert();
    const res = await post(5, {});
    expect(res.status).toBe(201);
  });

  it('SUCCESS: truncates an oversized user agent', async () => {
    mockOwnedCase();
    mockInsert();
    await post(5, { browser_user_agent: 'x'.repeat(5000) });
    expect(db.query.mock.calls[1][1][7]).toHaveLength(300);
  });

  it('SUCCESS: rounds fractional values for integer columns', async () => {
    mockOwnedCase();
    mockInsert();
    await post(5, { model_inference_ms: 88.6 });
    expect(db.query.mock.calls[1][1][9]).toBe(89);
  });

  it('SUCCESS: upserts, so a repeated post does not create a second row', async () => {
    mockOwnedCase();
    mockInsert();
    await post(5, FULL_PAYLOAD);
    expect(db.query.mock.calls[1][0]).toMatch(/ON CONFLICT \(case_id\) DO UPDATE/);
  });

  it('ERROR: 401 without a token', async () => {
    const res = await request(app).post('/api/monitoring/5/telemetry').send(FULL_PAYLOAD);
    expect(res.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-3', '1.5', '5;DROP'])('ERROR: 400 for invalid case id %s', async (id) => {
    const res = await post(id, FULL_PAYLOAD);
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("ERROR: 404 when the case belongs to someone else (or does not exist)", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await post(999, FULL_PAYLOAD);
    expect(res.status).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1); // never reaches the INSERT
  });

  it.each([
    ['negative latency', { model_inference_ms: -5 }],
    ['absurdly large latency', { total_server_time_ms: 10 ** 9 }],
    ['non-numeric value', { client_ram_used_mb: 'lots' }],
    ['NaN as string', { device_memory_gb: 'NaN' }],
    ['zero cores', { device_cores: 0 }],
    ['unknown connection type', { effective_connection: '6g' }],
    ['unknown device type', { device_type: 'tpu' }],
    ['non-string user agent', { browser_user_agent: { a: 1 } }],
  ])('ERROR: 400 for %s', async (_label, patch) => {
    const res = await post(5, { ...FULL_PAYLOAD, ...patch });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('ERROR: 500 when the database throws', async () => {
    mockOwnedCase();
    db.query.mockRejectedValueOnce(new Error('boom'));
    const res = await post(5, FULL_PAYLOAD);
    expect(res.status).toBe(500);
  });

  it('ERROR: 429 after too many submissions from one user', async () => {
    const t = token(777);
    db.query.mockResolvedValue({ rows: [{ case_id: 5, telemetry_id: 1, created_at: 'now' }] });
    let last;
    for (let i = 0; i < 31; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      last = await post(5, {}, t);
    }
    expect(last.status).toBe(429);
    // A different user is not affected.
    const other = await post(5, {}, token(778));
    expect(other.status).toBe(201);
  });
});

describe('parseTelemetry', () => {
  it('converts numeric strings', () => {
    expect(parseTelemetry({ device_cores: '8' }).values.device_cores).toBe(8);
  });
  it('treats null / empty string as NULL', () => {
    const { values } = parseTelemetry({ client_rtt_ms: null, device_memory_gb: '' });
    expect(values.client_rtt_ms).toBeNull();
    expect(values.device_memory_gb).toBeNull();
  });
  it('rejects Infinity', () => {
    expect(parseTelemetry({ model_inference_ms: Infinity }).error).toBeDefined();
  });
});
