const express   = require('express');
const Razorpay  = require('razorpay');
const { body, query: qv, param, validationResult } = require('express-validator');

const { pool, withTransaction } = require('../config/db');
const requireAuth  = require('../middleware/requireAuth');
const requireRole  = require('../middleware/requireRole');

const router = express.Router();

// All admin routes require a valid JWT + admin/superadmin role
router.use(requireAuth);
router.use(requireRole('admin', 'superadmin', 'operator'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRazorpay() {
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: 'Validation failed.', details: errors.array() });
    return false;
  }
  return true;
}

async function updateJobStatus(client, jobId, newStatus, extraFields = {}) {
  const extraKeys = Object.keys(extraFields);
  const extraSQL  = extraKeys.map((k, i) => `, ${k} = $${i + 3}`).join('');
  const values    = [newStatus, jobId, ...Object.values(extraFields)];

  await client.query(
    `UPDATE jobs
     SET status = $1,
         status_history = status_history || jsonb_build_object(
           'status', $1::text,
           'at', NOW()::text
         ),
         updated_at = NOW()
         ${extraSQL}
     WHERE id = $2`,
    values
  );
}

// ─── GET /api/admin/jobs ──────────────────────────────────────────────────────
// List all jobs for the college with optional filters and pagination.
//
// Query params:
//   status   — filter by job_status enum value
//   email    — filter by student_email (partial, case-insensitive)
//   from     — ISO date string, created_at >= from
//   to       — ISO date string, created_at <= to
//   limit    — default 50, max 200
//   offset   — default 0
router.get('/jobs', [
  qv('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  qv('offset').optional().isInt({ min: 0 }).toInt(),
  qv('from').optional().isISO8601(),
  qv('to').optional().isISO8601(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const {
    status,
    email,
    from,
    to,
    limit  = 50,
    offset = 0,
  } = req.query;

  try {
    const params  = [req.admin.collegeId];
    const clauses = ['j.college_id = $1'];

    if (status) { params.push(status);       clauses.push(`j.status = $${params.length}`); }
    if (email)  { params.push(`%${email}%`); clauses.push(`j.student_email ILIKE $${params.length}`); }
    if (from)   { params.push(from);         clauses.push(`j.created_at >= $${params.length}`); }
    if (to)     { params.push(to);           clauses.push(`j.created_at <= $${params.length}`); }

    const where = clauses.join(' AND ');

    // Total count for pagination
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM jobs j WHERE ${where}`,
      params
    );

    // Paginated results with payment info joined
    params.push(parseInt(limit, 10), parseInt(offset, 10));
    const { rows } = await pool.query(
      `SELECT
         j.id, j.student_email, j.student_name,
         j.original_filename, j.file_size_bytes,
         j.page_count, j.settings, j.amount_paise,
         j.status, j.status_history, j.qr_token,
         j.queued_at, j.printed_at, j.created_at, j.updated_at,
         p.id           AS payment_id,
         p.status       AS payment_status,
         p.razorpay_order_id,
         p.razorpay_payment_id,
         pr.name        AS printer_name,
         pr.location    AS printer_location
       FROM jobs j
       LEFT JOIN payments p  ON p.id  = j.payment_id
       LEFT JOIN printers pr ON pr.id = j.printer_id
       WHERE ${where}
       ORDER BY j.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      jobs:   rows,
      total:  parseInt(countRows[0].total, 10),
      limit:  parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// List all unique students derived from the jobs table.
// (There is no separate students table — students are identified by email.)
//
// Query params:
//   search  — filter by email or name (partial, case-insensitive)
//   limit   — default 50, max 200
//   offset  — default 0
router.get('/users', [
  qv('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  qv('offset').optional().isInt({ min: 0 }).toInt(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const { search, limit = 50, offset = 0 } = req.query;

  try {
    const params  = [req.admin.collegeId];
    let searchSQL = '';

    if (search) {
      params.push(`%${search}%`);
      searchSQL = `AND (student_email ILIKE $${params.length} OR student_name ILIKE $${params.length})`;
    }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(DISTINCT student_email) AS total
       FROM jobs
       WHERE college_id = $1 ${searchSQL}`,
      params
    );

    params.push(parseInt(limit, 10), parseInt(offset, 10));
    const { rows } = await pool.query(
      `SELECT
         student_email                                    AS email,
         MAX(student_name)                               AS name,
         COUNT(*)                                        AS total_jobs,
         COUNT(*) FILTER (WHERE status = 'completed')   AS completed_jobs,
         COUNT(*) FILTER (WHERE status = 'failed')      AS failed_jobs,
         SUM(amount_paise)
           FILTER (WHERE status IN ('queued','processing','printing','completed'))
                                                         AS total_spent_paise,
         MIN(created_at)                                 AS first_job_at,
         MAX(created_at)                                 AS last_job_at
       FROM jobs
       WHERE college_id = $1 ${searchSQL}
       GROUP BY student_email
       ORDER BY last_job_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      users:  rows,
      total:  parseInt(countRows[0].total, 10),
      limit:  parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/printers ──────────────────────────────────────────────────
// List all printers for the college with aggregated job counts.
router.get('/printers', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         pr.*,
         COUNT(j.id)                                      AS total_jobs,
         COUNT(j.id) FILTER (WHERE j.status = 'queued')  AS queued_jobs,
         COUNT(j.id) FILTER (WHERE j.status = 'printing') AS active_jobs
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

// ─── PUT /api/admin/printers/:id ─────────────────────────────────────────────
// Update a printer's name, location, IP address, or capabilities.
router.put('/printers/:id', [
  param('id').isUUID(),
  body('name').optional().isLength({ min: 1, max: 120 }).trim(),
  body('location').optional().isLength({ max: 255 }).trim(),
  body('ip_address').optional().isIP(),
  body('status').optional().isIn(['online', 'offline', 'busy', 'error']),
  body('capabilities').optional().isObject(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const { name, location, ip_address, status, capabilities } = req.body;

  // Only superadmin can force status changes
  if (status && req.admin.role === 'operator') {
    return res.status(403).json({ error: 'Operators cannot change printer status directly.' });
  }

  try {
    const setClauses = [];
    const params     = [];

    if (name         !== undefined) { params.push(name);                       setClauses.push(`name = $${params.length}`); }
    if (location     !== undefined) { params.push(location);                   setClauses.push(`location = $${params.length}`); }
    if (ip_address   !== undefined) { params.push(ip_address);                 setClauses.push(`ip_address = $${params.length}`); }
    if (status       !== undefined) { params.push(status);                     setClauses.push(`status = $${params.length}`); }
    if (capabilities !== undefined) { params.push(JSON.stringify(capabilities)); setClauses.push(`capabilities = $${params.length}`); }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update.' });
    }

    params.push(req.params.id, req.admin.collegeId);

    const { rows } = await pool.query(
      `UPDATE printers
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${params.length - 1} AND college_id = $${params.length}
       RETURNING *`,
      params
    );

    if (!rows[0]) return res.status(404).json({ error: 'Printer not found.' });

    return res.json({ printer: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/admin/analytics ─────────────────────────────────────────────────
// Revenue, job counts, and daily breakdown for the last N days.
//
// Query params:
//   days  — number of days to look back (default 7, max 90)
router.get('/analytics', [
  qv('days').optional().isInt({ min: 1, max: 90 }).toInt(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const days = parseInt(req.query.days || '7', 10);

  try {
    const collegeId = req.admin.collegeId;

    // ── Overall totals ──────────────────────────────────────────────────────
    const { rows: totals } = await pool.query(
      `SELECT
         COUNT(*)                                                        AS total_jobs,
         COUNT(*) FILTER (WHERE status = 'completed')                   AS completed_jobs,
         COUNT(*) FILTER (WHERE status IN ('queued','processing','printing')) AS active_jobs,
         COUNT(*) FILTER (WHERE status = 'failed')                      AS failed_jobs,
         COUNT(*) FILTER (WHERE status = 'refunded')                    AS refunded_jobs,
         COALESCE(SUM(amount_paise)
           FILTER (WHERE status IN ('queued','processing','printing','completed')), 0)
                                                                         AS total_revenue_paise,
         COALESCE(SUM(amount_paise)
           FILTER (WHERE status = 'refunded'), 0)                       AS total_refunded_paise,
         COALESCE(AVG(amount_paise)
           FILTER (WHERE status = 'completed'), 0)                      AS avg_job_value_paise,
         COALESCE(SUM(page_count)
           FILTER (WHERE status = 'completed'), 0)                      AS total_pages_printed
       FROM jobs
       WHERE college_id = $1`,
      [collegeId]
    );

    // ── Daily breakdown for the last N days ─────────────────────────────────
    const { rows: daily } = await pool.query(
      `SELECT
         DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS date,
         COUNT(*)                                      AS jobs,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COALESCE(SUM(amount_paise)
           FILTER (WHERE status IN ('queued','processing','printing','completed')), 0)
                                                       AS revenue_paise
       FROM jobs
       WHERE college_id = $1
         AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE(created_at AT TIME ZONE 'Asia/Kolkata')
       ORDER BY date ASC`,
      [collegeId, days]
    );

    // ── Status distribution ─────────────────────────────────────────────────
    const { rows: statusDist } = await pool.query(
      `SELECT status, COUNT(*) AS count
       FROM jobs
       WHERE college_id = $1
       GROUP BY status
       ORDER BY count DESC`,
      [collegeId]
    );

    // ── Top students by spend ────────────────────────────────────────────────
    const { rows: topStudents } = await pool.query(
      `SELECT
         student_email,
         MAX(student_name)   AS student_name,
         COUNT(*)            AS job_count,
         SUM(amount_paise)
           FILTER (WHERE status IN ('queued','processing','printing','completed'))
                             AS total_spent_paise
       FROM jobs
       WHERE college_id = $1
       GROUP BY student_email
       ORDER BY total_spent_paise DESC NULLS LAST
       LIMIT 10`,
      [collegeId]
    );

    // ── Printer utilisation ──────────────────────────────────────────────────
    const { rows: printerStats } = await pool.query(
      `SELECT
         pr.id, pr.name, pr.status,
         COUNT(j.id)                                      AS total_jobs,
         COUNT(j.id) FILTER (WHERE j.status = 'completed') AS completed_jobs
       FROM printers pr
       LEFT JOIN jobs j ON j.printer_id = pr.id AND j.college_id = $1
       WHERE pr.college_id = $1
       GROUP BY pr.id, pr.name, pr.status`,
      [collegeId]
    );

    return res.json({
      summary:      totals[0],
      daily,
      statusDist,
      topStudents,
      printerStats,
      periodDays:   days,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/admin/refund/:jobId ────────────────────────────────────────────
// Trigger a Razorpay refund for a job.
// Allowed job statuses for refund: queued, failed, completed (within 7 days).
// Only superadmin and admin roles may issue refunds.
router.post('/refund/:jobId', [
  param('jobId').isUUID(),
  body('reason').optional().isLength({ max: 255 }).trim(),
], requireRole('admin', 'superadmin'), async (req, res, next) => {
  if (!validate(req, res)) return;

  const { jobId }  = req.params;
  const reason     = req.body.reason || 'Admin-initiated refund';
  const collegeId  = req.admin.collegeId;

  try {
    await withTransaction(async (client) => {
      // 1. Fetch the job + linked payment
      const { rows: jobRows } = await client.query(
        `SELECT j.id, j.status, j.amount_paise,
                p.id AS payment_id, p.razorpay_payment_id, p.status AS payment_status
         FROM jobs j
         LEFT JOIN payments p ON p.id = j.payment_id
         WHERE j.id = $1 AND j.college_id = $2
         FOR UPDATE`,
        [jobId, collegeId]
      );

      const job = jobRows[0];
      if (!job) throw Object.assign(new Error('Job not found.'), { status: 404 });

      const refundableStatuses = ['payment_confirmed', 'queued', 'processing', 'failed', 'completed'];
      if (!refundableStatuses.includes(job.status)) {
        throw Object.assign(
          new Error(`Cannot refund a job with status "${job.status}".`),
          { status: 409 }
        );
      }

      if (job.payment_status === 'refunded') {
        throw Object.assign(new Error('This job has already been refunded.'), { status: 409 });
      }

      if (!job.razorpay_payment_id) {
        throw Object.assign(new Error('No captured payment found to refund.'), { status: 409 });
      }

      // 2. Issue refund via Razorpay
      const razorpay = getRazorpay();
      const refund = await razorpay.payments.refund(job.razorpay_payment_id, {
        amount: job.amount_paise,
        notes:  { reason, jobId, adminId: req.admin.sub },
        speed:  'normal',
      });

      // 3. Update payments record
      await client.query(
        `UPDATE payments
         SET status = 'refunded', refund_id = $1, refunded_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [refund.id, job.payment_id]
      );

      // 4. Transition job to refunded
      await updateJobStatus(client, jobId, 'refunded');

      // 5. Emit real-time event to any listening clients
      const io = req.app.get('io');
      if (io) {
        io.to(`job:${jobId}`).emit('job:status', { jobId, status: 'refunded' });
      }

      return res.json({
        message:  'Refund issued successfully.',
        refundId: refund.id,
        amount:   job.amount_paise,
        jobId,
      });
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;