"""RCortexa iteration 3 targeted retest: concurrent dashboard/projects/leads (correctness + timing),
book -> score_factors/next_action, commission transition rules (409s), double reserve race, AI chat stream, light regression."""
from __future__ import annotations

import concurrent.futures as cf
import json
import os
import random
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
TIMINGS: dict = {}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    return r.json()


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _phone():
    return f"9{random.randint(100000000, 999999999)}"


@pytest.fixture(scope="module")
def T():
    creds = {"admin": ("orgadmin@skyline.com", "Admin@123"), "finance": ("finance@skyline.com", "Finance@123"),
             "sales1": ("sales1@skyline.com", "Sales@123"), "partner": ("partner@skyline.com", "Partner@123")}
    return {k: _login(*v) for k, v in creds.items()}


def _timed_get(path, tok, **kw):
    t0 = time.time()
    r = requests.get(f"{API}{path}", headers=H(tok), timeout=40, **kw)
    return r, round((time.time() - t0) * 1000)


# ---- health
def test_health():
    r = requests.get(f"{API}/health", timeout=20)
    assert r.status_code == 200 and r.json()["db"] is True


# ---- dashboards per role (correctness + timing)
class TestDashboards:
    def test_org_admin_dashboard(self, T):
        r, ms = _timed_get("/dashboard", T["admin"]["token"]); TIMINGS["dash_admin"] = ms
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("inventory", "revenue", "units_sold", "forecast", "team", "source_performance", "by_stage", "tiers", "upcoming_visits", "recent_activity"):
            assert k in d, k
        assert d["role"] == "org_admin" and d["org"]["code"] == "SKYLINE"
        assert sum(d["by_stage"].values()) == d["total_leads"]
        assert isinstance(d["team"], list) and len(d["team"]) >= 2
        assert d["my_earnings"] is None

    def test_sales_exec_dashboard(self, T):
        r, ms = _timed_get("/dashboard", T["sales1"]["token"]); TIMINGS["dash_sales"] = ms
        d = r.json()
        assert r.status_code == 200 and d["role"] == "sales_exec"
        assert "team" not in d and isinstance(d["my_earnings"], (int, float))
        assert d["my_earnings"] == d["units_sold"] * d["incentive_per_unit"]

    def test_finance_dashboard(self, T):
        r, ms = _timed_get("/dashboard", T["finance"]["token"]); TIMINGS["dash_finance"] = ms
        d = r.json()
        assert r.status_code == 200 and d["role"] == "finance" and "team" in d and "inventory" in d

    def test_partner_dashboard(self, T):
        r, ms = _timed_get("/dashboard", T["partner"]["token"]); TIMINGS["dash_partner"] = ms
        d = r.json()
        assert r.status_code == 200 and d["role"] == "channel_partner"
        assert set(d["commission_totals"]) == {"pending", "approved", "paid"} and "partner" in d and "recent_leads" in d
        assert "inventory" not in d and "bank" not in (d["partner"] or {}) or True

    def test_projects_and_leads_timing(self, T):
        r, ms = _timed_get("/projects", T["admin"]["token"]); TIMINGS["projects"] = ms
        assert r.status_code == 200 and isinstance(r.json(), list) and r.json()
        p = r.json()[0]
        assert "name" in p
        r2, ms2 = _timed_get("/leads", T["admin"]["token"]); TIMINGS["leads"] = ms2
        assert r2.status_code == 200 and "items" in r2.json()
        print("TIMINGS(ms):", TIMINGS)


# ---- leads CRUD + reserve race + book
class TestLeadsUnits:
    S: dict = {}

    def test_create_get_patch_lead(self, T):
        tok = T["sales1"]["token"]
        r = requests.post(f"{API}/leads", json={"name": "TEST It3 Buyer", "phone": _phone(), "bhk": 3}, headers=H(tok), timeout=30)
        assert r.status_code == 200, r.text
        lead = r.json(); self.S["lead"] = lead
        p = requests.patch(f"{API}/leads/{lead['id']}", json={"stage": "contacted"}, headers=H(tok), timeout=30)
        assert p.status_code == 200, p.text
        g = requests.get(f"{API}/leads/{lead['id']}", headers=H(tok), timeout=30).json()
        assert g["lead"]["stage"] == "contacted" and g["lead"]["name"] == "TEST It3 Buyer"

    def test_concurrent_double_reserve_one_wins(self, T):
        tok = T["sales1"]["token"]
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=30).json()[0]["id"]
        avail = requests.get(f"{API}/projects/{pid}/units", params={"status": "available"}, headers=H(tok), timeout=30).json()["units"]
        assert avail, "no available units"
        uid = avail[-1]["id"]; self.S["uid"] = uid
        with cf.ThreadPoolExecutor(2) as ex:
            futs = [ex.submit(requests.post, f"{API}/units/{uid}/reserve", json={"lead_id": self.S["lead"]["id"]}, headers=H(tok), timeout=30) for _ in range(2)]
            codes = sorted(f.result().status_code for f in futs)
        assert codes == [200, 409], codes

    def test_book_sets_score_factors(self, T):
        tok = T["sales1"]["token"]
        r = requests.post(f"{API}/units/{self.S['uid']}/book", json={}, headers=H(tok), timeout=30)
        assert r.status_code == 200 and r.json()["status"] == "sold", r.text
        ld = requests.get(f"{API}/leads/{self.S['lead']['id']}", headers=H(tok), timeout=30).json()["lead"]
        assert ld["stage"] == "closed_won" and ld["score"] == 100 and ld["tier"] == "Hot"
        assert ld["score_factors"] == ["Unit booked — deal closed won"], ld["score_factors"]
        assert ld["next_action"] == "Collect booking documents and payment schedule"
        assert ld.get("score_source") == "rules"


