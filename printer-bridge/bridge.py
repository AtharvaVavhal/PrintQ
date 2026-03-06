"""
PrintQ Printer Bridge
─────────────────────
Runs on the machine physically connected to the printer (Raspberry Pi / Mini PC).

Responsibilities:
  1. Heartbeat  — pings the API every HEARTBEAT_INTERVAL seconds so the
                  admin dashboard shows the printer as online.
  2. Queue poll — polls for queued jobs every POLL_INTERVAL seconds.
  3. QR scan    — listens for QR codes from a USB HID scanner and validates
                  them against the API before dispatching a print job.
  4. CUPS print — downloads the file and submits it to the local CUPS printer.
  5. Status     — reports printing / completed / failed back to the API so
                  the student portal and admin dashboard stay in sync.

Environment variables (set in .env):
  API_BASE_URL               — e.g. http://localhost:4000/api
  BRIDGE_SECRET              — shared secret, must match backend BRIDGE_SECRET
  PRINTER_ID                 — UUID of this printer in the PrintQ DB
  CUPS_PRINTER_NAME          — CUPS printer name (run `lpstat -a` to find it)
  POLL_INTERVAL_SECONDS      — how often to poll the queue (default: 5)
  HEARTBEAT_INTERVAL_SECONDS — how often to send heartbeat (default: 30)
  DOWNLOAD_DIR               — temp dir for downloaded files (default: /tmp/printq)
  QR_DEVICE                  — serial port for USB scanner e.g. /dev/ttyUSB0
                               (omit to use stdin for testing)
"""

import os
import sys
import time
import json
import logging
import threading
import subprocess
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('printq-bridge')

# ─── Config ───────────────────────────────────────────────────────────────────
API_BASE     = os.getenv('API_BASE_URL', 'http://localhost:4000/api').rstrip('/')
SECRET       = os.getenv('BRIDGE_SECRET', '')
PRINTER_ID   = os.getenv('PRINTER_ID', '')
CUPS_NAME    = os.getenv('CUPS_PRINTER_NAME', '')
POLL_INT     = int(os.getenv('POLL_INTERVAL_SECONDS', '5'))
HB_INT       = int(os.getenv('HEARTBEAT_INTERVAL_SECONDS', '30'))
DOWNLOAD_DIR = Path(os.getenv('DOWNLOAD_DIR', '/tmp/printq'))

HEADERS = {
    'Content-Type': 'application/json',
    'X-Bridge-Secret': SECRET,
}

DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

_in_progress: set = set()
_lock = threading.Lock()


# ─── API helpers ──────────────────────────────────────────────────────────────

def api_post(path: str, payload: dict) -> dict:
    url = f'{API_BASE}{path}'
    try:
        r = requests.post(url, json=payload, headers=HEADERS, timeout=10)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.HTTPError as e:
        log.error(f'API POST {path} -> HTTP {e.response.status_code}: {e.response.text}')
        return {}
    except Exception as e:
        log.error(f'API POST {path} failed: {e}')
        return {}


