const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { redisClient } = require('../config/redis');

router.get('/health', async (req, res) => {
  const checks = { status: 'ok', timestamp: new Date().toISOString() };

  // Check DB
  try {
    await pool.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    checks.status = 'degraded';
  }

  // Check Redis
  try {
    await redisClient.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
    checks.status = 'degraded';
  }

  res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

module.exports = router;