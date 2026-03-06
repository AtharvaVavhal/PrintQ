const express = require('express');
const { body, param, validationResult } = require('express-validator');

const { pool } = require('../config/db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// ─── Bridge auth middleware ───────────────────────────────────────────────────
// The Python bridge authenticates with a shared secret in the X-Bridge-Secret
// header instead of a JWT. Used only on /heartbeat and /queue endpoints.
function requireBridgeAuth(req, res, next) {
  const secret = req.headers['x-bridge-secret'];
  if (!secret || secret !== process.env.BRIDGE_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing bridge secret.' });
  }
  next();
}

// ─── Validation helper ────────────────────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: 'Validation failed.', details: errors.array() });
    return false;
  }
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN — JWT-authenticated routes
// ═════════════════════════════════════════════════════════════════════════════

// ─── GET /api/printers ───────────────────────────────────────────────────────
// List all printers for the college with live job counts.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         pr.*,
         COUNT(j.id)                                        AS total_jobs,
         COUNT(j.id) FILTER (WHERE j.status = 'queued')    AS queued_jobs,
         COUNT(j.id) FILTER (WHERE j.status = 'printing')  AS printing_jobs,
         COUNT(j.id) FILTER (WHERE j.status = 'completed') AS completed_jobs,
         CASE
           WHEN pr.last_heartbeat IS NULL THEN 'never'
           WHEN pr.last_heartbeat < NOW() - INTERVAL '2 minutes' THEN 'stale'
           ELSE 'fresh'
         END AS heartbeat_status
       FROM printers pr
       LEFT JOIN jobs j ON j.printer_id = pr.id
       WHERE pr.college_id = $1
       GROUP BY pr.id
       ORDER BY pr.name ASC`,
      [req.admin.collegeId]
    );

    return res.json({ printers: rows });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/printers ───────────────────────────────────────────────────────
// Register a new printer. Superadmin only.
router.post('/', requireAuth, requireRole('superadmin', 'admin'), [
  body('name').notEmpty().isLength({ max: 120 }).trim(),
  body('location').optional().isLength({ max: 255 }).trim(),
  body('ip_address').optional().isIP(),
  body('capabilities').optional().isObject(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const {
    name,
    location     = null,
    ip_address   = null,
    capabilities = { color: false, duplex: true, max_pages: 100, paper_sizes: ['A4', 'Letter'] },
  } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO printers (college_id, name, location, capabilities, status)
       VALUES ($1, $2, $3, $4, 'offline')
       RETURNING *`,
      [req.admin.collegeId, name, location || null, JSON.stringify(capabilities)]
    );

    // Emit to admin dashboard so it updates in real time
    const io = req.app.get('io');
    if (io) io.to(`college:${req.admin.collegeId}`).emit('printer:new', rows[0]);

    return res.status(201).json({ printer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/printers/:id ────────────────────────────────────────────────────
// Single printer detail with its last 20 jobs.
router.get('/:id', requireAuth, [
  param('id').isUUID(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  try {
    // Printer row
    const { rows: printerRows } = await pool.query(
      `SELECT
         pr.*,
         CASE
           WHEN pr.last_heartbeat IS NULL THEN 'never'
           WHEN pr.last_heartbeat < NOW() - INTERVAL '2 minutes' THEN 'stale'
           ELSE 'fresh'
         END AS heartbeat_status
       FROM printers pr
       WHERE pr.id = $1 AND pr.college_id = $2`,
      [req.params.id, req.admin.collegeId]
    );

    if (!printerRows[0]) return res.status(404).json({ error: 'Printer not found.' });

    // Last 20 jobs for this printer
    const { rows: recentJobs } = await pool.query(
      `SELECT id, student_email, original_filename, page_count,
              amount_paise, status, created_at, printed_at
       FROM jobs
       WHERE printer_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.params.id]
    );

    return res.json({ printer: printerRows[0], recentJobs });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/printers/:id ────────────────────────────────────────────────────
// Update printer details. Operators cannot force status changes.
router.put('/:id', requireAuth, [
  param('id').isUUID(),
  body('name').optional().isLength({ min: 1, max: 120 }).trim(),
  body('location').optional().isLength({ max: 255 }).trim(),
  body('ip_address').optional().isIP(),
  body('status').optional().isIn(['online', 'offline', 'busy', 'error']),
  body('capabilities').optional().isObject(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const { name, location, ip_address, status, capabilities } = req.body;

  if (status && req.admin.role === 'operator') {
    return res.status(403).json({ error: 'Operators cannot manually change printer status.' });
  }

  const setClauses = [];
  const params     = [];

  if (name         !== undefined) { params.push(name);                        setClauses.push(`name = $${params.length}`); }
  if (location     !== undefined) { params.push(location);                    setClauses.push(`location = $${params.length}`); }
  if (status       !== undefined) { params.push(status);                      setClauses.push(`status = $${params.length}`); }
  if (capabilities !== undefined) { params.push(JSON.stringify(capabilities)); setClauses.push(`capabilities = $${params.length}`); }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No fields provided to update.' });
  }

  try {
    params.push(req.params.id, req.admin.collegeId);
    const { rows } = await pool.query(
      `UPDATE printers
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND college_id = $${params.length}
       RETURNING *`,
      params
    );

    if (!rows[0]) return res.status(404).json({ error: 'Printer not found.' });

    const io = req.app.get('io');
    if (io) io.to(`printer:${req.params.id}`).emit('printer:updated', rows[0]);

    return res.json({ printer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/printers/:id ─────────────────────────────────────────────────
// Remove a printer. Only allowed if no active jobs are linked.
// Superadmin only.
router.delete('/:id', requireAuth, requireRole('superadmin'), [
  param('id').isUUID(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  try {
    // Block deletion if printer has active jobs
    const { rows: activeJobs } = await pool.query(
      `SELECT COUNT(*) AS count FROM jobs
       WHERE printer_id = $1 AND status IN ('queued', 'processing', 'printing')`,
      [req.params.id]
    );

    if (parseInt(activeJobs[0].count, 10) > 0) {
      return res.status(409).json({
        error: 'Cannot delete printer with active jobs. Wait for jobs to complete first.',
      });
    }

    const { rows } = await pool.query(
      `DELETE FROM printers WHERE id = $1 AND college_id = $2 RETURNING id, name`,
      [req.params.id, req.admin.collegeId]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Printer not found.' });

    return res.json({ message: `Printer "${rows[0].name}" deleted.`, id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// BRIDGE — X-Bridge-Secret authenticated routes
// Called by bridge.py running on the printer host machine
// ═════════════════════════════════════════════════════════════════════════════

// ─── POST /api/printers/:id/heartbeat ────────────────────────────────────────
// The bridge sends this every 30s to keep the printer marked as online.
// Body: { status: 'online' | 'busy' | 'error', info: {} }
router.post('/:id/heartbeat', requireBridgeAuth, [
  param('id').isUUID(),
  body('status').optional().isIn(['online', 'offline', 'busy', 'error']),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const newStatus = req.body.status || 'online';

  try {
    const { rows } = await pool.query(
      `UPDATE printers
       SET last_heartbeat = NOW(),
           status         = $1,
           updated_at     = NOW()
       WHERE id = $2
       RETURNING id, name, status, last_heartbeat`,
      [newStatus, req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'Printer not found.' });

    // Emit status update to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`printer:${req.params.id}`).emit('printer:heartbeat', {
        printerId:     rows[0].id,
        status:        rows[0].status,
        lastHeartbeat: rows[0].last_heartbeat,
      });
    }

    return res.json({ ok: true, printer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/printers/:id/queue ─────────────────────────────────────────────
// Bridge polls this to get the next batch of queued jobs assigned to it.
// Returns jobs in order they were queued, oldest first.
// Also returns a signed download URL path for each job file.
router.get('/:id/queue', requireBridgeAuth, [
  param('id').isUUID(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  try {
    // Confirm printer exists
    const { rows: printerRows } = await pool.query(
      `SELECT id, name, college_id FROM printers WHERE id = $1`,
      [req.params.id]
    );
    if (!printerRows[0]) return res.status(404).json({ error: 'Printer not found.' });

    // Fetch queued jobs for this printer
    // If printer_id is null on a job it means it hasn't been assigned yet —
    // we also surface those so the bridge can claim them.
    const { rows: jobs } = await pool.query(
      `SELECT
         j.id, j.qr_token, j.stored_filename, j.original_filename,
         j.page_count, j.settings, j.amount_paise,
         j.student_email, j.queued_at, j.created_at
       FROM jobs j
       WHERE j.college_id = $1
         AND j.status = 'queued'
         AND (j.printer_id = $2 OR j.printer_id IS NULL)
       ORDER BY j.queued_at ASC NULLS LAST, j.created_at ASC
       LIMIT 10`,
      [printerRows[0].college_id, req.params.id]
    );

    // Attach a relative download path to each job so the bridge knows
    // where to fetch the file from
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const jobsWithPath = jobs.map(j => ({
      ...j,
      downloadPath: `/api/bridge/download/${j.id}`,
    }));

    return res.json({ jobs: jobsWithPath, printer: printerRows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;