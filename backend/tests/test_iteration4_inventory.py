"""RCortexa iteration 4: retest of iteration-3 fixes (booked lead score, atomic reserve) + Org-admin Project & Inventory
management (project/unit CRUD, safeguards, CSV/XLSX import/export, assets via object storage, RBAC, tenant isolation)."""
from __future__ import annotations

import concurrent.futures as cf
import csv
import io
import random
import os
import time

import openpyxl
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
RUN = f"{int(time.time()) % 100000}"
S: dict = {}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"{email}: {r.status_code} {r.text}"
    return r.json()["token"]


def H(tok, json_=True):
    h = {"Authorization": f"Bearer {tok}"}
    if json_:
        h["Content-Type"] = "application/json"
    return h


def _phone():
    return f"9{random.randint(100000000, 999999999)}"


def _png():
    b = io.BytesIO(); Image.new("RGB", (40, 30), (200, 30, 30)).save(b, "PNG"); return b.getvalue()


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@pytest.fixture(scope="module")
def T():
    toks = {"admin": _login("orgadmin@skyline.com", "Admin@123"), "sales": _login("sales1@skyline.com", "Sales@123"),
            "finance": _login("finance@skyline.com", "Finance@123"), "zenith": _login("orgadmin@zenith.com", "Admin@123")}
    yield toks
    # cleanup: release holds and archive every project created by this run
    a = toks["admin"]
    for pid in S.get("cleanup", []):
        units = requests.get(f"{API}/projects/{pid}/units", headers=H(a), timeout=30).json().get("units", [])
        for u in units:
            if u["status"] == "reserved":
                requests.post(f"{API}/units/{u['id']}/release", json={}, headers=H(a), timeout=30)
        requests.delete(f"{API}/projects/{pid}", params={"confirm": "true"}, headers=H(a), timeout=30)


def _new_unit(T, pid, tower, no, price=9000000, floor=3):
    return requests.post(f"{API}/projects/{pid}/units", json={"tower": tower, "floor": floor, "unit_no": no, "bhk": 2, "carpet_area": 1100,
                                                              "facing": "East", "base_price": price}, headers=H(T["admin"]), timeout=30)