def api_get(path: str) -> dict:
    url = f'{API_BASE}{path}'
    try:
        r = requests.get(url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.HTTPError as e:
        log.error(f'API GET {path} -> HTTP {e.response.status_code}: {e.response.text}')
        return {}
    except Exception as e:
        log.error(f'API GET {path} failed: {e}')
        return {}


def report_status(job_id: str, status: str, error: str = None):
    payload = {'jobId': job_id, 'status': status}
    if error:
        payload['error'] = error
    result = api_post('/bridge/job-status', payload)
    if result.get('ok'):
        log.info(f'[{job_id[:8]}] Status -> {status}')
    else:
        log.warning(f'[{job_id[:8]}] Failed to report status {status}: {result}')


# ─── Heartbeat ────────────────────────────────────────────────────────────────

def send_heartbeat():
    try:
        r = requests.post(
            f'{API_BASE}/printers/{PRINTER_ID}/heartbeat',
            json={'status': 'online'},
            headers=HEADERS,
            timeout=5,
        )
        if r.status_code == 200:
            log.debug('Heartbeat OK')
        else:
            log.warning(f'Heartbeat returned {r.status_code}')
    except Exception as e:
        log.error(f'Heartbeat failed: {e}')


def heartbeat_loop():
    while True:
        send_heartbeat()
        time.sleep(HB_INT)


# ─── Queue polling ────────────────────────────────────────────────────────────

def poll_queue() -> list:
    data = api_get(f'/printers/{PRINTER_ID}/queue')
    jobs = data.get('jobs', [])
    if jobs:
        log.info(f'Queue: {len(jobs)} job(s) waiting')
    return jobs


# ─── File download ────────────────────────────────────────────────────────────

def download_job_file(job_id: str, filename: str):
    url  = f'{API_BASE}/bridge/download/{job_id}'
    dest = DOWNLOAD_DIR / filename
    try:
        r = requests.get(url, headers=HEADERS, timeout=30, stream=True)
        r.raise_for_status()
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
        log.info(f'[{job_id[:8]}] Downloaded -> {dest}')
        return dest
    except Exception as e:
        log.error(f'[{job_id[:8]}] Download failed: {e}')
        return None


# ─── CUPS dispatch ────────────────────────────────────────────────────────────

def build_lp_options(settings: dict) -> list:
    opts = []
    opts += ['-n', str(int(settings.get('copies', 1)))]
    if settings.get('duplex'):
        opts += ['-o', 'sides=two-sided-long-edge']
    else:
        opts += ['-o', 'sides=one-sided']
    if settings.get('color'):
        opts += ['-o', 'ColorModel=RGB']
    else:
        opts += ['-o', 'ColorModel=Gray']
    paper = settings.get('paper_size', 'A4').lower()
    opts += ['-o', f'media={paper}']
    if settings.get('orientation') == 'landscape':
        opts += ['-o', 'landscape']
    return opts


def print_file(job_id: str, file_path: Path, settings: dict) -> bool:
    if not CUPS_NAME:
        log.error('CUPS_PRINTER_NAME is not set — cannot print.')
        return False
    if not file_path.exists():
        log.error(f'[{job_id[:8]}] File not found: {file_path}')
        return False

    cmd = ['lp', '-d', CUPS_NAME] + build_lp_options(settings) + ['--', str(file_path)]
    log.info(f'[{job_id[:8]}] CUPS: {" ".join(cmd)}')

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            log.info(f'[{job_id[:8]}] CUPS accepted: {result.stdout.strip()}')
            return True
        else:
            log.error(f'[{job_id[:8]}] CUPS error: {result.stderr.strip()}')
            return False
    except subprocess.TimeoutExpired:
        log.error(f'[{job_id[:8]}] CUPS timed out')
        return False
    except FileNotFoundError:
        log.error('`lp` not found. Is CUPS installed?')
        return False
    except Exception as e:
        log.error(f'[{job_id[:8]}] CUPS exception: {e}')
        return False


def cleanup_file(file_path):
    try:
        if file_path and Path(file_path).exists():
            Path(file_path).unlink()
    except Exception as e:
        log.warning(f'Cleanup failed: {e}')


# ─── Job processing ───────────────────────────────────────────────────────────

def process_job(job: dict):
    job_id   = job['id']
    filename = job.get('storedFilename') or job.get('stored_filename', f'{job_id}.pdf')
    settings = job.get('settings', {})

    with _lock:
        if job_id in _in_progress:
            return
        _in_progress.add(job_id)

    file_path = None
    try:
        file_path = download_job_file(job_id, filename)
        if not file_path:
            report_status(job_id, 'failed', 'File download failed')
            return

        report_status(job_id, 'printing')

        success = print_file(job_id, file_path, settings)

        if success:
            report_status(job_id, 'completed')
        else:
            report_status(job_id, 'failed', 'CUPS print submission failed')

    except Exception as e:
        log.error(f'[{job_id[:8]}] Unexpected error: {e}')
        report_status(job_id, 'failed', str(e))
    finally:
        cleanup_file(file_path)
        with _lock:
            _in_progress.discard(job_id)


# ─── QR scan listener ─────────────────────────────────────────────────────────

def validate_and_print_qr(qr_data: str):
    log.info(f'QR scanned: {qr_data[:40]}')
    try:
        parsed   = json.loads(qr_data)
        qr_token = parsed.get('qrToken') or parsed.get('qr_token')
    except (json.JSONDecodeError, AttributeError):
        qr_token = qr_data.strip()

    if not qr_token:
        log.warning('QR scan produced no usable token')
        return

    result = api_post('/bridge/validate-qr', {
        'qrToken':   qr_token,
        'printerId': PRINTER_ID,
    })

    if not result.get('valid'):
        log.warning(f'QR validation failed: {result.get("error", "unknown")}')
        return

    job = result.get('job')
    if not job:
        log.error('validate-qr returned valid=true but no job data')
        return

    log.info(f'[{job["id"][:8]}] QR validated — dispatching')
    threading.Thread(target=process_job, args=(job,), daemon=True).start()


def qr_scanner_loop():
    device = os.getenv('QR_DEVICE', '')
    if device:
        try:
            import serial
            log.info(f'QR scanner on {device}')
            with serial.Serial(device, baudrate=9600, timeout=1) as ser:
                while True:
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    if line:
                        validate_and_print_qr(line)
        except ImportError:
            log.error('pyserial not installed. Run: pip install pyserial')
        except Exception as e:
            log.error(f'QR scanner error: {e}')
    else:
        log.info('QR_DEVICE not set — reading from stdin (test mode)')
        for line in sys.stdin:
            line = line.strip()
            if line:
                validate_and_print_qr(line)


# ─── Startup validation ───────────────────────────────────────────────────────

def validate_config():
    missing = []
    if not SECRET:     missing.append('BRIDGE_SECRET')
    if not PRINTER_ID: missing.append('PRINTER_ID')
    if missing:
        log.error(f'Missing required env vars: {", ".join(missing)}')
        sys.exit(1)
    if not CUPS_NAME:
        log.warning('CUPS_PRINTER_NAME not set — CUPS printing will be skipped')


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    validate_config()

    log.info('=' * 50)
    log.info('  PrintQ Bridge starting')
    log.info(f'  Printer ID : {PRINTER_ID}')
    log.info(f'  API Base   : {API_BASE}')
    log.info(f'  CUPS Name  : {CUPS_NAME or "(not set)"}')
    log.info(f'  Poll every : {POLL_INT}s  |  Heartbeat every: {HB_INT}s')
    log.info('=' * 50)

    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=qr_scanner_loop, daemon=True).start()

    log.info('Bridge running. Press Ctrl+C to stop.')
    try:
        while True:
            jobs = poll_queue()
            for job in jobs:
                with _lock:
                    already = job['id'] in _in_progress
                if not already:
                    log.info(f'[{job["id"][:8]}] Dispatching: {job.get("originalFilename", "?")}')
                    threading.Thread(target=process_job, args=(job,), daemon=True).start()
            time.sleep(POLL_INT)
    except KeyboardInterrupt:
        log.info('Bridge stopped.')