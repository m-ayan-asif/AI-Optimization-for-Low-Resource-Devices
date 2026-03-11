const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for login attempts
 * Prevents brute force attacks on login endpoint
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 login attempts per window
  message: {
    error: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  },
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit-* headers

  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    console.log(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter: '15 minutes',
    });
  },

  // Skip successful requests (only count failed login attempts)
  skipSuccessfulRequests: false,

  // Skip failed requests (count all attempts)
  skipFailedRequests: false,
});

/**
 * Rate limiter for registration
 * Prevents spam account creation
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Max 3 registrations per hour per IP
  message: {
    error: 'Too many accounts created from this IP. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    console.log(`⚠️ Registration rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many registration attempts. Please try again after 1 hour.',
      retryAfter: '1 hour',
    });
  },
});

/**
 * Rate limiter for general API requests
 * Prevents API abuse
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Max 100 requests per window
  message: {
    error: 'Too many requests from this IP. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,

  handler: (req, res) => {
    console.log(`⚠️ API rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: '15 minutes',
    });
  },
});

/**
 * Strict rate limiter for sensitive operations
 * For password reset, email change, etc.
 */
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 2, // Max 2 attempts per hour
  message: {
    error: 'Too many requests for this sensitive operation.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  apiLimiter,
  strictLimiter,
};
