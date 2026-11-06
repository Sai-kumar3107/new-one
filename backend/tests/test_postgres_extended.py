"""RCortexa extended regression (Postgres/Supabase migration, iteration 2).

Covers: health/docs, signup duplicate email, cross-tenant units, buyer masking for finance,
unit filters, CP lead -> book -> commission -> approve/paid, block toggle, site visits,
partners PATCH, users list/create + seat limit (in a fresh TEST org), notifications, audit,
suspended org /auth/me 403.
"""
from __future__ import annotations

import os
import random
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    return r.json()


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def T():
    creds = {
        "global": ("admin@rcortexa.com", "Admin@123"),
        "admin": ("orgadmin@skyline.com", "Admin@123"),
        "finance": ("finance@skyline.com", "Finance@123"),
        "sales1": ("sales1@skyline.com", "Sales@123"),
        "partner": ("partner@skyline.com", "Partner@123"),
        "zadmin": ("orgadmin@zenith.com", "Admin@123"),
    }
    return {k: _login(*v) for k, v in creds.items()}


def _phone():
    return f"9{random.randint(100000000, 999999999)}"


# ---- health / docs
class TestHealthDocs:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=20)
        assert r.status_code == 200 and r.json()["db"] is True and "ai_enabled" in r.json()

    def test_docs_and_openapi(self):
        assert requests.get(f"{API}/docs", timeout=20).status_code == 200
        o = requests.get(f"{API}/openapi.json", timeout=20)
        assert o.status_code == 200 and "/api/leads" in o.json()["paths"]

    def test_unauth_401(self):
        assert requests.get(f"{API}/leads", timeout=15).status_code == 401


# ---- auth extras
class TestAuthExtra:
    def test_partner_signup_duplicate_email_409(self):
        r = requests.post(f"{API}/auth/partner-signup", json={"name": "Dup", "email": "partner@skyline.com", "password": "Partner@123",
                                                             "phone": _phone(), "agency": "TEST", "rera_id": "", "org_code": "SKYLINE"}, timeout=20)
        assert r.status_code == 409, r.text

    def test_partner_signup_bad_org_code(self):
        r = requests.post(f"{API}/auth/partner-signup", json={"name": "X", "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com", "password": "Partner@123",
                                                             "phone": _phone(), "agency": "TEST", "rera_id": "", "org_code": "NOPE999"}, timeout=20)
        assert r.status_code in (400, 404), r.text


# ---- tenant + masking
class TestTenantUnits:
    def test_cross_tenant_unit_404_and_finance_sees_buyer(self, T):
        tok = T["admin"]["token"]
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=15).json()[0]["id"]
        units = requests.get(f"{API}/projects/{pid}/units", headers=H(tok), timeout=15).json()["units"]
        uid = units[0]["id"]
        assert requests.get(f"{API}/units/{uid}", headers=H(T["zadmin"]["token"]), timeout=15).status_code == 404
        assert requests.get(f"{API}/projects/{pid}/units", headers=H(T["zadmin"]["token"]), timeout=15).status_code == 404
        sold = [u for u in units if u["status"] in ("sold", "reserved") and u.get("buyer_name")]
        if sold:
            f = requests.get(f"{API}/units/{sold[0]['id']}", headers=H(T["finance"]["token"]), timeout=15).json()
            assert f.get("buyer_name"), "finance should see buyer_name"

    def test_unit_filters_tower_facing(self, T):
        tok = T["admin"]["token"]
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=15).json()[0]["id"]
        allu = requests.get(f"{API}/projects/{pid}/units", headers=H(tok), timeout=15).json()["units"]
        tower, facing = allu[0]["tower"], allu[0]["facing"]
        r = requests.get(f"{API}/projects/{pid}/units", params={"tower": tower, "facing": facing}, headers=H(tok), timeout=15).json()["units"]
        assert r and all(u["tower"] == tower and u["facing"] == facing for u in r)

    def test_search_ilike(self, T):
        tok = T["admin"]["token"]
        items = requests.get(f"{API}/leads", headers=H(tok), timeout=15).json()["items"]
        name = items[0]["name"]
        q = name[:3].lower()
        r = requests.get(f"{API}/leads", params={"q": q}, headers=H(tok), timeout=15).json()["items"]
        assert any(x["id"] == items[0]["id"] for x in r)


