const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { body, param, validationResult } = require('express-validator');

const { pool, withTransaction } = require('../config/db');

const router = express.Router();

// ─── Bridge auth middleware ───────────────────────────────────────────────────
function requireBridgeAuth(req, res, next) {
  const secret = req.headers['x-bridge-secret'];
  if (!secret || secret !== process.env.BRIDGE_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing bridge secret.' });
  }
  next();
}

router.use(requireBridgeAuth);

// ─── Validation helper ────────────────────────────────────────────────────────
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ error: 'Validation failed.', details: errors.array() });
    return false;
  }
  return true;
}

// ─── Status transition helper ─────────────────────────────────────────────────
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

// ═════════════════════════════════════════════════════════════════════════════

// ─── POST /api/bridge/validate-qr ────────────────────────────────────────────
// Called by the bridge when a student scans their QR code at the printer.
// Verifies the token is real, belongs to a paid+queued job, and hasn't been used.
// On success, marks the job as 'processing' and the QR as consumed.
//
// Body: { qrToken: string, printerId: string }
router.post('/validate-qr', [
  body('qrToken').notEmpty().isString().trim(),
  body('printerId').notEmpty().isUUID(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const { qrToken, printerId } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Look up the job by QR token and lock it to prevent race conditions
    const { rows } = await client.query(
      `SELECT
         j.id, j.status, j.college_id,
         j.stored_filename, j.original_filename,
         j.page_count, j.settings, j.amount_paise,
         j.student_email, j.printer_id,
         p.status AS payment_status
       FROM jobs j
       LEFT JOIN payments p ON p.id = j.payment_id
       WHERE j.qr_token = $1
       FOR UPDATE OF j`,
      [qrToken]
    );

    const job = rows[0];

    // 2. Validate job exists and is in the right state
    if (!job) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'QR code not recognised.' });
    }

    if (job.status === 'processing' || job.status === 'printing') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This job is already being printed.' });
    }

    if (job.status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This job has already been printed.' });
    }

    if (job.status === 'refunded') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This job has been refunded.' });
    }

    if (job.status !== 'queued') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Job is not ready to print. Current status: ${job.status}.`,
      });
    }

    if (job.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'Payment not confirmed for this job.' });
    }

    // 3. Confirm printer exists
    const { rows: printerRows } = await client.query(
      `SELECT id, name, status FROM printers WHERE id = $1`,
      [printerId]
    );

    if (!printerRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Printer not found.' });
    }

    if (printerRows[0].status === 'error') {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'Printer is in error state. Contact support.' });
    }

    // 4. Transition job to processing and assign to this printer
    await updateJobStatus(client, job.id, 'processing', { printer_id: printerId });
    await client.query('COMMIT');

    // 5. Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`job:${job.id}`).emit('job:status', { jobId: job.id, status: 'processing' });
    }

    return res.json({
      valid: true,
      job: {
        id:               job.id,
        storedFilename:   job.stored_filename,
        originalFilename: job.original_filename,
        pageCount:        job.page_count,
        settings:         job.settings,
        amountPaise:      job.amount_paise,
        studentEmail:     job.student_email,
        downloadPath:     `/api/bridge/download/${job.id}`,
      },
      printer: printerRows[0],
    });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── POST /api/bridge/job-status ─────────────────────────────────────────────
// Called by the bridge to report progress as CUPS processes the job.
// Allowed transitions:
//   processing → printing   (CUPS accepted the job)
//   printing   → completed  (CUPS finished successfully)
//   processing → failed     (pre-print error)
//   printing   → failed     (mid-print error)
//
// Body: { jobId: string, status: string, error?: string }
router.post('/job-status', [
  body('jobId').notEmpty().isUUID(),
  body('status').isIn(['printing', 'completed', 'failed']),
  body('error').optional().isString().isLength({ max: 500 }).trim(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  const { jobId, status, error: errorMsg } = req.body;

  // Define valid transitions
  const ALLOWED_FROM = {
    printing:  ['processing'],
    completed: ['printing'],
    failed:    ['processing', 'printing'],
  };

  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, status, printer_id, college_id FROM jobs WHERE id = $1 FOR UPDATE`,
        [jobId]
      );

      const job = rows[0];
      if (!job) return res.status(404).json({ error: 'Job not found.' });

      if (!ALLOWED_FROM[status]?.includes(job.status)) {
        return res.status(409).json({
          error: `Cannot transition from "${job.status}" to "${status}".`,
        });
      }

      // Extra fields to set on specific transitions
      const extraFields = {};
      if (status === 'printing')  extraFields.queued_at  = new Date(); // re-use queued_at as print-start
      if (status === 'completed') extraFields.printed_at = new Date();

      await updateJobStatus(client, jobId, status, extraFields);

      // Update printer status based on new job status
      if (job.printer_id) {
        const printerStatus = status === 'printing' ? 'busy' : 'online';
        await client.query(
          `UPDATE printers SET status = $1, updated_at = NOW() WHERE id = $2`,
          [printerStatus, job.printer_id]
        );
      }

      // Emit real-time event to student portal and admin dashboard
      const io = req.app.get('io');
      if (io) {
        io.to(`job:${jobId}`).emit('job:status', { jobId, status, error: errorMsg });
        if (job.printer_id) {
          io.to(`printer:${job.printer_id}`).emit('printer:job-update', { jobId, status });
        }
      }

      return res.json({ ok: true, jobId, status });
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/bridge/download/:jobId ─────────────────────────────────────────
// The bridge calls this to download the actual file before sending it to CUPS.
// Streams the file directly — no base64 encoding.
router.get('/download/:jobId', [
  param('jobId').isUUID(),
], async (req, res, next) => {
  if (!validate(req, res)) return;

  try {
    const { rows } = await pool.query(
      `SELECT stored_filename, original_filename, status
       FROM jobs WHERE id = $1`,
      [req.params.jobId]
    );

    const job = rows[0];
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    // Only allow download for jobs that are actively being processed
    const downloadableStatuses = ['processing', 'printing', 'queued'];
    if (!downloadableStatuses.includes(job.status)) {
      return res.status(409).json({
        error: `File not available for download. Job status: ${job.status}`,
      });
    }

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filePath  = path.resolve(uploadDir, job.stored_filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk.' });
    }

    // Set filename header so bridge knows what extension to use
    res.setHeader('Content-Disposition', `attachment; filename="${job.original_filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;