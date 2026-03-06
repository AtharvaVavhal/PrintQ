# PrintQ 🖨️
### QR-Based College Printing System

A full-stack, production-grade college printing platform where students upload documents, pay via Razorpay, receive a QR code, and scan it at the printer to collect their printout — all in real time.

---

## Architecture

```
printq/
├── backend/          → Node.js + Express + Socket.IO (API Server)
├── frontend/         → React 18 + Vite (Admin Dashboard)
├── student-portal/   → Vanilla HTML/CSS/JS PWA (Student Interface)
├── printer-bridge/   → Python 3 (Windows Printer Bridge)
├── database/         → PostgreSQL Migrations
└── nginx/            → Reverse Proxy Config
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | Node.js, Express 5, Socket.IO |
| Database | PostgreSQL 16, PgBouncer, Redis |
| Payments | Razorpay (Orders, Webhooks, Refunds) |
| Admin Dashboard | React 18, Vite, Recharts, TanStack Query |
| Student Portal | Vanilla HTML/CSS/JS PWA, jsQR |
| Printer Bridge | Python 3, pywin32, BullMQ |
| Auth | JWT (15min access + 7-day refresh, httpOnly cookie) |
| File Upload | Multer (PDF/DOCX only, UUID-renamed) |

---

## Database Schema

### Tables
- **jobs** — UUID PK, 8-stage status enum, JSONB settings, unique QR token, FK → printers + payments
- **payments** — UUID PK, Razorpay order/payment IDs, amount in paise
- **printers** — UUID PK, status enum (online/offline/busy/error), JSONB capabilities, heartbeat
- **admins** — UUID PK, role enum (superadmin/admin/operator), bcrypt password hash

### Job Status Flow
```
pending_payment → payment_confirmed → queued → processing → printing → completed
                                                                      ↘ failed → refunded
```

---

## Key API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check (DB + Redis) |
| POST | `/api/auth/login` | Admin login |
| POST | `/api/auth/refresh` | Refresh JWT |
| POST | `/api/jobs/upload` | Upload PDF, get cost preview |
| POST | `/api/payments/create-order` | Create Razorpay order |
| POST | `/api/payments/webhook` | HMAC-verified webhook |
| PATCH | `/api/jobs/:id/status` | Bridge updates job status |
| GET | `/api/printers/:id/queue` | Bridge polls for jobs |
| POST | `/api/printers/:id/heartbeat` | Bridge heartbeat |

---

## Security

- Parameterized SQL queries (no string concatenation)
- Helmet CSP + express-validator sanitization
- HMAC-SHA256 Razorpay webhook verification
- Rate limiting: 100 req/15min global, 10 req/15min on auth routes
- File whitelist: `.pdf` and `.docx` only, UUID-renamed on disk
- JWT: 15min access token + 7-day refresh token in httpOnly cookie
- `college_id` scoping on all DB queries (multi-tenant)

---

## Prerequisites

- Node.js 20+
- Python 3.10+
- PostgreSQL 16+
- Redis 7+
- (Printer Bridge only) Windows + pywin32

---

## Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/yourname/printq.git
cd printq
```

### 2. Backend setup

```bash
cd backend
cp .env.example .env       # Fill in your credentials
npm install
```

### 3. Database setup

```bash
# Create DB and user
psql postgres -c "CREATE USER printq_user WITH PASSWORD 'your_password';"
psql postgres -c "CREATE DATABASE printq OWNER printq_user;"

# Run migration
psql -U printq_user -d printq -f database/migrations/001_initial_schema.sql
```

### 4. Start services

```bash
# Redis
brew services start redis        # macOS
# or
redis-server                     # Linux

# Backend (development)
cd backend && npm run dev

# Admin Dashboard (development)
cd frontend && npm run dev
```

### 5. Verify

```bash
curl http://localhost:4000/api/health
# Expected: {"status":"ok","database":"ok","redis":"ok"}
```

---

## Environment Variables

### Backend (`backend/.env`)

```env
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173
STUDENT_PORTAL_URL=http://localhost:3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=printq
DB_USER=printq_user
DB_PASSWORD=your_password

REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=your_access_secret_min_32_chars
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=50

PRICE_BW_SINGLE=150
PRICE_BW_DOUBLE=100
PRICE_COLOR_SINGLE=500
PRICE_COLOR_DOUBLE=400

DEFAULT_COLLEGE_ID=col_default
```

### Printer Bridge (`printer-bridge/.env`)

```env
API_BASE_URL=http://localhost:4000/api
BRIDGE_SECRET=your_bridge_api_key
PRINTER_ID=uuid_from_printers_table
POLL_INTERVAL_SECONDS=5
HEARTBEAT_INTERVAL_SECONDS=30
```

---

## Pricing

All prices are in **paise** (1 INR = 100 paise).

| Type | Per Page |
|---|---|
| Black & White — Single Side | ₹1.50 |
| Black & White — Double Side | ₹1.00 |
| Color — Single Side | ₹5.00 |
| Color — Double Side | ₹4.00 |

---

## Build Plan

| Day | What's Built |
|---|---|
| Day 1 ✅ | Project setup, PostgreSQL schema, Redis, Express server |
| Day 2 | JWT auth, file upload (Multer), input validation |
| Day 3 | Job upload endpoint, page count extraction, cost calculation |
| Day 4 | Razorpay payments, webhook HMAC verification, refunds |
| Day 5–6 | Student PWA — upload, payment modal, QR scanner, real-time status |
| Day 7–8 | Admin Dashboard — queue management, Recharts analytics, live updates |
| Day 9 | Python printer bridge — polling, pywin32 spooler, NSSM Windows service |
| Day 10 | PM2 cluster, Nginx reverse proxy, SSL (Certbot), security audit |

---

## Printer Bridge (Windows)

The printer bridge runs as a Windows service (via NSSM) and:
1. Polls the API every 5 seconds for queued jobs
2. Downloads the file
3. Sends to Windows print spooler via `pywin32`
4. Updates job status in real time via API
5. Sends a heartbeat every 30 seconds

```bash
# Install dependencies (Windows)
pip install requests python-dotenv schedule pywin32

# Run
python bridge.py
```

---

## Production Deployment

```
Internet → Nginx (SSL/TLS) → PM2 Cluster (Node.js) → PgBouncer → PostgreSQL
                                                    → Redis
                           → Student Portal (static)
                           → Admin Dashboard (static)
Windows Machine → Printer Bridge → Windows Print Spooler
```

---

## License

MIT