# ---- CP lead -> booking -> commission -> approve -> paid
class TestBookingCommission:
    state: dict = {}

    def test_cp_create_lead_locked(self, T):
        r = requests.post(f"{API}/leads", json={"name": "TEST CP Buyer", "phone": _phone(), "bhk": 2},
                          headers=H(T["partner"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead["cp_user_id"] == T["partner"]["user"]["id"] and lead["locked"] is True and lead["source"] == "channel_partner"
        TestBookingCommission.state["lead"] = lead

    def test_book_creates_commission(self, T):
        tok = T["admin"]["token"]
        lead = self.state["lead"]
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=15).json()[0]["id"]
        avail = requests.get(f"{API}/projects/{pid}/units", params={"status": "available"}, headers=H(tok), timeout=15).json()["units"]
        uid = avail[0]["id"]
        r = requests.post(f"{API}/units/{uid}/book", json={"lead_id": lead["id"]}, headers=H(tok), timeout=25)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "sold"
        g = requests.get(f"{API}/leads/{lead['id']}", headers=H(tok), timeout=15).json()
        assert g["lead"]["stage"] == "closed_won"
        # second booking attempt -> 409
        assert requests.post(f"{API}/units/{uid}/book", json={"lead_id": lead["id"]}, headers=H(tok), timeout=15).status_code == 409
        com = requests.get(f"{API}/commissions", headers=H(T["finance"]["token"]), timeout=15).json()["items"]
        mine = [c for c in com if c["lead_id"] == lead["id"]]
        assert mine and mine[0]["status"] == "pending" and mine[0]["amount"] > 0
        TestBookingCommission.state["cid"] = mine[0]["id"]
        pc = requests.get(f"{API}/commissions", headers=H(T["partner"]["token"]), timeout=15).json()["items"]
        assert any(c["id"] == mine[0]["id"] for c in pc)

    def test_commission_approve_paid(self, T):
        cid = self.state["cid"]
        for st in ("approved", "paid"):
            r = requests.patch(f"{API}/commissions/{cid}", json={"status": st}, headers=H(T["finance"]["token"]), timeout=15)
            assert r.status_code == 200 and r.json()["status"] == st, r.text
        assert requests.patch(f"{API}/commissions/{cid}", json={"status": "paid"}, headers=H(T["sales1"]["token"]), timeout=15).status_code == 403

    def test_block_toggle_admin(self, T):
        tok = T["admin"]["token"]
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=15).json()[0]["id"]
        uid = requests.get(f"{API}/projects/{pid}/units", params={"status": "available"}, headers=H(tok), timeout=15).json()["units"][-1]["id"]
        r1 = requests.post(f"{API}/units/{uid}/block", json={}, headers=H(tok), timeout=15)
        assert r1.status_code == 200 and r1.json()["status"] == "blocked"
        r2 = requests.post(f"{API}/units/{uid}/block", json={}, headers=H(tok), timeout=15)
        assert r2.status_code == 200 and r2.json()["status"] == "available"


# ---- site visits
class TestVisits:
    def test_create_list_patch(self, T):
        tok = T["admin"]["token"]
        lead = requests.post(f"{API}/leads", json={"name": "TEST Visit Buyer", "phone": _phone()}, headers=H(tok), timeout=20).json()
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=15).json()[0]["id"]
        at = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        r = requests.post(f"{API}/site-visits", json={"lead_id": lead["id"], "project_id": pid, "scheduled_at": at}, headers=H(tok), timeout=20)
        assert r.status_code == 200, r.text
        vid = r.json()["id"]
        assert any(v["id"] == vid for v in requests.get(f"{API}/site-visits", headers=H(tok), timeout=15).json())
        assert requests.get(f"{API}/leads/{lead['id']}", headers=H(tok), timeout=15).json()["lead"]["stage"] == "site_visit_scheduled"
        p = requests.patch(f"{API}/site-visits/{vid}", json={"status": "completed"}, headers=H(tok), timeout=15)
        assert p.status_code == 200 and p.json()["status"] == "completed"
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        assert requests.post(f"{API}/site-visits", json={"lead_id": lead["id"], "project_id": pid, "scheduled_at": past},
                             headers=H(tok), timeout=15).status_code == 400


