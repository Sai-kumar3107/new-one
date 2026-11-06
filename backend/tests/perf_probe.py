"""Latency probe for key read endpoints (run: python perf_probe.py)."""
import os
import time

import requests

API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
CREDS = {"org_admin": ("orgadmin@skyline.com", "Admin@123"), "sales_exec": ("sales1@skyline.com", "Sales@123"),
         "finance": ("finance@skyline.com", "Finance@123"), "channel_partner": ("partner@skyline.com", "Partner@123")}
t0 = time.time(); requests.get(f"{API}/health", timeout=30); print("health", round((time.time() - t0) * 1000), "ms")
for role, (e, p) in CREDS.items():
    t0 = time.time()
    tok = requests.post(f"{API}/auth/login", json={"email": e, "password": p}, timeout=30).json()["token"]
    login_ms = round((time.time() - t0) * 1000)
    h = {"Authorization": f"Bearer {tok}"}
    res = {"login": login_ms}
    for path in ("/dashboard", "/projects", "/leads"):
        ts = []
        for _ in range(3):
            t0 = time.time(); r = requests.get(f"{API}{path}", headers=h, timeout=40); ts.append(round((time.time() - t0) * 1000))
        res[path] = f"{r.status_code} {min(ts)}-{max(ts)}ms"
    print(role, res)