def _new_lead(T, name):
    r = requests.post(f"{API}/leads", json={"name": name, "phone": _phone(), "bhk": 2}, headers=H(T["admin"]), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---- Projects CRUD / filters / RBAC
class TestProjects:
    def test_create_and_get(self, T):
        name = f"TEST_Proj_{RUN}"
        r = requests.post(f"{API}/projects", json={"name": name, "city": "Pune", "status": "active", "price_from": 5000000, "towers": ["A"]}, headers=H(T["admin"]), timeout=30)
        assert r.status_code == 200, r.text
        p = r.json(); S["pid"] = p["id"]; S["pname"] = name; S.setdefault("cleanup", []).append(p["id"])
        g = requests.get(f"{API}/projects/{p['id']}", headers=H(T["admin"]), timeout=30)
        assert g.status_code == 200
        d = g.json()
        assert d["name"] == name and d["city"] == "Pune" and d["towers"] == ["A"]
        for k in ("assets", "stats", "image_url", "brochure_url", "total_units"):
            assert k in d, k

    def test_duplicate_name_409(self, T):
        r = requests.post(f"{API}/projects", json={"name": S["pname"].lower()}, headers=H(T["admin"]), timeout=30)
        assert r.status_code == 409, r.text

    def test_non_admin_writes_403(self, T):
        for role in ("sales", "finance"):
            assert requests.post(f"{API}/projects", json={"name": f"TEST_x_{RUN}"}, headers=H(T[role]), timeout=30).status_code == 403
            assert requests.patch(f"{API}/projects/{S['pid']}", json={"city": "X"}, headers=H(T[role]), timeout=30).status_code == 403
            assert requests.delete(f"{API}/projects/{S['pid']}", headers=H(T[role]), timeout=30).status_code == 403

    def test_list_search_filter_sort(self, T):
        a = T["admin"]
        r = requests.get(f"{API}/projects", params={"q": S["pname"]}, headers=H(a), timeout=30).json()
        assert [p["id"] for p in r] == [S["pid"]]
        r = requests.get(f"{API}/projects", params={"city": "pune", "status": "active"}, headers=H(a), timeout=30).json()
        assert S["pid"] in [p["id"] for p in r] and all(p["status"] == "active" for p in r)
        r = requests.get(f"{API}/projects", params={"status": "completed", "q": S["pname"]}, headers=H(a), timeout=30).json()
        assert r == []
        for sort in ("created", "name", "price", "availability"):
            rr = requests.get(f"{API}/projects", params={"sort": sort}, headers=H(a), timeout=30)
            assert rr.status_code == 200 and isinstance(rr.json(), list), sort
        names = [p["name"].lower() for p in requests.get(f"{API}/projects", params={"sort": "name"}, headers=H(a), timeout=30).json()]
        assert names == sorted(names)
        assert requests.get(f"{API}/projects", params={"sort": "bogus"}, headers=H(a), timeout=30).status_code == 422

    def test_cross_tenant_404(self, T):
        z = T["zenith"]
        assert requests.get(f"{API}/projects/{S['pid']}", headers=H(z), timeout=30).status_code == 404
        assert requests.get(f"{API}/projects/{S['pid']}/units", headers=H(z), timeout=30).status_code == 404
        assert requests.patch(f"{API}/projects/{S['pid']}", json={"city": "Hack"}, headers=H(z), timeout=30).status_code == 404
        assert S["pid"] not in [p["id"] for p in requests.get(f"{API}/projects", headers=H(z), timeout=30).json()]


# ---- Units CRUD + safeguards
class TestUnits:
    def test_create_unit_and_tower_autoadd(self, T):
        r = _new_unit(T, S["pid"], "A", "101", price=8000000)
        assert r.status_code == 200, r.text
        S["u101"] = r.json()["id"]
        r = _new_unit(T, S["pid"], "B", "201", price=12000000, floor=7)
        assert r.status_code == 200, r.text
        S["uB"] = r.json()["id"]
        for no in ("102", "103"):
            rr = _new_unit(T, S["pid"], "A", no, price=9500000)
            assert rr.status_code == 200
            S[f"u{no}"] = rr.json()["id"]
        p = requests.get(f"{API}/projects/{S['pid']}", headers=H(T["admin"]), timeout=30).json()
        assert "B" in p["towers"] and p["floors"] >= 7 and p["total_units"] == 4

    def test_duplicate_unit_409(self, T):
        assert _new_unit(T, S["pid"], "A", "101").status_code == 409

    def test_non_admin_unit_writes_403(self, T):
        assert _new_unit({"admin": T["sales"]}, S["pid"], "Z", "1").status_code == 403
        assert requests.patch(f"{API}/units/{S['u101']}", json={"notes": "x"}, headers=H(T["finance"]), timeout=30).status_code == 403
        assert requests.delete(f"{API}/units/{S['u101']}", headers=H(T["sales"]), timeout=30).status_code == 403

    def test_list_filters_sort(self, T):
        a, pid = T["admin"], S["pid"]
        g = lambda **p: requests.get(f"{API}/projects/{pid}/units", params=p, headers=H(a), timeout=30).json()["units"]
        assert {u["tower"] for u in g(tower="B")} == {"B"}
        assert [u["unit_no"] for u in g(q="102")] == ["102"]
        assert all(9000000 <= u["base_price"] <= 10000000 for u in g(min_price=9000000, max_price=10000000))
        assert len(g(bhk=2)) == 4 and g(bhk=4) == []
        prices = [u["base_price"] for u in g(sort="price_desc")]
        assert prices == sorted(prices, reverse=True)
        prices = [u["base_price"] for u in g(sort="price_asc")]
        assert prices == sorted(prices)
        assert len(g(status="available")) == 4

    def test_patch_available_unit(self, T):
        r = requests.patch(f"{API}/units/{S['u103']}", json={"base_price": 9900000, "status": "blocked"}, headers=H(T["admin"]), timeout=30)
        assert r.status_code == 200, r.text
        u = requests.get(f"{API}/units/{S['u103']}", headers=H(T["admin"]), timeout=30).json()
        assert u["base_price"] == 9900000 and u["status"] == "blocked" and "floor_plan_url" in u

    def test_remove_tower_with_units_409(self, T):
        r = requests.patch(f"{API}/projects/{S['pid']}", json={"towers": ["A"]}, headers=H(T["admin"]), timeout=30)
        assert r.status_code == 409, r.text

    def test_atomic_reserve_and_locked_safeguards(self, T):
        a = T["admin"]
        lead = _new_lead(T, f"TEST_It4 Reserve {RUN}"); S["lead_res"] = lead["id"]
        with cf.ThreadPoolExecutor(2) as ex:
            futs = [ex.submit(requests.post, f"{API}/units/{S['u101']}/reserve", json={"lead_id": lead["id"]}, headers=H(a), timeout=40) for _ in range(2)]
            codes = sorted(f.result().status_code for f in futs)
        assert codes == [200, 409], codes
        p = lambda body: requests.patch(f"{API}/units/{S['u101']}", json=body, headers=H(a), timeout=30)
        assert p({"status": "available"}).status_code == 409
        assert p({"status": "blocked", "confirm": True}).status_code == 409
        assert p({"base_price": 8100000}).status_code == 409
        r = p({"base_price": 8100000, "confirm": True}); assert r.status_code == 200 and r.json()["base_price"] == 8100000
        r = p({"notes": "TEST note on reserved"}); assert r.status_code == 200, r.text
        assert requests.get(f"{API}/units/{S['u101']}", headers=H(a), timeout=30).json()["notes"] == "TEST note on reserved"
        assert requests.delete(f"{API}/units/{S['u101']}", headers=H(a), timeout=30).status_code == 409

    def test_delete_available_unit(self, T):
        a = T["admin"]
        assert requests.delete(f"{API}/units/{S['u102']}", headers=H(a), timeout=30).status_code == 200
        assert requests.get(f"{API}/units/{S['u102']}", headers=H(a), timeout=30).status_code == 404


# ---- FIX RETEST 1: booked lead keeps score 100 after edits
class TestBookedLeadScore:
    def test_book_then_patch_keeps_score(self, T):
        a = T["admin"]
        lead = _new_lead(T, f"TEST_It4 Booked {RUN}")
        r = requests.post(f"{API}/units/{S['uB']}/book", json={"lead_id": lead["id"]}, headers=H(a), timeout=40)
        assert r.status_code == 200, r.text
        for body in ({"notes": "x", "email": "a@b.com"}, {"lost_reason": "n/a"}, {"budget_max": 20000000, "timeline": "6-12 months"}, {"bhk": 4}):
            pr = requests.patch(f"{API}/leads/{lead['id']}", json=body, headers=H(a), timeout=30)
            assert pr.status_code == 200, pr.text
            ld = requests.get(f"{API}/leads/{lead['id']}", headers=H(a), timeout=30).json()["lead"]
            assert ld["score"] == 100 and ld["tier"] == "Hot", (body, ld["score"])
            assert ld["score_factors"] == ["Unit booked — deal closed won"], ld["score_factors"]
            assert ld["next_action"] == "Collect booking documents and payment schedule"

    def test_stage_to_closed_won_scores_100(self, T):
        a = T["admin"]
        lead = _new_lead(T, f"TEST_It4 Won {RUN}")
        pr = requests.patch(f"{API}/leads/{lead['id']}", json={"stage": "closed_won"}, headers=H(a), timeout=30)
        assert pr.status_code == 200
        ld = requests.get(f"{API}/leads/{lead['id']}", headers=H(a), timeout=30).json()["lead"]
        assert ld["score"] == 100 and ld["score_factors"] == ["Unit booked — deal closed won"]

    def test_non_score_edit_does_not_rescore(self, T):
        a = T["admin"]
        lead = _new_lead(T, f"TEST_It4 Plain {RUN}")
        before = requests.get(f"{API}/leads/{lead['id']}", headers=H(a), timeout=30).json()["lead"]
        requests.patch(f"{API}/leads/{lead['id']}", json={"lost_reason": "none", "notes": "y"}, headers=H(a), timeout=30)
        after = requests.get(f"{API}/leads/{lead['id']}", headers=H(a), timeout=30).json()["lead"]
        assert after["score"] == before["score"] and after["score_factors"] == before["score_factors"] and after.get("scored_at") == before.get("scored_at")


# ---- Import / export
def _csv(rows, header=("tower", "floor", "unit_no", "bhk", "carpet_area", "facing", "base_price", "status")):
    s = io.StringIO(); w = csv.writer(s); w.writerow(header); w.writerows(rows); return s.getvalue().encode()


def _imp(T, data, name, dry):
    return requests.post(f"{API}/projects/{S['pid']}/units/import", files={"file": (name, data)}, data={"dry_run": str(dry).lower()},
                         headers=H(T["admin"], False), timeout=60)


class TestImportExport:
    def test_csv_dry_run_then_import(self, T):
        data = _csv([["C", 1, "C1", 2, 1000, "north", 7000000, "available"], ["C", 2, "C2", 3, 1400, "East", "9,500,000", ""],
                     ["A", 3, "103", 2, 1100, "West", 9800000, "available"], ["A", 3, "101", 2, 1100, "East", 1, "available"]])
        d = _imp(T, data, "units.csv", True)
        assert d.status_code == 200, d.text
        j = d.json()
        assert j["rows"] == 4 and j["create"] == 2 and j["update"] == 1 and len(j["skipped"]) == 1 and j["error_count"] == 0 and j["imported"] is False
        units = requests.get(f"{API}/projects/{S['pid']}/units", params={"tower": "C"}, headers=H(T["admin"]), timeout=30).json()["units"]
        assert units == []
        r = _imp(T, data, "units.csv", False).json()
        assert r["imported"] is True
        all_u = {f"{u['tower']}-{u['unit_no']}": u for u in requests.get(f"{API}/projects/{S['pid']}/units", headers=H(T["admin"]), timeout=30).json()["units"]}
        assert "C-C1" in all_u and all_u["C-C2"]["base_price"] == 9500000 and all_u["C-C1"]["facing"] == "North"
        assert all_u["A-103"]["facing"] == "West" and all_u["A-101"]["base_price"] == 8100000  # reserved unit untouched
        assert "C" in requests.get(f"{API}/projects/{S['pid']}", headers=H(T["admin"]), timeout=30).json()["towers"]

    def test_error_rows_import_nothing(self, T):
        data = _csv([["D", 1, "D1", 2, 1000, "North", 7000000, "available"], ["D", "x", "D2", 2, 1000, "Up", 0, "sold"], ["D", 1, "D1", 2, 1000, "North", 1, ""]])
        j = _imp(T, data, "bad.csv", False).json()
        assert j["imported"] is False and j["error_count"] == 2, j
        assert requests.get(f"{API}/projects/{S['pid']}/units", params={"tower": "D"}, headers=H(T["admin"]), timeout=30).json()["units"] == []

    def test_xlsx_import(self, T):
        wb = openpyxl.Workbook(); ws = wb.active
        ws.append(["Tower", "Floor", "Unit No", "BHK", "Carpet Area", "Facing", "Base Price"])
        ws.append(["E", 4, 401, 3, 1500, "South", 15000000]); ws.append(["E", 5, "501", 3, 1500, "South-East", 15500000.0])
        b = io.BytesIO(); wb.save(b)
        j = _imp(T, b.getvalue(), "units.xlsx", False).json()
        assert j["imported"] is True and j["create"] == 2, j
        nos = sorted(u["unit_no"] for u in requests.get(f"{API}/projects/{S['pid']}/units", params={"tower": "E"}, headers=H(T["admin"]), timeout=30).json()["units"])
        assert nos == ["401", "501"], nos

    def test_wrong_extension_400(self, T):
        assert _imp(T, b"hello", "units.txt", True).status_code == 400
        assert _imp(T, b"notexcel", "units.xlsx", True).status_code == 400

    def test_export_links(self, T):
        for fmt in ("csv", "xlsx"):
            for tpl in ("false", "true"):
                r = requests.post(f"{API}/projects/{S['pid']}/units/export-link", params={"format": fmt, "template": tpl}, headers=H(T["finance"]), timeout=30)
                assert r.status_code == 200, r.text
                url = r.json()["url"]; assert url.startswith("/api/exports/")
                f = requests.get(f"{BASE_URL}{url}", timeout=30)
                assert f.status_code == 200 and "attachment" in f.headers.get("content-disposition", "")
                if fmt == "csv":
                    lines = f.content.decode("utf-8-sig").strip().splitlines()
                    assert lines[0].startswith("tower,floor,unit_no")
                    assert (len(lines) == 2) if tpl == "true" else (len(lines) >= 6)
                else:
                    assert f.content[:2] == b"PK"
                S.setdefault("export_csv", f.content) if (fmt == "csv" and tpl == "false") else None
        assert requests.post(f"{API}/projects/{S['pid']}/units/export-link", headers=H(T["sales"]), timeout=30).status_code == 403
        url = requests.post(f"{API}/projects/{S['pid']}/units/export-link", headers=H(T["admin"]), timeout=30).json()["url"]
        assert requests.get(f"{BASE_URL}{url[:-3]}abc", timeout=30).status_code == 401

    def test_export_roundtrip_reimport(self, T):
        """Exported file (contains a reserved + sold unit) should re-import cleanly (reserved/sold rows skipped)."""
        j = _imp(T, S["export_csv"], "roundtrip.csv", True).json()
        print("ROUNDTRIP:", {k: j[k] for k in ("rows", "create", "update", "error_count")}, j["errors"][:2])
        assert j["error_count"] == 0, j["errors"]


# ---- Assets (real object storage)
class TestAssets:
    def _up(self, T, name, data, ctype, kind, unit_id=None, tok="admin"):
        d = {"kind": kind}
        if unit_id: d["unit_id"] = unit_id
        return requests.post(f"{API}/projects/{S['pid']}/assets", files={"file": (name, data, ctype)}, data=d, headers=H(T[tok], False), timeout=90)

    def test_image_upload_becomes_cover_and_served(self, T):
        r = self._up(T, "cover.png", _png(), "image/png", "image")
        assert r.status_code == 200, r.text
        a = r.json(); S["img"] = a["id"]
        assert "storage_path" not in a and a["url"].startswith("/api/files/")
        p = requests.get(f"{API}/projects/{S['pid']}", headers=H(T["admin"]), timeout=30).json()
        assert p["cover_asset_id"] == a["id"] and p["image_url"] and any(x["id"] == a["id"] for x in p["assets"])
        f = requests.get(f"{BASE_URL}{a['url']}", timeout=60)
        assert f.status_code == 200 and f.content[:4] == b"\x89PNG"
        assert requests.get(f"{BASE_URL}/api/files/{a['id']}?t=bad", timeout=30).status_code == 401
        assert self._up(T, "x.png", _png(), "image/png", "image", tok="sales").status_code == 403

    def test_wrong_types_400(self, T):
        assert self._up(T, "b.png", _png(), "image/png", "brochure").status_code == 400
        assert self._up(T, "i.pdf", PDF, "application/pdf", "image").status_code == 400
        assert self._up(T, "i.gif", b"GIF89a", "image/gif", "image").status_code == 400

    def test_brochure_and_floor_plan(self, T):
        r = self._up(T, "brochure.pdf", PDF, "application/pdf", "brochure")
        assert r.status_code == 200, r.text
        S["bro"] = r.json()["id"]
        p = requests.get(f"{API}/projects/{S['pid']}", headers=H(T["admin"]), timeout=30).json()
        assert p["brochure_url"]
        r = self._up(T, "plan.png", _png(), "image/png", "floor_plan", unit_id=S["u103"])
        assert r.status_code == 200, r.text
        S["plan"] = r.json()["id"]
        u = requests.get(f"{API}/units/{S['u103']}", headers=H(T["admin"]), timeout=30).json()
        assert u["floor_plan_url"]
        ua = requests.get(f"{API}/units/{S['u103']}/assets", headers=H(T["admin"]), timeout=30).json()
        assert [x["id"] for x in ua] == [S["plan"]]

    def test_cover_must_be_project_image(self, T):
        r = requests.patch(f"{API}/projects/{S['pid']}", json={"cover_asset_id": S["bro"]}, headers=H(T["admin"]), timeout=30)
        assert r.status_code in (400, 409), r.text

    def test_cross_tenant_assets(self, T):
        z = T["zenith"]
        assert requests.delete(f"{API}/assets/{S['img']}", headers=H(z), timeout=30).status_code == 404
        assert requests.get(f"{API}/units/{S['u103']}/assets", headers=H(z), timeout=30).json() == []
        assert requests.get(f"{API}/units/{S['u103']}", headers=H(z), timeout=30).status_code == 404

    def test_delete_assets_clears_refs(self, T):
        a = T["admin"]
        url = requests.get(f"{API}/projects/{S['pid']}", headers=H(a), timeout=30).json()["image_url"]
        for k in ("img", "bro", "plan"):
            assert requests.delete(f"{API}/assets/{S[k]}", headers=H(a), timeout=30).status_code == 200
        p = requests.get(f"{API}/projects/{S['pid']}", headers=H(a), timeout=30).json()
        assert p["cover_asset_id"] is None and p["brochure_url"] is None and p["assets"] == []
        assert requests.get(f"{API}/units/{S['u103']}", headers=H(a), timeout=30).json()["floor_plan_url"] is None
        assert requests.get(f"{BASE_URL}{url}", timeout=30).status_code == 404


# ---- Archive safeguards / restore
class TestArchive:
    def test_archive_flow(self, T):
        a, pid = T["admin"], S["pid"]
        assert requests.delete(f"{API}/projects/{pid}", headers=H(a), timeout=30).status_code == 409  # reserved unit
        assert requests.post(f"{API}/units/{S['u101']}/release", json={}, headers=H(a), timeout=30).status_code == 200
        r = requests.delete(f"{API}/projects/{pid}", headers=H(a), timeout=30)
        assert r.status_code == 409 and "sold" in r.text  # sold unit needs confirm
        assert requests.delete(f"{API}/projects/{pid}", params={"confirm": "true"}, headers=H(a), timeout=30).status_code == 200
        assert pid not in [p["id"] for p in requests.get(f"{API}/projects", headers=H(a), timeout=30).json()]
        arch = requests.get(f"{API}/projects", params={"include_archived": "true"}, headers=H(a), timeout=30).json()
        assert any(p["id"] == pid and p["archived"] for p in arch)
        assert pid not in [p["id"] for p in requests.get(f"{API}/projects", params={"include_archived": "true"}, headers=H(T["sales"]), timeout=30).json()]
        assert requests.post(f"{API}/projects/{pid}/restore", headers=H(a), timeout=30).status_code == 200
        assert pid in [p["id"] for p in requests.get(f"{API}/projects", headers=H(a), timeout=30).json()]
