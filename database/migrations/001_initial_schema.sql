-- PostgreSQL 14+
-- Run as: psql -U printq_user -d printq -f 001_initial_schema.sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── ENUMS ────────────────────────────────────────────────────────────────────

CREATE TYPE job_status AS ENUM (
  'pending_payment',   -- Job created, awaiting payment
  'payment_confirmed', -- Razorpay webhook received
  'queued',            -- In printer queue
  'processing',        -- Printer bridge picked it up
  'printing',          -- Sent to Windows spooler
  'completed',         -- Successfully printed
  'failed',            -- Print failed
  'refunded'           -- Payment refunded
);

CREATE TYPE printer_status AS ENUM (
  'online',
  'offline',
  'busy',
  'error'
);

CREATE TYPE admin_role AS ENUM (
  'superadmin',
  'admin',
  'operator'
);

CREATE TYPE payment_status AS ENUM (
  'created',
  'paid',
  'failed',
  'refunded'
);

-- ─── TABLES ───────────────────────────────────────────────────────────────────

-- Printers (defined before jobs since jobs FK → printers)
CREATE TABLE printers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id       TEXT NOT NULL,
  name             TEXT NOT NULL,
  location         TEXT,
  status           printer_status NOT NULL DEFAULT 'offline',
  capabilities     JSONB NOT NULL DEFAULT '{
    "color": false,
    "duplex": true,
    "max_pages": 100,
    "paper_sizes": ["A4", "Letter"]
  }'::jsonb,
  last_heartbeat   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id            TEXT NOT NULL,
  razorpay_order_id     TEXT UNIQUE NOT NULL,
  razorpay_payment_id   TEXT UNIQUE,
  amount_paise          INTEGER NOT NULL CHECK (amount_paise > 0),
  currency              TEXT NOT NULL DEFAULT 'INR',
  status                payment_status NOT NULL DEFAULT 'created',
  webhook_payload       JSONB,
  refund_id             TEXT,
  refunded_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Print Jobs (core table)
CREATE TABLE jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id        TEXT NOT NULL,
  student_email     TEXT NOT NULL,
  student_name      TEXT,

  -- File info
  original_filename TEXT NOT NULL,
  stored_filename   TEXT NOT NULL,  -- UUID-renamed, e.g. "a3f1...uuid.pdf"
  file_size_bytes   INTEGER NOT NULL,
  page_count        INTEGER NOT NULL CHECK (page_count > 0),

  -- Print settings (validated at upload time)
  settings          JSONB NOT NULL DEFAULT '{
    "copies": 1,
    "color": false,
    "duplex": false,
    "paper_size": "A4",
    "orientation": "portrait"
  }'::jsonb,

  -- Pricing (GENERATED: calculated from settings + page_count)
  -- Stored as paise (1 INR = 100 paise)
  amount_paise      INTEGER NOT NULL CHECK (amount_paise > 0),

  -- Status tracking
  status            job_status NOT NULL DEFAULT 'pending_payment',
  status_history    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- QR token for printer bridge to look up this job
  qr_token          TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),

  -- Foreign keys
  printer_id        UUID REFERENCES printers(id) ON DELETE SET NULL,
  payment_id        UUID REFERENCES payments(id) ON DELETE SET NULL,

  -- Timestamps
  queued_at         TIMESTAMPTZ,
  printed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_settings CHECK (
    (settings->>'copies')::int >= 1 AND
    (settings->>'copies')::int <= 20
  )
);

-- Admins
CREATE TABLE admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id     TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           admin_role NOT NULL DEFAULT 'operator',
  printer_id     UUID REFERENCES printers(id) ON DELETE SET NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (college_id, email)
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────

-- Jobs: most queries filter by college_id + status
CREATE INDEX idx_jobs_college_status   ON jobs(college_id, status);
CREATE INDEX idx_jobs_qr_token         ON jobs(qr_token);
CREATE INDEX idx_jobs_printer_id       ON jobs(printer_id) WHERE printer_id IS NOT NULL;
CREATE INDEX idx_jobs_student_email    ON jobs(college_id, student_email);
CREATE INDEX idx_jobs_created_at       ON jobs(created_at DESC);

-- Payments
CREATE INDEX idx_payments_college      ON payments(college_id);
CREATE INDEX idx_payments_order_id     ON payments(razorpay_order_id);

-- Printers
CREATE INDEX idx_printers_college      ON printers(college_id);
CREATE INDEX idx_printers_status       ON printers(college_id, status);

-- Admins
CREATE INDEX idx_admins_email          ON admins(college_id, email);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_printers_updated_at
  BEFORE UPDATE ON printers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_admins_updated_at
  BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── SEED: Default printer for development ────────────────────────────────────

INSERT INTO printers (college_id, name, location, status, capabilities)
VALUES (
  'col_default',
  'Main Library Printer',
  'Library - Ground Floor',
  'offline',
  '{"color": true, "duplex": true, "max_pages": 100, "paper_sizes": ["A4", "Letter", "A3"]}'
);