const rateLimit = require('express-rate-limit');

/**
 * Per-user limiter for telemetry ingestion.
 *
 * Defined in its own file (not rateLimiter.js) so it keeps working in test
 * suites that replace '../middleware/rateLimiter' with a partial mock.
 * A normal screening posts telemetry once, so 30 per 15 minutes is generous.
 * Keyed by user id (falls back to a constant, never to req.ip, so IPv6 users
 * behind shared prefixes are not lumped together).
 */
const telemetryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user?.userId ?? 'anonymous'}`,
  validate: { keyGeneratorIpFallback: false },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many telemetry submissions. Please try again later.' });
  },
});

module.exports = { telemetryLimiter };