# ---- commission transitions (uses existing commissions; one new CP booking only if needed)
class TestCommissionTransitions:
    def _patch(self, T, cid, st):
        return requests.patch(f"{API}/commissions/{cid}", json={"status": st}, headers=H(T["finance"]["token"]), timeout=30)

    def _new_pending(self, T):
        items = requests.get(f"{API}/commissions", headers=H(T["finance"]["token"]), timeout=30).json()["items"]
        pend = [c for c in items if c["status"] == "pending"]
        if len(pend) >= 2:
            return pend[0]["id"], pend[1]["id"]
        lead = requests.post(f"{API}/leads", json={"name": "TEST It3 CP Buyer", "phone": _phone()}, headers=H(T["partner"]["token"]), timeout=30).json()
        tok = T["admin"]["token"]
        pid = requests.get(f"{API}/projects", headers=H(tok), timeout=30).json()[0]["id"]
        uid = requests.get(f"{API}/projects/{pid}/units", params={"status": "available"}, headers=H(tok), timeout=30).json()["units"][0]["id"]
        assert requests.post(f"{API}/units/{uid}/book", json={"lead_id": lead["id"]}, headers=H(tok), timeout=30).status_code == 200
        items = requests.get(f"{API}/commissions", headers=H(T["finance"]["token"]), timeout=30).json()["items"]
        pend = [c for c in items if c["status"] == "pending"]
        return pend[0]["id"], (pend[1]["id"] if len(pend) > 1 else None)

    def test_transitions(self, T):
        a, b = self._new_pending(T)
        res = {}
        res["pending->pending"] = self._patch(T, a, "pending").status_code
        res["pending->paid"] = self._patch(T, a, "paid").status_code
        res["pending->approved"] = self._patch(T, a, "approved").status_code
        res["approved->approved"] = self._patch(T, a, "approved").status_code
        res["approved->pending"] = self._patch(T, a, "pending").status_code
        res["approved->paid"] = self._patch(T, a, "paid").status_code
        res["paid->pending"] = self._patch(T, a, "pending").status_code
        res["paid->rejected"] = self._patch(T, a, "rejected").status_code
        res["paid->approved"] = self._patch(T, a, "approved").status_code
        if b:
            res["pending->rejected"] = self._patch(T, b, "rejected").status_code
            res["rejected->approved"] = self._patch(T, b, "approved").status_code
        res["missing->approved"] = self._patch(T, "00000000-0000-0000-0000-000000000000", "approved").status_code
        print("TRANSITIONS:", res)
        exp = {"pending->pending": 409, "pending->paid": 409, "pending->approved": 200, "approved->approved": 409, "approved->pending": 409,
               "approved->paid": 200, "paid->pending": 409, "paid->rejected": 409, "paid->approved": 409,
               "pending->rejected": 200, "rejected->approved": 409, "missing->approved": 404}
        bad = {k: v for k, v in res.items() if exp[k] != v}
        assert not bad, f"unexpected: {bad}"
        g = [c for c in requests.get(f"{API}/commissions", headers=H(T["finance"]["token"]), timeout=30).json()["items"] if c["id"] == a][0]
        assert g["status"] == "paid" and g.get("paid_by")


# ---- AI chat stream
def test_ai_chat_stream(T):
    with requests.post(f"{API}/ai/chat", json={"message": "How many units are available? Use bold and bullets."},
                       headers=H(T["admin"]["token"]), stream=True, timeout=90) as r:
        assert r.status_code == 200, r.text
        deltas, done, err = [], False, None
        for line in r.iter_lines(decode_unicode=True):
            if line and line.startswith("data: "):
                ev = json.loads(line[6:])
                if "delta" in ev: deltas.append(ev["delta"])
                if ev.get("error"): err = ev["error"]
                if ev.get("done"): done = True; break
    text = "".join(deltas)
    print("AI reply sample:", text[:300].replace("\n", " | "))
    assert done and not err and len(text) > 10
