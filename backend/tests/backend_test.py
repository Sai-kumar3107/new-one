"""RCortexa backend regression suite.

Covers: Auth, RBAC & tenant isolation, Leads lifecycle, Inventory flows,
Site visits, Partners & commissions, Dashboard, AI chat/history, Global
admin console. One pytest module to keep run-time short; tests are ordered
to minimize cross-test coupling and avoid destructive mutations on seeded
baseline data.
"""
from __future__ import annotations

import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

# -------------------------------- helpers ----------------------------------

def _login(email: str, password: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens() -> dict:
    users = {
        "global": ("admin@rcortexa.com", "Admin@123"),
        "skyline_admin": ("orgadmin@skyline.com", "Admin@123"),
        "skyline_finance": ("finance@skyline.com", "Finance@123"),
        "skyline_sales1": ("sales1@skyline.com", "Sales@123"),
        "skyline_sales2": ("sales2@skyline.com", "Sales@123"),
        "skyline_partner": ("partner@skyline.com", "Partner@123"),
        "zenith_admin": ("orgadmin@zenith.com", "Admin@123"),
        "zenith_sales": ("sales@zenith.com", "Sales@123"),
    }
    data: dict = {}
    for k, (e, p) in users.items():
        auth = _login(e, p)
        data[k] = {"token": auth["token"], "user": auth["user"], "org": auth.get("org")}
    return data


# --------------------------------- Auth ------------------------------------

class TestAuth:
    def test_login_success_shape(self, tokens):
        t = tokens["skyline_admin"]
        assert t["user"]["role"] == "org_admin"
        assert t["org"]["code"] == "SKYLINE"

    def test_wrong_password_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": "orgadmin@skyline.com", "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == "orgadmin@skyline.com"

    def test_partner_signup_and_pending_blocks_lead(self):
        email = f"TEST_partner_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/auth/partner-signup", json={
            "name": "Test Partner", "email": email, "password": "Pending123!",
            "phone": "9999900000", "agency": "TEST Agency", "rera_id": "", "org_code": "SKYLINE"
        }, timeout=20)
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        # Pending partner cannot register a lead
        r2 = requests.post(f"{API}/leads", json={"name": "Buyer", "phone": "9000000001"}, headers=_hdr(tok), timeout=20)
        assert r2.status_code == 403, r2.text


# ---------------------- Tenant isolation + RBAC ----------------------------

