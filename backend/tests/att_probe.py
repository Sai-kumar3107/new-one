"""Probe current attendance state (who already checked in today) before running iteration-5 tests."""
import os
import requests

API = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
for email, pw in [("orgadmin@skyline.com", "Admin@123"), ("orgadmin@zenith.com", "Admin@123")]:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    print(email, r.status_code)
    t = r.json()["token"]
    h = {"Authorization": f"Bearer {t}"}
    d = requests.get(f"{API}/attendance/daily", headers=h, timeout=30).json()
    print(d.get("date"), d.get("counts"), "pending", d.get("pending_exceptions"))
    for row in d.get("rows", []):
        print("  ", row["user"]["email"], row["status"])
    print(requests.get(f"{API}/attendance/settings", headers=h, timeout=30).json())
    print([ (e["user_name"], e["kind"], e["status"]) for e in requests.get(f"{API}/attendance/exceptions", headers=h, timeout=30).json()][:10])