# ---- partners / users / notifications / audit
class TestAdminMisc:
    def test_partner_patch_slab(self, T):
        tok = T["admin"]["token"]
        ps = requests.get(f"{API}/partners", headers=H(tok), timeout=15).json()
        p = next(x for x in ps if x["user_id"] == T["partner"]["user"]["id"])
        orig = p["commission_value"]
        r = requests.patch(f"{API}/partners/{p['id']}", json={"commission_value": orig + 0.5}, headers=H(tok), timeout=15)
        assert r.status_code == 200 and float(r.json()["commission_value"]) == float(orig) + 0.5
        requests.patch(f"{API}/partners/{p['id']}", json={"commission_value": orig}, headers=H(tok), timeout=15)
        # finance cannot change status
        assert requests.patch(f"{API}/partners/{p['id']}", json={"status": "approved"}, headers=H(T["finance"]["token"]), timeout=15).status_code == 403

    def test_users_list_no_password(self, T):
        r = requests.get(f"{API}/users", headers=H(T["admin"]["token"]), timeout=15)
        assert r.status_code == 200 and r.json()
        assert all("password_hash" not in u for u in r.json())

    def test_notifications_and_read(self, T):
        tok = T["sales1"]["token"]
        n = requests.get(f"{API}/notifications", headers=H(tok), timeout=15)
        assert n.status_code == 200 and "unread" in n.json()
        assert requests.post(f"{API}/notifications/read", headers=H(tok), timeout=15).status_code == 200
        assert requests.get(f"{API}/notifications", headers=H(tok), timeout=15).json()["unread"] == 0

    def test_audit(self, T):
        r = requests.get(f"{API}/audit", headers=H(T["admin"]["token"]), timeout=15)
        assert r.status_code == 200 and isinstance(r.json(), list) and r.json()
        assert requests.get(f"{API}/audit", headers=H(T["sales1"]["token"]), timeout=15).status_code == 403

    def test_dashboard_shapes(self, T):
        for k in ("admin", "sales1", "partner", "finance"):
            r = requests.get(f"{API}/dashboard", headers=H(T[k]["token"]), timeout=20)
            assert r.status_code == 200 and isinstance(r.json(), dict) and r.json(), k


# ---- fresh TEST org: seat limit + suspension blocks existing token
class TestOrgLifecycle:
    def test_seat_limit_and_suspend(self, T):
        g = T["global"]["token"]
        code = f"TEST{uuid.uuid4().hex[:4].upper()}"
        email = f"test_admin_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/admin/orgs", json={"name": "TEST Seat Org", "code": code, "plan": "starter", "city": "Pune",
                                                    "admin_name": "TEST Admin", "admin_email": email, "admin_password": "Secret12!"},
                          headers=H(g), timeout=20)
        assert r.status_code == 200, r.text
        org = r.json()
        dup = requests.post(f"{API}/admin/orgs", json={"name": "Dup", "code": code, "plan": "starter", "city": "",
                                                      "admin_name": "x", "admin_email": f"x{email}", "admin_password": "Secret12!"}, headers=H(g), timeout=20)
        assert dup.status_code == 409, dup.text
        tok = _login(email, "Secret12!")["token"]
        statuses = []
        for i in range(6):
            u = requests.post(f"{API}/users", json={"name": f"TEST U{i}", "email": f"test_u{i}_{uuid.uuid4().hex[:5]}@example.com",
                                                   "password": "Secret12!", "role": "sales_exec"}, headers=H(tok), timeout=15)
            statuses.append(u.status_code)
        assert 402 in statuses, f"seat limit never enforced: {statuses}"
        s = requests.patch(f"{API}/admin/orgs/{org['id']}", json={"status": "suspended"}, headers=H(g), timeout=15)
        assert s.status_code == 200
        me = requests.get(f"{API}/auth/me", headers=H(tok), timeout=15)
        assert me.status_code == 403, me.text
        assert requests.patch(f"{API}/admin/orgs/{org['id']}", json={"status": "active"}, headers=H(g), timeout=15).status_code == 200
        assert requests.get(f"{API}/auth/me", headers=H(tok), timeout=15).status_code == 200
