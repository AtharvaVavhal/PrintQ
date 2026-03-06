import os
import time
import logging
import requests
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s %(message)s')

API_BASE   = os.getenv("API_BASE_URL", "http://localhost:4000/api")
SECRET     = os.getenv("BRIDGE_SECRET")
PRINTER_ID = os.getenv("PRINTER_ID")

HEADERS = {
    "Content-Type": "application/json",
    "X-Bridge-Secret": SECRET,
}

def heartbeat():
    try:
        r = requests.post(f"{API_BASE}/printers/{PRINTER_ID}/heartbeat", headers=HEADERS, timeout=5)
        logging.info(f"Heartbeat: {r.status_code}")
    except Exception as e:
        logging.error(f"Heartbeat failed: {e}")

def poll_queue():
    try:
        r = requests.get(f"{API_BASE}/printers/{PRINTER_ID}/queue", headers=HEADERS, timeout=5)
        jobs = r.json().get("jobs", [])
        logging.info(f"Queue poll: {len(jobs)} job(s)")
        return jobs
    except Exception as e:
        logging.error(f"Poll failed: {e}")
        return []

if __name__ == "__main__":
    logging.info(f"PrintQ Bridge starting — Printer: {PRINTER_ID}")
    while True:
        heartbeat()
        poll_queue()
        time.sleep(int(os.getenv("POLL_INTERVAL_SECONDS", 5)))