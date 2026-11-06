"""RCortexa iteration 5: (A) subscription visibility restricted to org_admin, (B) attendance with live photo capture,
exceptions, admin dashboard/corrections/export/settings, photo link security, (C) inventory regression spot-checks.
Run serially:  pytest tests/test_iteration5_attendance_subscription.py -n 0
Users consumed for attendance today: sales1 (check-in/out + correction), sales2 (location on + deactivation photo test),
finance (exception approve/reject), sales@zenith (cross-org). orgadmin@skyline left un-checked-in for UI testing."""
from __future__ import annotations

import asyncio
import csv
import io
import os
import random
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
RUN = f"{int(time.time()) % 100000}"
S: dict = {}
CREDS = {"admin": ("orgadmin@skyline.com", "Admin@123"), "sales1": ("sales1@skyline.com", "Sales@123"),
         "sales2": ("sales2@skyline.com", "Sales@123"), "finance": ("finance@skyline.com", "Finance@123"),
         "partner": ("partner@skyline.com", "Partner@123"), "zadmin": ("orgadmin@zenith.com", "Admin@123"),
         "zsales": ("sales@zenith.com", "Sales@123"), "global": ("admin@rcortexa.com", "Admin@123")}
BILLING = {"plan", "seats", "renewal_date"}


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def login(k):
    e, p = CREDS[k]
    r = requests.post(f"{API}/auth/login", json={"email": e, "password": p}, timeout=30)
    assert r.status_code == 200, f"{e}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def L():
    return {k: login(k) for k in CREDS}


@pytest.fixture(scope="module")
def T(L):
    return {k: v["token"] for k, v in L.items()}


def jpeg(size=(320, 240)):
    img = Image.effect_noise(size, 60).convert("RGB")
    b = io.BytesIO(); img.save(b, "JPEG", quality=85); data = b.getvalue()
    assert len(data) >= 1024
    return data


def checkin(tok, kind="check-in", capture="camera", data=None, ctype="image/jpeg", **extra):
    return requests.post(f"{API}/attendance/{kind}", files={"photo": ("p.jpg", data if data is not None else jpeg(), ctype)},
                         data={"capture": capture, **extra}, headers=H(tok), timeout=60)


def set_active(email, active: bool):
    """No team-management API yet -> toggle via DB directly (always re-activated in teardown)."""
    load_dotenv("/app/backend/.env")
    import sys
    sys.path.insert(0, "/app/backend")
    import db

    async def go():
        try:
            await db.execute("update users set is_active = $2 where email = $1", email, active)
        finally:
            await db.close()
    asyncio.run(go())


