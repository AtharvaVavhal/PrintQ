<div align="center">

# 🖨️ PrintQ

### QR-Based College Printing System

*Upload. Pay. Scan. Print.*

[![Status](https://img.shields.io/badge/Status-Under%20Development-orange?style=flat-square)](https://github.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue?style=flat-square&logo=postgresql)](https://postgresql.org)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](https://react.dev)
[![Python](https://img.shields.io/badge/Python-3.11%2B-yellow?style=flat-square&logo=python)](https://python.org)

</div>

---

## 📋 Table of Contents

- [Description](#-description)
- [Project Status](#-project-status)
- [Architecture Overview](#-architecture-overview)
- [Tech Stack](#-tech-stack)
- [System Architecture Diagram](#-system-architecture-diagram)
- [Database Schema](#-database-schema)
- [Job Status Flow](#-job-status-flow)
- [API Endpoints](#-api-endpoints)
- [Security Features](#-security-features)
- [Prerequisites](#-prerequisites)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Pricing Model](#-pricing-model)
- [Printer Bridge](#-printer-bridge)
- [Production Deployment](#-production-deployment)
- [License](#-license)

---

## 📖 Description

**PrintQ** is a modern, QR-code-driven college printing platform that eliminates queues, cash handling, and manual document submission. Students upload their documents through a Progressive Web App (PWA), pay online via Razorpay, and receive a unique QR code. When they arrive at the printer, they simply scan the QR code to release their printout — no staff intervention required.

**Key Benefits:**

- 🚫 No cash handling — fully digital payments via Razorpay
- 📱 Mobile-first PWA — works on any device, no app installation needed
- 🔒 Secure document storage with per-job expiry
- 📊 Admin dashboard for real-time monitoring and printer management
- ⚡ Real-time job status updates via Socket.IO
- 🖨️ Seamless hardware integration via the Python Printer Bridge service

---

## 🚧 Project Status

> **⚠️ This project is currently under active development.**

| Module | Status |
|---|---|
| `backend` — Node.js API Server | 🟡 In Progress |
| `frontend` — React Admin Dashboard | 🟡 In Progress |
| `student-portal` — PWA Interface | 🟡 In Progress |
| `printer-bridge` — Python Printer Service | 🟠 Early Stage |
| `database` — PostgreSQL Migrations | 🟢 Stable |
| `nginx` — Reverse Proxy Config | 🟢 Stable |

Features may change, APIs may break between commits, and production deployment is not yet recommended.

---

## 🏗️ Architecture Overview

PrintQ is organized as a multi-service monorepo. Each subdirectory is a self-contained service:

```
printq/
├── backend/            # Node.js + Express REST API & WebSocket server
├── frontend/           # React + Vite admin dashboard
├── student-portal/     # React PWA for students (upload, pay, track)
├── printer-bridge/     # Python service that interfaces with physical printers
├── database/           # PostgreSQL migration scripts & seed data
└── nginx/              # Reverse proxy configuration for production
```

The system is designed so that all student-facing and admin-facing traffic is routed through Nginx, which distributes requests to the appropriate backend service. The Printer Bridge runs independently on the printer hardware/local network and communicates with the backend over a secure, authenticated WebSocket channel.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **API Server** | Node.js + Express | REST API, business logic, job management |
| **Real-time** | Socket.IO | Live print job status updates |
| **Auth** | JWT (JSON Web Tokens) | Stateless authentication for students & admins |
| **File Uploads** | Multer | Multipart form handling for document uploads |
| **Payments** | Razorpay | Online payment gateway integration |
| **Database** | PostgreSQL 15 | Primary relational data store |
| **Cache / Queue** | Redis | Session cache, print job queue, rate limiting |
| **Admin UI** | React 18 + Vite | Admin dashboard for monitoring & management |
| **Student UI** | React PWA + Vite | Student-facing upload & tracking interface |
| **Printer Service** | Python 3.11 | Hardware-level printer communication |
| **Reverse Proxy** | Nginx | TLS termination, routing, static file serving |
| **Containerization** | Docker + Compose | Local development & production deployment |

---

## 📐 System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                          INTERNET / USERS                          │
└─────────────────────────────┬──────────────────────────────────────┘
                              │  HTTPS (443)
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                          NGINX (Reverse Proxy)                     │
│                                                                    │
│   /api/*  ──────────────►  backend:3000                            │
│   /admin/* ─────────────►  frontend:5173 (React Build)             │
│   /*  ──────────────────►  student-portal:5174 (PWA Build)         │
└─────────────┬──────────────────────┬──────────────────────────────┘
              │                      │
              ▼                      ▼
┌─────────────────────┐   ┌──────────────────────┐
│   BACKEND (Node.js) │   │  STUDENT PORTAL (PWA) │
│   Express REST API  │   │  React + Vite         │
│   Socket.IO Server  │   │  Service Worker       │
└────────┬────────────┘   └──────────────────────┘
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
┌─────────────────────┐             ┌──────────────────────┐
│   PostgreSQL (DB)   │             │   Redis (Cache/Queue) │
│   - Users           │             │   - Print job queue   │
│   - Print Jobs      │             │   - Session tokens    │
│   - Transactions    │             │   - Rate limiter      │
│   - QR Tokens       │             └──────────────────────┘
└─────────────────────┘
         │
         │  WebSocket (Authenticated)
         │
         ▼
┌────────────────────────────────────────────────────────────────────┐
│                     LOCAL PRINTER NETWORK                          │
│                                                                    │
│   ┌──────────────────────────────────────────────────┐             │
│   │         PRINTER BRIDGE (Python Service)          │             │
│   │   - Polls backend for queued jobs                │             │
│   │   - Validates QR token on scan                   │             │
│   │   - Sends job to physical printer via CUPS/IPP   │             │
│   └──────────────────┬───────────────────────────────┘             │
│                      │                                             │
│           ┌──────────┴──────────┐                                  │
│           ▼                     ▼                                  │
│   ┌───────────────┐    ┌───────────────┐                           │
│   │   Printer A   │    │   Printer B   │  (expandable)             │
│   │  (CUPS/IPP)   │    │  (CUPS/IPP)   │                           │
│   └───────────────┘    └───────────────┘                           │
└────────────────────────────────────────────────────────────────────┘
         │
         ▼  Razorpay Webhook (HTTPS)
┌─────────────────────┐
│   RAZORPAY GATEWAY  │
│   (External)        │
└─────────────────────┘
```

---

## 🗄️ Database Schema

The PostgreSQL database is structured around five primary tables:

### `users`
Stores student and admin accounts. Students register with their college email; admins are seeded manually.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Unique user identifier |
| `name` | VARCHAR | Full name |
| `email` | VARCHAR (UNIQUE) | College email address |
| `password_hash` | TEXT | bcrypt-hashed password |
| `role` | ENUM | `student` or `admin` |
| `created_at` | TIMESTAMP | Account creation time |

### `print_jobs`
The core table. Each row represents a single print request from upload to completion.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Unique job identifier |
| `user_id` | UUID (FK → users) | Owning student |
| `filename` | TEXT | Stored filename on disk/S3 |
| `original_name` | TEXT | Original uploaded filename |
| `pages` | INT | Number of pages |
| `copies` | INT | Number of copies requested |
| `color` | BOOLEAN | Color or B&W |
| `duplex` | BOOLEAN | Single or double-sided |
| `paper_size` | ENUM | `A4`, `A3`, `Letter` |
| `status` | ENUM | See Job Status Flow below |
| `amount` | NUMERIC(10,2) | Total charged amount (INR) |
| `created_at` | TIMESTAMP | Upload timestamp |
| `expires_at` | TIMESTAMP | QR code expiry time |

### `transactions`
Tracks payment lifecycle for each job, linked to Razorpay.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Transaction ID |
| `job_id` | UUID (FK → print_jobs) | Associated print job |
| `razorpay_order_id` | TEXT | Razorpay order reference |
| `razorpay_payment_id` | TEXT | Razorpay payment reference |
| `status` | ENUM | `pending`, `paid`, `failed`, `refunded` |
| `paid_at` | TIMESTAMP | Payment completion time |

### `qr_tokens`
One-time QR tokens issued per job after payment confirmation.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Token ID |
| `job_id` | UUID (FK → print_jobs) | Linked print job |
| `token` | TEXT (UNIQUE) | Signed, hashed token value |
| `used` | BOOLEAN | Whether the token has been consumed |
| `used_at` | TIMESTAMP | Scan timestamp |
| `expires_at` | TIMESTAMP | Token hard expiry |

### `printers`
Registry of all printer hardware managed by the system.

| Column | Type | Description |
|---|---|---|
| `id` | UUID (PK) | Printer ID |
| `name` | VARCHAR | Human-readable name (e.g., "Block A - Printer 1") |
| `location` | TEXT | Physical location description |
| `ip_address` | INET | Printer's IP on LAN |
| `status` | ENUM | `online`, `offline`, `busy`, `error` |
| `last_heartbeat` | TIMESTAMP | Last ping from Printer Bridge |

---

## 🔄 Job Status Flow

A print job transitions through the following states from creation to completion:

```
  ┌──────────┐
  │  UPLOAD  │  Student uploads document
  └────┬─────┘
       │
       ▼
  ┌──────────┐
  │ PENDING  │  Job created, awaiting payment
  └────┬─────┘
       │  Payment initiated via Razorpay
       ▼
  ┌──────────┐
  │  PAYING  │  Payment in progress
  └────┬─────┘
       │
       ├─────────────────────────────────────┐
       │ Payment success                     │ Payment failed/timeout
       ▼                                     ▼
  ┌──────────┐                          ┌──────────┐
  │   PAID   │  QR code generated       │  FAILED  │  Job cancelled
  └────┬─────┘                          └──────────┘
       │  Student scans QR at printer
       ▼
  ┌──────────┐
  │ PRINTING │  Printer Bridge sends job to printer
  └────┬─────┘
       │
       ├─────────────────────────────────────┐
       │ Print success                       │ Printer error
       ▼                                     ▼
  ┌──────────┐                          ┌──────────┐
  │COMPLETED │  Job archived            │  ERROR   │  Admin notified
  └──────────┘                          └──────────┘
       │
       │  After expiry_at (e.g., 24h) with no scan
       ▼
  ┌──────────┐
  │ EXPIRED  │  QR invalidated, refund triggered
  └──────────┘
```

> All status transitions emit real-time events via **Socket.IO** to the student portal and admin dashboard.

---

## 🔌 API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | None | Register new student account |
| `POST` | `/api/auth/login` | None | Login and receive JWT |
| `POST` | `/api/auth/logout` | JWT | Invalidate session |
| `GET` | `/api/auth/me` | JWT | Get current user profile |

### Print Jobs

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/jobs` | JWT (Student) | Upload document and create print job |
| `GET` | `/api/jobs` | JWT (Student) | List all jobs for the authenticated student |
| `GET` | `/api/jobs/:id` | JWT (Student) | Get details of a specific job |
| `DELETE` | `/api/jobs/:id` | JWT (Student) | Cancel a pending (unpaid) job |
| `GET` | `/api/jobs/:id/qr` | JWT (Student) | Retrieve QR code image for a paid job |

### Payments

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/payments/create-order` | JWT (Student) | Create a Razorpay order for a job |
| `POST` | `/api/payments/verify` | JWT (Student) | Verify Razorpay payment signature |
| `POST` | `/api/payments/webhook` | HMAC Signature | Razorpay webhook for async confirmation |

### Printer Bridge (Internal)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/bridge/validate-qr` | Bridge API Key | Validate a scanned QR token |
| `POST` | `/api/bridge/job-status` | Bridge API Key | Update job status from printer hardware |
| `GET` | `/api/bridge/pending-jobs` | Bridge API Key | Fetch jobs queued for a specific printer |
| `POST` | `/api/bridge/heartbeat` | Bridge API Key | Printer health/status ping |

### Admin

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/admin/jobs` | JWT (Admin) | List all jobs with filters & pagination |
| `GET` | `/api/admin/users` | JWT (Admin) | List all registered students |
| `GET` | `/api/admin/printers` | JWT (Admin) | List all printers and their status |
| `PUT` | `/api/admin/printers/:id` | JWT (Admin) | Update printer details |
| `GET` | `/api/admin/analytics` | JWT (Admin) | Revenue, job counts, and usage stats |
| `POST` | `/api/admin/refund/:jobId` | JWT (Admin) | Trigger a manual refund |

---

## 🔐 Security Features

| Feature | Implementation |
|---|---|
| **Authentication** | Stateless JWT with short expiry (15 min access + 7 day refresh) |
| **Password Hashing** | bcrypt with cost factor 12 |
| **QR Token Security** | Cryptographically signed, single-use, time-limited (24h default) |
| **Payment Verification** | Razorpay HMAC-SHA256 signature validation on every webhook |
| **File Validation** | Multer + file-type library; only PDF/DOCX accepted; max 25MB |
| **File Isolation** | Documents stored with UUID-based names, not original filenames |
| **Rate Limiting** | Redis-backed rate limiter on all public endpoints |
| **Bridge Authentication** | Long-lived API key with IP allowlist for Printer Bridge |
| **Input Sanitization** | express-validator on all request bodies |
| **HTTPS Enforcement** | Nginx enforces TLS; HTTP redirects to HTTPS |
| **CORS Policy** | Strict CORS origin whitelist for API server |
| **SQL Injection** | Parameterized queries via node-postgres (`pg`) |
| **Secrets Management** | All secrets via environment variables; never hardcoded |

---

## ✅ Prerequisites

Ensure the following are installed before setting up PrintQ:

- **Node.js** `>= 18.x` and **npm** `>= 9.x`
- **Python** `>= 3.11` and **pip**
- **PostgreSQL** `>= 15`
- **Redis** `>= 7`
- **Docker** and **Docker Compose** (recommended for local dev)
- A **Razorpay** account with API keys (Test mode for development)
- **CUPS** installed on the printer host machine (for `printer-bridge`)

---

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/printq.git
cd printq
```

### 2. Start Infrastructure (Docker)

```bash
docker compose up -d postgres redis
```

This starts PostgreSQL and Redis as Docker containers. Skip this if you have them running natively.

### 3. Run Database Migrations

```bash
cd database
psql -U postgres -d printq -f migrations/001_create_users.sql
psql -U postgres -d printq -f migrations/002_create_print_jobs.sql
psql -U postgres -d printq -f migrations/003_create_transactions.sql
psql -U postgres -d printq -f migrations/004_create_qr_tokens.sql
psql -U postgres -d printq -f migrations/005_create_printers.sql
```

Or run the seed script for development data:

```bash
psql -U postgres -d printq -f seeds/dev_seed.sql
```

### 4. Configure Environment Variables

Copy the example `.env` files for each service:

```bash
cp backend/.env.example backend/.env
cp student-portal/.env.example student-portal/.env
cp frontend/.env.example frontend/.env
cp printer-bridge/.env.example printer-bridge/.env
```

Edit each `.env` file with your local configuration. See [Environment Variables](#-environment-variables) below.

### 5. Start the Backend

```bash
cd backend
npm install
npm run dev
```

The API server will start on `http://localhost:3000`.

### 6. Start the Student Portal

```bash
cd student-portal
npm install
npm run dev
```

Available at `http://localhost:5174`.

### 7. Start the Admin Dashboard

```bash
cd frontend
npm install
npm run dev
```

Available at `http://localhost:5173`.

### 8. Start the Printer Bridge (Optional for local dev)

```bash
cd printer-bridge
pip install -r requirements.txt
python main.py
```

> **Note:** The Printer Bridge requires a physical printer accessible via CUPS/IPP on your local network. For development, you can use a virtual PDF printer.

---

## ⚙️ Environment Variables

### `backend/.env.example`

```env
# Server
NODE_ENV=development
PORT=3000

# PostgreSQL
DATABASE_URL=postgresql://postgres:password@localhost:5432/printq

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_REFRESH_EXPIRES_IN=7d

# Razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_secret_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here

# File Storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=25

# Printer Bridge
BRIDGE_API_KEY=a_long_random_secret_for_the_bridge_service

# QR Token
QR_TOKEN_EXPIRY_HOURS=24

# CORS
CORS_ORIGIN=http://localhost:5173,http://localhost:5174
```

### `student-portal/.env.example`

```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
```

### `frontend/.env.example`

```env
VITE_API_BASE_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
```

### `printer-bridge/.env.example`

```env
PRINTQ_API_BASE_URL=http://localhost:3000
BRIDGE_API_KEY=a_long_random_secret_for_the_bridge_service
PRINTER_NAME=PrintQ_Printer_A
PRINTER_IP=192.168.1.100
POLL_INTERVAL_SECONDS=5
```

---

## 💰 Pricing Model

PrintQ uses a simple, configurable per-page pricing model. Prices are stored in the backend configuration and applied at job creation time.

| Print Type | Price per Page |
|---|---|
| **B&W — Single-sided (A4)** | ₹1.00 |
| **B&W — Double-sided (A4)** | ₹1.50 |
| **Color — Single-sided (A4)** | ₹5.00 |
| **Color — Double-sided (A4)** | ₹8.00 |
| **A3 (B&W)** | ₹3.00 |
| **A3 (Color)** | ₹12.00 |

**Calculation formula:**

```
total_amount = base_price_per_page × pages × copies
```

> Pricing values are configurable in `backend/src/config/pricing.js`. Admins can update pricing via the admin dashboard without redeployment.

**Minimum charge:** ₹2.00 per job (to cover payment gateway fees).

**Refund Policy:** Jobs that expire without being scanned (after 24 hours) are automatically flagged for refund processing. Full refunds are issued back to the original payment method via Razorpay.

---

## 🖨️ Printer Bridge

The **Printer Bridge** is a lightweight Python service that acts as the hardware integration layer between the PrintQ backend and physical printers on the campus network.

### How It Works

1. **Polling:** The bridge polls `GET /api/bridge/pending-jobs` every N seconds (configurable) to check for queued jobs assigned to its printer.
2. **QR Validation:** When a student scans their QR code at the printer's scanner (connected to the bridge host), the bridge calls `POST /api/bridge/validate-qr` to verify the token is authentic, unused, and not expired.
3. **Job Dispatch:** Upon successful validation, the bridge downloads the print document from the backend and submits it to the local printer using **CUPS (Common Unix Printing System)** via the `subprocess` module or the `cups` Python library.
4. **Status Reporting:** As the CUPS job progresses, the bridge reports status changes (`PRINTING`, `COMPLETED`, `ERROR`) back to the backend via `POST /api/bridge/job-status`.
5. **Heartbeat:** Every 30 seconds, the bridge sends a heartbeat to `POST /api/bridge/heartbeat`, updating the printer's `last_heartbeat` timestamp and status (`online`, `busy`, `error`).

### Printer Bridge Architecture

```
┌──────────────────────────────────────────────────────┐
│               PRINTER BRIDGE HOST                    │
│  (Raspberry Pi / Mini PC connected to printer)       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │           printer-bridge (Python)              │  │
│  │                                                │  │
│  │  ┌──────────────┐    ┌──────────────────────┐  │  │
│  │  │ Poll Loop    │    │  QR Scanner Listener  │  │  │
│  │  │ (every 5s)   │    │  (USB HID / Serial)   │  │  │
│  │  └──────┬───────┘    └──────────┬────────────┘  │  │
│  │         │                       │               │  │
│  │         ▼                       ▼               │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │         PrintQ API Client                │  │  │
│  │  │  validate-qr / job-status / heartbeat    │  │  │
│  │  └──────────────────┬───────────────────────┘  │  │
│  │                     │                           │  │
│  │                     ▼                           │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │         CUPS Job Dispatcher              │  │  │
│  │  │  lp / lpr / python-cups                  │  │  │
│  │  └──────────────────┬───────────────────────┘  │  │
│  └─────────────────────│───────────────────────────┘  │
│                        │                              │
│                        ▼                              │
│              ┌──────────────────┐                     │
│              │  Physical Printer │                    │
│              │  (USB / Network)  │                    │
│              └──────────────────┘                     │
└──────────────────────────────────────────────────────┘
```

### Supported Printer Protocols

- **IPP** (Internet Printing Protocol) — recommended
- **LPD/LPR** (Line Printer Daemon)
- **USB** direct connection via CUPS

---

## 🏭 Production Deployment Architecture

For production, PrintQ is deployed using Docker Compose with Nginx as the edge server.

```
                        ┌────────────────────────────────────┐
  Internet  ──HTTPS──►  │        Nginx (Edge Server)         │
                        │  TLS termination, rate limiting    │
                        │  Static file serving               │
                        └───────────────┬────────────────────┘
                                        │
               ┌────────────────────────┼────────────────────────┐
               │                        │                        │
               ▼                        ▼                        ▼
   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ backend (Node.js) │    │   frontend       │    │ student-portal   │
   │ Docker container  │    │  (React build)   │    │  (PWA build)     │
   │ Port: 3000        │    │  Served by Nginx  │    │  Served by Nginx  │
   └────────┬─────────┘    └──────────────────┘    └──────────────────┘
            │
            ├──────────────────┐
            │                  │
            ▼                  ▼
  ┌──────────────────┐  ┌──────────────────┐
  │   PostgreSQL      │  │      Redis        │
  │  Docker volume    │  │  Docker volume    │
  └──────────────────┘  └──────────────────┘
            │
            │  Secure WS/HTTPS
            ▼
  ┌──────────────────────────────────────────┐
  │     Printer Bridge (Campus Network)      │
  │     Runs on-site, connects to API        │
  └──────────────────────────────────────────┘
```

### Quick Production Deployment

```bash
# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Run migrations against production DB
docker compose exec backend npm run migrate

# Check service health
docker compose ps
```

### Recommended Production Stack

| Component | Recommendation |
|---|---|
| **Server** | Ubuntu 22.04 LTS, 2 vCPU, 4GB RAM minimum |
| **Database Backups** | Automated daily pg_dump to S3-compatible storage |
| **File Storage** | AWS S3 or Cloudflare R2 for uploaded documents |
| **Process Manager** | Docker Compose with restart policies |
| **SSL Certificate** | Let's Encrypt via Certbot or Nginx proxy manager |
| **Monitoring** | Prometheus + Grafana, or Uptime Kuma |
| **Log Aggregation** | Winston (backend) → file rotation or Loki |

---

## 📄 License

```
MIT License

Copyright (c) 2026 Atharva Vavhal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">

Made with ❤️ by [Atharva Vavhal](https://github.com/atharvavavhal)

*PrintQ — Smarter printing for smarter campuses.*

</div>
