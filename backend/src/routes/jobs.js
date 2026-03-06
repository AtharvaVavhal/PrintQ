const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { body, validationResult } = require('express-validator');

const pool        = require('../config/db');
const upload      = require('../config/multer');
const { verifyAccessToken } = require('../utils/jwt');
const { extractPageCount }  = require('../utils/pageCount');
const { calculateCost }     = require('../utils/costCalculator');

const router = express.Router();

// Simple inline auth for jobs routes
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing.' });
  }
  try {
    const payload = verifyAccessToken(authHeader.slice(7));
    req.admin = { sub: payload.sub, role: payload.role, collegeId: payload.collegeId };
    next();
  } catch (err) {
    next(err);
  }
}

const settingsValidators = [
  body('studentEmail').isEmail().normalizeEmail().withMessage('Valid student email required.'),
  body('studentName').optional().isLength({ max: 120 }).trim(),
  body('copies').optional().isInt({ min: 1, max: 20 }).toInt(),
  body('color').optional().isBoolean().toBoolean(),
  body('duplex').optional().isBoolean().toBoolean(),
  body('paperSize').optional().isIn(['A4', 'A3', 'Letter']),
  body('orientation').optional().isIn(['portrait', 'landscape']),
];

// POST /api/jobs/upload
router.post('/upload', requireAuth, upload.single('file'), settingsValidators, async (req, res, next) => {
  const cleanup = () => {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlink(req.file.path, () => {});
  };

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Field name must be "file".' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    cleanup();
    return res.status(422).json({ error: 'Validation failed.', details: errors.array() });
  }

  const {
    studentEmail,
    studentName  = null,
    copies       = 1,
    color        = false,
    duplex       = false,
    paperSize    = 'A4',
    orientation  = 'portrait',
  } = req.body;

  const collegeId = req.admin.collegeId;

  try {
    const pageCount = await extractPageCount(req.file.path, req.file.mimetype);
    const { totalPaise, totalRupees, breakdown } = calculateCost({
      pageCount,
      copies:  Number(copies),
      color:   color === true || color === 'true',
      duplex:  duplex === true || duplex === 'true',
    });

    const settings = {
      copies:      Number(copies),
      color:       color === true || color === 'true',
      duplex:      duplex === true || duplex === 'true',
      paper_size:  paperSize,
      orientation,
    };

    const { rows } = await pool.query(
      `INSERT INTO jobs
         (college_id, student_email, student_name,
          original_filename, stored_filename, file_size_bytes,
          page_count, settings, amount_paise)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, qr_token, status, amount_paise, page_count, created_at`,
      [
        collegeId, studentEmail, studentName,
        req.file.originalname, path.basename(req.file.path),
        req.file.size, pageCount, JSON.stringify(settings), totalPaise,
      ]
    );

    const job = rows[0];
    return res.status(201).json({
      message: 'Job created successfully.',
      job: {
        id: job.id, qrToken: job.qr_token, status: job.status,
        pageCount: job.page_count, amountPaise: job.amount_paise,
        amountRupees: totalRupees, settings, breakdown, createdAt: job.created_at,
      },
    });
  } catch (err) {
    cleanup();
    next(err);
  }
});

// GET /api/jobs/status/:qrToken — public, used by printer bridge and student portal
router.get('/status/:qrToken', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.id, j.status, j.page_count, j.settings, j.amount_paise,
              j.original_filename, j.queued_at, j.printed_at,
              p.status AS payment_status
       FROM jobs j
       LEFT JOIN payments p ON p.id = j.payment_id
       WHERE j.qr_token = $1`,
      [req.params.qrToken]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ job: rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs
router.get('/', requireAuth, async (req, res, next) => {
  const { status, limit = 50, offset = 0 } = req.query;
  try {
    let query = `SELECT id, student_email, student_name, original_filename,
                        page_count, amount_paise, status, created_at, printed_at
                 FROM jobs WHERE college_id = $1`;
    const params = [req.admin.collegeId];
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));
    const { rows } = await pool.query(query, params);
    return res.json({ jobs: rows, count: rows.length });
  } catch (err) { next(err); }
});

// GET /api/jobs/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.*, p.status AS payment_status, p.razorpay_payment_id
       FROM jobs j LEFT JOIN payments p ON p.id = j.payment_id
       WHERE j.id = $1 AND j.college_id = $2`,
      [req.params.id, req.admin.collegeId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found.' });
    return res.json({ job: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;