# ---------------- A: subscription visibility ----------------
class TestSubscription:
    def test_login_org_billing_only_admin(self, L):
        assert BILLING <= set(L["admin"]["org"].keys()), L["admin"]["org"].keys()
        for k in ("sales1", "finance", "partner"):
            assert not (BILLING & set(L[k]["org"].keys())), (k, L[k]["org"].keys())

    def test_me_and_dashboard_strip_billing(self, T):
        for k in ("admin", "sales1", "finance", "partner"):
            me = requests.get(f"{API}/auth/me", headers=H(T[k]), timeout=30).json()
            dash = requests.get(f"{API}/dashboard", headers=H(T[k]), timeout=30)
            assert dash.status_code == 200, (k, dash.text)
            orgs = [me.get("org") or {}, dash.json().get("org") or {}]
            for o in orgs:
                if k == "admin":
                    assert BILLING <= set(o.keys()), (k, o.keys())
                else:
                    assert not (BILLING & set(o.keys())), (k, o.keys())

    def test_subscription_get_rbac(self, T):
        r = requests.get(f"{API}/org/subscription", headers=H(T["admin"]), timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["org"]["plan"] and j["plan"]["id"] == j["org"]["plan"] and isinstance(j["plans"], list) and len(j["plans"]) >= 3
        assert isinstance(j["usage"]["seats"], int) and "seat_limit" in j["usage"] and isinstance(j["usage"]["projects"], int)
        assert isinstance(j["history"], list)
        S["plan"] = j["org"]["plan"]; S["org_id"] = j["org"]["id"]
        for k in ("sales1", "finance", "partner"):
            assert requests.get(f"{API}/org/subscription", headers=H(T[k]), timeout=30).status_code == 403, k
        assert requests.get(f"{API}/org/subscription", timeout=30).status_code == 401

    def test_plan_request(self, T):
        other = "growth" if S["plan"] != "growth" else "enterprise"
        r = requests.post(f"{API}/org/subscription/request", json={"plan": other, "note": f"TEST_ {RUN}"}, headers=H(T["admin"]), timeout=30)
        assert r.status_code == 200 and r.json()["ok"] is True, r.text
        same = requests.post(f"{API}/org/subscription/request", json={"plan": S["plan"]}, headers=H(T["admin"]), timeout=30)
        assert same.status_code == 400
        for k in ("sales1", "finance", "partner"):
            assert requests.post(f"{API}/org/subscription/request", json={"plan": other}, headers=H(T[k]), timeout=30).status_code == 403
        hist = requests.get(f"{API}/org/subscription", headers=H(T["admin"]), timeout=30).json()["history"]
        assert any(h["action"] == "plan_request" and f"TEST_ {RUN}" in (h["detail"] or "") for h in hist)

    def test_global_admin_plan_change_roundtrip(self, T):
        ov = requests.get(f"{API}/admin/overview", headers=H(T["global"]), timeout=30)
        assert ov.status_code == 200, ov.text
        new = "enterprise" if S["plan"] != "enterprise" else "growth"
        p = requests.patch(f"{API}/admin/orgs/{S['org_id']}", json={"plan": new}, headers=H(T["global"]), timeout=30)
        assert p.status_code == 200, p.text
        try:
            assert requests.get(f"{API}/org/subscription", headers=H(T["admin"]), timeout=30).json()["org"]["plan"] == new
        finally:
            requests.patch(f"{API}/admin/orgs/{S['org_id']}", json={"plan": S["plan"]}, headers=H(T["global"]), timeout=30)
        assert requests.get(f"{API}/org/subscription", headers=H(T["admin"]), timeout=30).json()["org"]["plan"] == S["plan"]


# ---------------- B: attendance ----------------
class TestAttendanceEmployee:
    def test_partner_forbidden(self, T):
        p = T["partner"]
        assert requests.get(f"{API}/attendance/me", headers=H(p), timeout=30).status_code == 403
        assert checkin(p).status_code == 403
        assert checkin(p, "check-out").status_code == 403
        assert requests.post(f"{API}/attendance/exceptions", json={"kind": "check_in", "reason": "camera broke"}, headers=H(p), timeout=30).status_code == 403

    def test_validation_before_checkin(self, T):
        t = T["sales1"]
        assert checkin(t, capture="upload").status_code == 400
        assert checkin(t, data=b"hello world" * 200, ctype="text/plain").status_code == 400
        assert checkin(t, data=b"\xff\xd8tiny").status_code == 400  # < 1KB
        assert checkin(T["zadmin"], "check-out").status_code == 409  # never checked in

    def test_location_ignored_when_disabled(self, T):
        s = requests.patch(f"{API}/attendance/settings", json={"location_enabled": False}, headers=H(T["admin"]), timeout=30)
        assert s.status_code == 200 and s.json()["location_enabled"] is False
        before = datetime.now(timezone.utc) - timedelta(seconds=60)
        r = checkin(T["sales1"], lat="19.07", lng="72.87")
        assert r.status_code == 200, r.text
        j = r.json(); S["rec1"] = j
        assert j["status"] == "open" and j["check_in_lat"] is None and j["check_in_lng"] is None
        assert datetime.fromisoformat(j["check_in_at"].replace("Z", "+00:00")) >= before
        assert j["check_in_photo_url"].startswith(f"/api/attendance/{j['id']}/photo/check_in?t=")
        assert "check_in_photo" not in j
        assert checkin(T["sales1"]).status_code == 409

    def test_me_endpoint(self, T):
        j = requests.get(f"{API}/attendance/me", headers=H(T["sales1"]), timeout=30).json()
        assert j["record"]["id"] == S["rec1"]["id"] and j["record"]["status"] == "open"
        assert any(h["id"] == S["rec1"]["id"] for h in j["history"])
        assert isinstance(j["exceptions"], list) and j["location_enabled"] is False and j["retention_days"] == 90

    def test_check_out(self, T):
        r = checkin(T["sales1"], "check-out")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "present" and isinstance(j["duration_minutes"], int) and j["check_out_photo_url"]
        assert checkin(T["sales1"], "check-out").status_code == 409

    def test_photo_access(self, T):
        url = S["rec1"]["check_in_photo_url"]
        r = requests.get(BASE_URL + url, timeout=30)
        assert r.status_code == 200 and r.content[:2] == b"\xff\xd8", (r.status_code, r.text[:200])
        tampered = url[:-4] + ("AAAA" if not url.endswith("AAAA") else "BBBB")
        assert requests.get(BASE_URL + tampered, timeout=30).status_code == 401
        # admin-minted link
        recs = requests.get(f"{API}/attendance/records", params={"user_id": S["rec1"]["user_id"]}, headers=H(T["admin"]), timeout=30).json()
        adm = next(x for x in recs if x["id"] == S["rec1"]["id"])
        assert requests.get(BASE_URL + adm["check_in_photo_url"], timeout=30).status_code == 200
        # wrong-typ token (att_export) rejected
        ex = requests.post(f"{API}/attendance/export-link", params={"month": "2026-01"}, headers=H(T["admin"]), timeout=30).json()["url"]
        tok = ex.split("t=")[1]
        assert requests.get(f"{API}/attendance/{S['rec1']['id']}/photo/check_in", params={"t": tok}, timeout=30).status_code == 401

    def test_location_and_deactivated_viewer(self, T):
        s = requests.patch(f"{API}/attendance/settings", json={"location_enabled": True}, headers=H(T["admin"]), timeout=30)
        assert s.status_code == 200 and s.json()["location_enabled"] is True
        try:
            r = checkin(T["sales2"], lat="19.0760", lng="72.8777")
            assert r.status_code == 200, r.text
            j = r.json(); S["rec2"] = j
            assert abs(j["check_in_lat"] - 19.076) < 1e-6 and abs(j["check_in_lng"] - 72.8777) < 1e-6
            bad = checkin(T["sales2"], "check-out", lat="200", lng="0")
            assert bad.status_code == 400
        finally:
            requests.patch(f"{API}/attendance/settings", json={"location_enabled": False}, headers=H(T["admin"]), timeout=30)
        url = BASE_URL + S["rec2"]["check_in_photo_url"]
        assert requests.get(url, timeout=30).status_code == 200
        set_active("sales2@skyline.com", False)
        try:
            assert requests.get(url, timeout=30).status_code == 404
        finally:
            set_active("sales2@skyline.com", True)
        assert requests.get(url, timeout=30).status_code == 200

    def test_cross_org_photo_and_records(self, T):
        z = checkin(T["zsales"])
        assert z.status_code in (200, 409), z.text
        zr = requests.get(f"{API}/attendance/records", headers=H(T["zadmin"]), timeout=30).json()
        assert all(r["id"] != S["rec1"]["id"] for r in zr)
        assert requests.get(f"{API}/attendance/{S['rec1']['id']}/detail", headers=H(T["zadmin"]), timeout=30).status_code == 404
        assert requests.post(f"{API}/attendance/{S['rec1']['id']}/correct", json={"reason": "cross org try"}, headers=H(T["zadmin"]), timeout=30).status_code == 404
        if zr:  # zenith admin's photo token cannot open a Skyline record
            ztok = zr[0]["check_in_photo_url"].split("t=")[1]
            assert requests.get(f"{API}/attendance/{S['rec1']['id']}/photo/check_in", params={"t": ztok}, timeout=30).status_code == 404


class TestAttendanceAdmin:
    def test_sales_forbidden_admin(self, T):
        t = T["sales1"]
        for path in ("/attendance/daily", "/attendance/monthly?month=2026-01", "/attendance/records", "/attendance/exceptions", "/attendance/settings",
                     f"/attendance/{S['rec1']['id']}/detail"):
            assert requests.get(API + path, headers=H(t), timeout=30).status_code == 403, path
        assert requests.post(f"{API}/attendance/{S['rec2']['id']}/correct", json={"reason": "self edit attempt"}, headers=H(t), timeout=30).status_code == 403
        assert requests.post(f"{API}/attendance/export-link?month=2026-01", headers=H(t), timeout=30).status_code == 403
        assert requests.patch(f"{API}/attendance/settings", json={"retention_days": 30}, headers=H(T["finance"]), timeout=30).status_code == 403

    def test_daily_and_monthly(self, T):
        d = requests.get(f"{API}/attendance/daily", headers=H(T["admin"]), timeout=30).json()
        S["today"] = d["today"]
        st = {r["user"]["email"]: r["status"] for r in d["rows"]}
        assert st["sales1@skyline.com"] == "present" and st["sales2@skyline.com"] == "open", st
        assert sum(d["counts"].values()) == len(d["rows"])
        assert all("password_hash" not in r["user"] for r in d["rows"])
        past = requests.get(f"{API}/attendance/daily", params={"day": "2025-01-01"}, headers=H(T["admin"]), timeout=30).json()
        assert all(r["status"] == "absent" for r in past["rows"])
        m = requests.get(f"{API}/attendance/monthly", params={"month": S["today"][:7]}, headers=H(T["admin"]), timeout=30)
        assert m.status_code == 200
        s1 = next(r for r in m.json()["rows"] if r["name"] and r["user_id"] == S["rec1"]["user_id"])
        assert s1["present"] >= 1 and s1["days_recorded"] >= 1
        assert requests.get(f"{API}/attendance/monthly", params={"month": "2026-1"}, headers=H(T["admin"]), timeout=30).status_code == 422

    def test_records_filter(self, T):
        r = requests.get(f"{API}/attendance/records", params={"status": "open"}, headers=H(T["admin"]), timeout=30).json()
        assert any(x["id"] == S["rec2"]["id"] for x in r) and all(x["status"] == "open" for x in r)

    def test_correction_validation_and_history(self, T):
        a, rid = T["admin"], S["rec1"]["id"]
        url = f"{API}/attendance/{rid}/correct"
        nowu = datetime.now(timezone.utc)
        assert requests.post(url, json={"check_in_at": nowu.isoformat()}, headers=H(a), timeout=30).status_code == 422
        assert requests.post(url, json={"reason": "abc"}, headers=H(a), timeout=30).status_code == 422
        bad = requests.post(url, json={"check_in_at": (nowu - timedelta(hours=1)).isoformat(), "check_out_at": (nowu - timedelta(hours=2)).isoformat(),
                                       "reason": "order test"}, headers=H(a), timeout=30)
        assert bad.status_code == 400
        fut = requests.post(url, json={"check_out_at": (nowu + timedelta(hours=2)).isoformat(), "reason": "future test"}, headers=H(a), timeout=30)
        assert fut.status_code == 400
        cin, cout = nowu - timedelta(minutes=150), nowu - timedelta(minutes=30)
        ok = requests.post(url, json={"check_in_at": cin.isoformat(), "check_out_at": cout.isoformat(), "reason": f"TEST_ forgot {RUN}"}, headers=H(a), timeout=30)
        assert ok.status_code == 200, ok.text
        assert ok.json()["status"] == "corrected" and ok.json()["duration_minutes"] == 120
        det = requests.get(f"{API}/attendance/{rid}/detail", headers=H(a), timeout=30).json()
        c = det["corrections"][0]
        assert c["reason"] == f"TEST_ forgot {RUN}" and c["before"]["status"] == "present" and c["after"]["status"] == "corrected"

    def test_export_csv(self, T):
        r = requests.post(f"{API}/attendance/export-link", params={"month": S["today"][:7]}, headers=H(T["admin"]), timeout=30)
        assert r.status_code == 200
        dl = requests.get(BASE_URL + r.json()["url"], timeout=30)
        assert dl.status_code == 200 and "text/csv" in dl.headers["content-type"]
        txt = dl.content.decode("utf-8-sig")
        assert txt.startswith("Summary") and "Employee,Role,Present days" in txt and "Arjun Sharma" in txt
        assert requests.get(f"{API}/attendance/export", params={"t": "garbage"}, timeout=30).status_code == 401

    def test_settings(self, T):
        a = T["admin"]
        assert requests.patch(f"{API}/attendance/settings", json={"retention_days": 6}, headers=H(a), timeout=30).status_code == 422
        assert requests.patch(f"{API}/attendance/settings", json={"retention_days": 3651}, headers=H(a), timeout=30).status_code == 422
        assert requests.patch(f"{API}/attendance/settings", json={}, headers=H(a), timeout=30).status_code == 400
        r = requests.patch(f"{API}/attendance/settings", json={"retention_days": 30}, headers=H(a), timeout=30)
        assert r.status_code == 200 and r.json()["retention_days"] == 30
        r = requests.patch(f"{API}/attendance/settings", json={"retention_days": 90}, headers=H(a), timeout=30)
        assert r.json()["retention_days"] == 90 and requests.get(f"{API}/attendance/settings", headers=H(a), timeout=30).json()["retention_days"] == 90


class TestExceptions:
    def test_request_duplicate_approve(self, T):
        f, a = T["finance"], T["admin"]
        assert requests.post(f"{API}/attendance/exceptions", json={"kind": "check_in", "reason": "abc"}, headers=H(f), timeout=30).status_code == 422
        r = requests.post(f"{API}/attendance/exceptions", json={"kind": "check_in", "reason": f"TEST_ camera broken {RUN}"}, headers=H(f), timeout=30)
        assert r.status_code == 200, r.text
        ex = r.json(); assert ex["status"] == "pending"
        assert requests.post(f"{API}/attendance/exceptions", json={"kind": "check_in", "reason": "again please"}, headers=H(f), timeout=30).status_code == 409
        pend = requests.get(f"{API}/attendance/exceptions", params={"status": "pending"}, headers=H(a), timeout=30).json()
        assert any(x["id"] == ex["id"] for x in pend)
        d = requests.post(f"{API}/attendance/exceptions/{ex['id']}/decide", json={"approve": True, "note": "ok"}, headers=H(a), timeout=30)
        assert d.status_code == 200, d.text
        assert requests.post(f"{API}/attendance/exceptions/{ex['id']}/decide", json={"approve": True}, headers=H(a), timeout=30).status_code == 404
        me = requests.get(f"{API}/attendance/me", headers=H(f), timeout=30).json()
        assert me["record"] and me["record"]["source"] == "exception" and me["record"]["status"] == "open"
        assert checkin(f).status_code == 409

    def test_reject(self, T):
        f, a = T["finance"], T["admin"]
        r = requests.post(f"{API}/attendance/exceptions", json={"kind": "check_out", "reason": f"TEST_ reject me {RUN}"}, headers=H(f), timeout=30)
        assert r.status_code == 200, r.text
        d = requests.post(f"{API}/attendance/exceptions/{r.json()['id']}/decide", json={"approve": False, "note": "no"}, headers=H(a), timeout=30)
        assert d.status_code == 200
        rej = requests.get(f"{API}/attendance/exceptions", params={"status": "rejected"}, headers=H(a), timeout=30).json()
        assert any(x["id"] == r.json()["id"] for x in rej)
        assert requests.get(f"{API}/attendance/me", headers=H(f), timeout=30).json()["record"]["status"] == "open"


# ---------------- C: regression spot-checks ----------------
class TestRegression:
    def test_project_search_wildcards_literal(self, T):
        a = T["admin"]
        allp = requests.get(f"{API}/projects", headers=H(a), timeout=30).json()
        assert len(allp) > 0
        for q in ("%", "_", "%%__"):
            r = requests.get(f"{API}/projects", params={"q": q}, headers=H(a), timeout=30)
            assert r.status_code == 200
            assert all(q in (p.get("name", "") + (p.get("location") or "") + (p.get("city") or "") + (p.get("rera") or "")) for p in r.json()), q

    def test_import_reserved_row_skipped(self, T):
        a = T["admin"]
        target = None
        for p in requests.get(f"{API}/projects", headers=H(a), timeout=30).json():
            units = requests.get(f"{API}/projects/{p['id']}/units", headers=H(a), timeout=30).json()["units"]
            locked = [u for u in units if u["status"] in ("reserved", "sold")]
            if locked:
                target = (p["id"], locked[0]); break
        if not target:
            pytest.skip("no reserved/sold unit in seed")
        pid, u = target
        s = io.StringIO(); w = csv.writer(s)
        w.writerow(("tower", "floor", "unit_no", "bhk", "carpet_area", "facing", "base_price", "status"))
        w.writerow((u["tower"], u.get("floor") or 1, u["unit_no"], u.get("bhk") or 2, u.get("carpet_area") or 1000, "East", u.get("base_price") or 5000000, u["status"]))
        r = requests.post(f"{API}/projects/{pid}/units/import", files={"file": ("x.csv", s.getvalue().encode())}, data={"dry_run": "true"}, headers=H(a), timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["error_count"] == 0 and len(j["skipped"]) == 1, j

    def test_closed_won_edit_keeps_100(self, T):
        a = T["admin"]
        ph = "9" + "".join(random.choices("0123456789", k=9))
        lead = requests.post(f"{API}/leads", json={"name": f"TEST_It5 Won {RUN}", "phone": ph, "bhk": 2}, headers=H(a), timeout=30).json()
        assert requests.patch(f"{API}/leads/{lead['id']}", json={"stage": "closed_won"}, headers=H(a), timeout=30).status_code == 200
        assert requests.patch(f"{API}/leads/{lead['id']}", json={"bhk": 3, "notes": "edit"}, headers=H(a), timeout=30).status_code == 200
        ld = requests.get(f"{API}/leads/{lead['id']}", headers=H(a), timeout=30).json()["lead"]
        assert ld["score"] == 100, ld["score"]
        requests.patch(f"{API}/leads/{lead['id']}", json={"stage": "negotiation"}, headers=H(a), timeout=30)
        ld = requests.get(f"{API}/leads/{lead['id']}", headers=H(a), timeout=30).json()["lead"]
        assert ld["score"] < 100, ld["score"]