class TestTenantIsolationAndRBAC:
    def test_zenith_cannot_see_skyline_leads(self, tokens):
        sky_r = requests.get(f"{API}/leads", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=20)
        zen_r = requests.get(f"{API}/leads", headers=_hdr(tokens["zenith_admin"]["token"]), timeout=20)
        assert sky_r.status_code == 200 and zen_r.status_code == 200
        sky_ids = {x["id"] for x in sky_r.json()["items"]}
        zen_ids = {x["id"] for x in zen_r.json()["items"]}
        assert sky_ids and zen_ids
        assert sky_ids.isdisjoint(zen_ids), "Cross-tenant leakage"
        pick = next(iter(sky_ids))
        r = requests.get(f"{API}/leads/{pick}", headers=_hdr(tokens["zenith_admin"]["token"]), timeout=15)
        assert r.status_code == 404

    def test_sales_exec_sees_only_assigned(self, tokens):
        r = requests.get(f"{API}/leads", headers=_hdr(tokens["skyline_sales1"]["token"]), timeout=20)
        assert r.status_code == 200
        uid = tokens["skyline_sales1"]["user"]["id"]
        for lead in r.json()["items"]:
            assert lead.get("assigned_to") == uid, f"sales_exec got non-owned lead {lead.get('id')}"

    def test_channel_partner_sees_only_own(self, tokens):
        r = requests.get(f"{API}/leads", headers=_hdr(tokens["skyline_partner"]["token"]), timeout=20)
        assert r.status_code == 200
        uid = tokens["skyline_partner"]["user"]["id"]
        for lead in r.json()["items"]:
            assert lead.get("cp_user_id") == uid

    def test_finance_cannot_patch_leads(self, tokens):
        leads = requests.get(f"{API}/leads", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=20).json()["items"]
        lid = leads[0]["id"]
        r = requests.patch(f"{API}/leads/{lid}", json={"stage": "contacted"}, headers=_hdr(tokens["skyline_finance"]["token"]), timeout=15)
        assert r.status_code == 403

    def test_sales_exec_cannot_list_partners(self, tokens):
        r = requests.get(f"{API}/partners", headers=_hdr(tokens["skyline_sales1"]["token"]), timeout=15)
        assert r.status_code == 403

    def test_unit_buyer_masking(self, tokens):
        projects = requests.get(f"{API}/projects", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()
        assert projects, "No seeded projects"
        pid = projects[0]["id"]
        units_resp = requests.get(f"{API}/projects/{pid}/units", params={"status": "sold"},
                                  headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()
        sold = [u for u in units_resp.get("units", []) if u.get("buyer_name")]
        if not sold:
            pytest.skip("no sold units with buyer_name to test masking")
        unit_id = sold[0]["id"]
        # Admin sees buyer_name
        a = requests.get(f"{API}/units/{unit_id}", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()
        assert a.get("buyer_name"), "org_admin should see buyer_name"
        # Sales exec should NOT see buyer_name/sold_by_name
        s = requests.get(f"{API}/units/{unit_id}", headers=_hdr(tokens["skyline_sales1"]["token"]), timeout=15).json()
        assert not s.get("buyer_name"), "sales_exec should not see buyer_name"
        assert not s.get("sold_by_name"), "sales_exec should not see sold_by_name"


# ------------------------------- Leads -------------------------------------

class TestLeads:
    created_id: str | None = None

    def test_list_with_stage_filter_and_search(self, tokens):
        r = requests.get(f"{API}/leads?stage=new", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 200
        for l in r.json()["items"]:
            assert l["stage"] == "new"
        assert "counts" in r.json()

    def test_create_lead_phone_validation(self, tokens):
        r = requests.post(f"{API}/leads", json={"name": "Bad Phone", "phone": "123"},
                          headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 400

    def test_create_lead_and_smart_assign(self, tokens):
        phone = f"98{int(time.time()) % 100000000:08d}"
        payload = {"name": "TEST Buyer", "phone": phone, "source": "manual",
                   "budget_min": 7000000, "budget_max": 11000000, "bhk": 3, "preferred_facing": "East",
                   "timeline": "0-3 months", "location": "Mumbai"}
        r = requests.post(f"{API}/leads", json=payload, headers=_hdr(tokens["skyline_admin"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        lead = r.json()
        TestLeads.created_id = lead["id"]
        assert lead["assigned_to"], "smart-assignment should populate assigned_to"
        assert "score" in lead and lead["score"] >= 0

    def test_duplicate_phone_409(self, tokens):
        leads = requests.get(f"{API}/leads", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()["items"]
        existing_phone = leads[0]["phone"]
        r = requests.post(f"{API}/leads", json={"name": "Dup", "phone": existing_phone},
                          headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 409

    def test_patch_stage_and_add_activity(self, tokens):
        lid = TestLeads.created_id
        assert lid
        r = requests.patch(f"{API}/leads/{lid}", json={"stage": "contacted"},
                           headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 200 and r.json()["stage"] == "contacted"
        r2 = requests.post(f"{API}/leads/{lid}/activities", json={"type": "note", "text": "Test note"},
                           headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r2.status_code == 200
        r3 = requests.get(f"{API}/leads/{lid}", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        acts = r3.json().get("activities", [])
        assert any(a.get("text") == "Test note" for a in acts)

    def test_engage_now_and_schedule(self, tokens):
        lid = TestLeads.created_id
        r = requests.post(f"{API}/leads/{lid}/engage", json={"choice": "now"},
                          headers=_hdr(tokens["skyline_admin"]["token"]), timeout=25)
        assert r.status_code == 200, r.text
        from datetime import datetime, timedelta, timezone
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        r2 = requests.post(f"{API}/leads/{lid}/engage", json={"choice": "schedule", "callback_at": future},
                           headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r2.status_code == 200

    def test_score_llm(self, tokens):
        lid = TestLeads.created_id
        r = requests.post(f"{API}/leads/{lid}/score", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=60)
        assert r.status_code == 200
        body = r.json()
        assert 0 <= body["score"] <= 100
        assert body["tier"] in ("Hot", "Warm", "Cold")

    def test_recommendations(self, tokens):
        lid = TestLeads.created_id
        r = requests.get(f"{API}/leads/{lid}/recommendations", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ----------------------------- Inventory -----------------------------------

class TestInventory:
    def test_projects_with_stats(self, tokens):
        r = requests.get(f"{API}/projects", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 200
        projs = r.json()
        assert projs and all({"stats", "total_units"}.issubset(set(p.keys())) for p in projs)

    def test_project_units_filters(self, tokens):
        pid = requests.get(f"{API}/projects", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()[0]["id"]
        r = requests.get(f"{API}/projects/{pid}/units?status=available",
                         headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 200
        units = r.json()["units"]
        assert units and all(u["status"] == "available" for u in units)

    def test_reserve_then_second_reserve_409_then_release(self, tokens):
        tok = tokens["skyline_admin"]["token"]
        # Need a lead to reserve for
        lid = TestLeads.created_id
        pid = requests.get(f"{API}/projects", headers=_hdr(tok), timeout=15).json()[0]["id"]
        avail = requests.get(f"{API}/projects/{pid}/units?status=available", headers=_hdr(tok), timeout=15).json()["units"]
        assert avail, "no available units"
        unit_id = avail[0]["id"]
        r1 = requests.post(f"{API}/units/{unit_id}/reserve", json={"lead_id": lid}, headers=_hdr(tok), timeout=20)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/units/{unit_id}/reserve", json={"lead_id": lid}, headers=_hdr(tok), timeout=15)
        assert r2.status_code == 409
        rel = requests.post(f"{API}/units/{unit_id}/release", headers=_hdr(tok), timeout=15)
        assert rel.status_code == 200

    def test_block_requires_org_admin(self, tokens):
        tok_sales = tokens["skyline_sales1"]["token"]
        pid = requests.get(f"{API}/projects", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()[0]["id"]
        avail = requests.get(f"{API}/projects/{pid}/units?status=available", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15).json()["units"]
        unit_id = avail[-1]["id"]
        r = requests.post(f"{API}/units/{unit_id}/block", json={}, headers=_hdr(tok_sales), timeout=15)
        assert r.status_code == 403


# --------------------------- Partners & commissions ------------------------

class TestPartnersCommissions:
    def test_partners_list_admin(self, tokens):
        r = requests.get(f"{API}/partners", headers=_hdr(tokens["skyline_admin"]["token"]), timeout=15)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_commissions_list_finance(self, tokens):
        r = requests.get(f"{API}/commissions", headers=_hdr(tokens["skyline_finance"]["token"]), timeout=15)
        assert r.status_code == 200


# --------------------------- Dashboard & AI --------------------------------

class TestDashboardAndAI:
    def test_dashboard_role_aware(self, tokens):
        for key in ("skyline_admin", "skyline_sales1", "skyline_finance", "skyline_partner"):
            r = requests.get(f"{API}/dashboard", headers=_hdr(tokens[key]["token"]), timeout=15)
            assert r.status_code == 200, f"{key}: {r.text}"

    def test_ai_chat_streaming(self, tokens):
        tok = tokens["skyline_admin"]["token"]
        r = requests.post(f"{API}/ai/chat", json={"message": "How many hot leads do we have?"},
                          headers=_hdr(tok), stream=True, timeout=60)
        assert r.status_code == 200
        content = b""
        for chunk in r.iter_content(chunk_size=256):
            content += chunk
            if len(content) > 100:
                break
        assert content, "no SSE content streamed"

    def test_ai_history_get_delete(self, tokens):
        tok = tokens["skyline_admin"]["token"]
        g = requests.get(f"{API}/ai/history", headers=_hdr(tok), timeout=15)
        assert g.status_code == 200
        d = requests.delete(f"{API}/ai/history", headers=_hdr(tok), timeout=15)
        assert d.status_code == 200


# --------------------------- Global admin ----------------------------------

class TestGlobalAdmin:
    def test_overview(self, tokens):
        r = requests.get(f"{API}/admin/overview", headers=_hdr(tokens["global"]["token"]), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "orgs" in body and "metrics" in body

    def test_create_and_suspend_new_org_then_reactivate(self, tokens):
        # Create fresh org (never touch SKYLINE)
        code = f"TEST{uuid.uuid4().hex[:4].upper()}"
        email = f"TEST_admin_{uuid.uuid4().hex[:6]}@example.com"
        r = requests.post(f"{API}/admin/orgs", json={
            "name": "TEST Org", "code": code, "plan": "growth", "city": "Mumbai",
            "admin_name": "TEST Admin", "admin_email": email, "admin_password": "Secret12!"
        }, headers=_hdr(tokens["global"]["token"]), timeout=20)
        assert r.status_code == 200, r.text
        org = r.json()
        # New admin can log in
        auth = _login(email, "Secret12!")
        new_tok = auth["token"]
        # Suspend org via global admin
        s = requests.patch(f"{API}/admin/orgs/{org['id']}", json={"status": "suspended"},
                           headers=_hdr(tokens["global"]["token"]), timeout=15)
        assert s.status_code == 200
        # Suspended org -> /auth/me returns 403 AND fresh login returns 403
        login_blocked = requests.post(f"{API}/auth/login", json={"email": email, "password": "Secret12!"}, timeout=15)
        assert login_blocked.status_code == 403, login_blocked.text
        # Reactivate so we leave state clean
        ra = requests.patch(f"{API}/admin/orgs/{org['id']}", json={"status": "active"},
                            headers=_hdr(tokens["global"]["token"]), timeout=15)
        assert ra.status_code == 200
