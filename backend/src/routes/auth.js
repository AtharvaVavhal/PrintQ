const express = require('express');
const bcrypt  = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const { pool } = require('../config/db');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { authLimiter } = require('../middleware/security');

const router = express.Router();

const COOKIE_NAME = 'printq_refresh';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000,
  path:     '/api/auth',
};

// POST /api/auth/login
router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required.'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
], async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: 'Validation failed.', details: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const collegeId = req.headers['x-college-id'] || process.env.DEFAULT_COLLEGE_ID;

    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, role, college_id, is_active
       FROM admins WHERE college_id = $1 AND email = $2 LIMIT 1`,
      [collegeId, email]
    );

    const admin = rows[0];
    const dummyHash = '$2a$12$dummyhashfortimingnormalizationXXXXXXXXXXXXXXXXXXXX';
    const hashToCompare = admin ? admin.password_hash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!admin || !passwordMatch || !admin.is_active) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const tokenPayload = { sub: admin.id, role: admin.role, collegeId: admin.college_id };
    const accessToken  = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken({ sub: admin.id });

    await pool.query('UPDATE admins SET last_login_at = NOW() WHERE id = $1', [admin.id]);

    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);

    return res.json({
      accessToken,
      admin: {
        id:        admin.id,
        email:     admin.email,
        name:      admin.name,
        role:      admin.role,
        collegeId: admin.college_id,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Refresh token missing.' });
  }

  try {
    const payload = verifyRefreshToken(token);

    const { rows } = await pool.query(
      `SELECT id, email, name, role, college_id, is_active FROM admins WHERE id = $1`,
      [payload.sub]
    );

    const admin = rows[0];
    if (!admin || !admin.is_active) {
      res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
      return res.status(401).json({ error: 'Account not found or deactivated.' });
    }

    const tokenPayload = { sub: admin.id, role: admin.role, collegeId: admin.college_id };
    const newAccessToken = signAccessToken(tokenPayload);

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 });
  return res.json({ message: 'Logged out.' });
});

// GET /api/auth/me
router.get('/me', async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing.' });
  }

  const { verifyAccessToken } = require('../utils/jwt');
  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    const { rows } = await pool.query(
      `SELECT id, email, name, role, college_id, last_login_at, created_at
       FROM admins WHERE id = $1`,
      [payload.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Admin not found.' });
    return res.json({ admin: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
