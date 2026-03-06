const express  = require('express');
const crypto   = require('crypto');
const Razorpay = require('razorpay');

const pool        = require('../config/db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── POST /api/payments/create-order ─────────────────────────────────────────
// Creates a Razorpay order for a job and stores it in the payments table.
router.post('/create-order', requireAuth, async (req, res, next) => {
  const { jobId } = req.body;

  if (!jobId) return res.status(400).json({ error: 'jobId is required.' });

  try {
    // 1. Fetch the job
    const { rows: jobRows } = await pool.query(
      `SELECT id, amount_paise, status, college_id FROM jobs WHERE id = $1 AND college_id = $2`,
      [jobId, req.admin.collegeId]
    );

    const job = jobRows[0];
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.status !== 'pending_payment') {
      return res.status(409).json({ error: `Job is already in status: ${job.status}` });
    }

    // 2. Create Razorpay order
    const order = await razorpay.orders.create({
      amount:   job.amount_paise,
      currency: 'INR',
      receipt:  `job_${job.id.slice(0, 8)}`,
      notes:    { jobId: job.id, collegeId: job.college_id },
    });

    // 3. Insert into payments table
    const { rows: paymentRows } = await pool.query(
      `INSERT INTO payments (college_id, razorpay_order_id, amount_paise)
       VALUES ($1, $2, $3)
       RETURNING id, razorpay_order_id, amount_paise, status`,
      [job.college_id, order.id, job.amount_paise]
    );

    const payment = paymentRows[0];

    // 4. Link payment to job
    await pool.query(
      `UPDATE jobs SET payment_id = $1 WHERE id = $2`,
      [payment.id, job.id]
    );

    return res.status(201).json({
      orderId:     order.id,
      amount:      order.amount,
      currency:    order.currency,
      keyId:       process.env.RAZORPAY_KEY_ID,
      jobId:       job.id,
      paymentId:   payment.id,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/payments/webhook ───────────────────────────────────────────────
// Razorpay sends payment events here. We verify HMAC and update job status.
router.post('/webhook', async (req, res, next) => {
  try {
    // 1. Verify HMAC signature
    const signature  = req.headers['x-razorpay-signature'];
    const bodyString = req.body.toString('utf8'); // raw body (set up in index.js)
    const expected   = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(bodyString)
      .digest('hex');

    if (signature !== expected) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const event   = JSON.parse(bodyString);
    const payload = event.payload?.payment?.entity;

    if (!payload) return res.status(200).json({ received: true });

    const orderId   = payload.order_id;
    const paymentId = payload.id;

    // 2. Handle payment.captured (successful payment)
    if (event.event === 'payment.captured') {
      // Update payment record
      await pool.query(
        `UPDATE payments
         SET status = 'paid', razorpay_payment_id = $1, webhook_payload = $2
         WHERE razorpay_order_id = $3`,
        [paymentId, event, orderId]
      );

      // Get the job linked to this payment
      const { rows } = await pool.query(
        `SELECT j.id, j.college_id FROM jobs j
         JOIN payments p ON p.id = j.payment_id
         WHERE p.razorpay_order_id = $1`,
        [orderId]
      );

      const job = rows[0];
      if (job) {
        // Transition job: pending_payment → payment_confirmed → queued
        await updateJobStatus(job.id, 'payment_confirmed');
        await updateJobStatus(job.id, 'queued', { queued_at: new Date() });

        // Emit real-time update via Socket.IO
        const io = req.app.get('io');
        if (io) {
          io.to(`job:${job.id}`).emit('job:status', {
            jobId:  job.id,
            status: 'queued',
          });
        }
      }
    }

    // 3. Handle payment.failed
    if (event.event === 'payment.failed') {
      await pool.query(
        `UPDATE payments SET status = 'failed', webhook_payload = $1
         WHERE razorpay_order_id = $2`,
        [event, orderId]
      );
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/payments/status/:orderId ───────────────────────────────────────
router.get('/status/:orderId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, j.id AS job_id, j.status AS job_status, j.qr_token
       FROM payments p
       LEFT JOIN jobs j ON j.payment_id = p.id
       WHERE p.razorpay_order_id = $1 AND p.college_id = $2`,
      [req.params.orderId, req.admin.collegeId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Payment not found.' });
    return res.json({ payment: rows[0] });
  } catch (err) {
    next(err);
  }
});

// ─── Helper: update job status + append to status_history ────────────────────
async function updateJobStatus(jobId, newStatus, extraFields = {}) {
  const extra = Object.keys(extraFields)
    .map((k, i) => `, ${k} = $${i + 3}`)
    .join('');
  const values = [newStatus, jobId, ...Object.values(extraFields)];

  await pool.query(
    `UPDATE jobs
     SET status = $1,
         status_history = status_history || jsonb_build_object(
           'status', $1,
           'at', NOW()::text
         ),
         updated_at = NOW()
         ${extra}
     WHERE id = $2`,
    values
  );
}

module.exports = router;