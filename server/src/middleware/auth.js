const jwt = require('jsonwebtoken');
const config = require('../config');
const { isBlacklisted } = require('../models/tokenBlacklist');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // ===== NEW: Check if token is blacklisted =====
    if (isBlacklisted(token)) {
      console.log('❌ Blacklisted token detected');
      return res.status(401).json({ error: 'Token has been revoked. Please login again.' });
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;

    // ===== NEW: Attach token to request for logout =====
    req.token = token;

    next();
  } catch (err) {
    console.error('Token verification error:', err.message);

    // Differentiate between expired and invalid tokens
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token has expired. Please login again.' });
    }

    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
