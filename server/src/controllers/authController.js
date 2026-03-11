const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const config = require('../config');
const { addToBlacklist } = require('../models/tokenBlacklist');

async function register(req, res) {
  try {
    const { username, email, password, role, age, gender, region } = req.body;

    // Check if user exists
    const existing = await db.query('SELECT user_id FROM users WHERE username = $1 OR email = $2', [
      username,
      email,
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user
    const result = await db.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING user_id, username, role',
      [username, email, passwordHash, role || 'patient']
    );
    const user = result.rows[0];

    // Create profile based on role
    if (user.role === 'patient') {
      await db.query(
        'INSERT INTO patient_profiles (patient_id, age, gender, region) VALUES ($1, $2, $3, $4)',
        [user.user_id, age || null, gender || null, region || null]
      );
    }

    // Generate token
    const token = jwt.sign(
      { userId: user.user_id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // Log action
    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [user.user_id, 'register', 'user', user.user_id]
    );

    res.status(201).json({
      token,
      user: { id: user.user_id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
}

async function login(req, res) {
  try {
    const { username, password } = req.body;

    const result = await db.query(
      'SELECT user_id, username, email, password_hash, role FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.user_id, username: user.username, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // Log action
    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [user.user_id, 'login', 'user', user.user_id]
    );

    res.json({
      token,
      user: { id: user.user_id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
}

async function getProfile(req, res) {
  try {
    const { userId, role } = req.user;
    const table = role === 'patient' ? 'patient_profiles' : 'clinician_profiles';
    const idCol = role === 'patient' ? 'patient_id' : 'clinician_id';

    const userResult = await db.query(
      'SELECT user_id, username, email, role FROM users WHERE user_id = $1',
      [userId]
    );
    const profileResult = await db.query(`SELECT * FROM ${table} WHERE ${idCol} = $1`, [userId]);

    res.json({
      ...userResult.rows[0],
      profile: profileResult.rows[0] || null,
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

// ===== NEW: LOGOUT FUNCTION =====
async function logout(req, res) {
  try {
    const token = req.token; // Attached by authenticate middleware
    const { userId } = req.user;

    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    // Add token to blacklist
    addToBlacklist(token);

    // Log logout action
    await db.query(
      'INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)',
      [userId, 'logout', 'user', userId]
    );

    console.log(` User ${userId} logged out successfully`);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
}

module.exports = { register, login, getProfile, logout };
