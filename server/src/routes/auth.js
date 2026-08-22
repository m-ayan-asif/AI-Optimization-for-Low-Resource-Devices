const express = require('express');
const router = express.Router();
const { register, login, getProfile, logout } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');

// Public routes with rate limiting
router.post('/register', registerLimiter, register); // ===== ADDED RATE LIMITER =====
router.post('/login', loginLimiter, login); // ===== ADDED RATE LIMITER =====

// Protected routes (require authentication)
router.get('/profile', authenticate, getProfile);
router.post('/logout', authenticate, logout);

module.exports = router;
