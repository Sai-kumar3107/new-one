"""RCortexa management commands (run locally or in CI — never on Vercel cold start).

  python manage.py migrate   # apply schema.sql (idempotent, never drops data)
  python manage.py seed      # insert a small demo dataset once (skips if org SKYLINE exists)
  python manage.py check     # verify DB connectivity + list table row counts
"""
import asyncio
import random
import sys
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import db  # noqa: E402
from server import hash_pw, now, rule_score  # noqa: E402

TABLES = ["orgs", "users", "projects", "units", "leads", "activities", "site_visits", "partners", "commissions",
          "chat_messages", "audit_logs", "notifications"]
IMG_A = "https://images.pexels.com/photos/34533543/pexels-photo-34533543.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"
IMG_B = "https://images.unsplash.com/photo-1640357897497-599b4fc84f51?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"
IMG_C = "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"


async def migrate():
    sql = (ROOT / "schema.sql").read_text()
    await db.execute(sql)
    print("schema applied")


async def check():
    print("db:", await db.fetchval("select current_database()"))
    for t in TABLES:
        print(f"  {t}: {await db.fetchval(f'select count(*) from {t}')}")


async def seed():
    if not await db.fetchval("select 1 from users where email = 'admin@rcortexa.com'"):
        await db.insert("users", {"email": "admin@rcortexa.com", "name": "Platform Admin", "role": "global_admin", "org_id": None, "password_hash": hash_pw("Admin@123")})
    if await db.fetchval("select 1 from orgs where code = 'SKYLINE'"):
        print("demo data already present — skipped")
        return
    async with db.tx() as c:
        org = await db.insert("orgs", {"name": "Skyline Developers", "code": "SKYLINE", "plan": "growth", "status": "active", "seats": 20, "city": "Bengaluru",
                                       "renewal_date": now() + timedelta(days=21), "exec_incentive_per_unit": 10000}, conn=c)
        zen = await db.insert("orgs", {"name": "Zenith Builders", "code": "ZENITH", "plan": "starter", "status": "active", "seats": 5, "city": "Hyderabad",
                                       "renewal_date": now() + timedelta(days=75), "exec_incentive_per_unit": 8000}, conn=c)
        o, z = org["id"], zen["id"]

        async def user(email, name, role, org_id, pw):
            return await db.insert("users", {"email": email, "name": name, "role": role, "org_id": org_id, "password_hash": hash_pw(pw)}, conn=c)

        oa = await user("orgadmin@skyline.com", "Rahul Mehta", "org_admin", o, "Admin@123")
        await user("finance@skyline.com", "Priya Nair", "finance", o, "Finance@123")
        s1 = await user("sales1@skyline.com", "Arjun Sharma", "sales_exec", o, "Sales@123")
        s2 = await user("sales2@skyline.com", "Neha Kapoor", "sales_exec", o, "Sales@123")
        cp = await user("partner@skyline.com", "Vikram Rao", "channel_partner", o, "Partner@123")
        await user("orgadmin@zenith.com", "Kiran Reddy", "org_admin", z, "Admin@123")
        zs = await user("sales@zenith.com", "Sanjay Varma", "sales_exec", z, "Sales@123")
        partner = await db.insert("partners", {"org_id": o, "user_id": cp["id"], "name": "Vikram Rao", "email": "partner@skyline.com", "phone": "9845012345",
                                               "agency": "Prime Realty Partners", "rera_id": "PRM/KA/RERA/1251/309/AG/2201", "status": "approved",
                                               "commission_type": "percent", "commission_value": 2.0, "pan": "ABCPR1234K", "gst": "29ABCPR1234K1Z5",
                                               "bank": "HDFC ••••4521"}, conn=c)
        await db.insert("partners", {"org_id": o, "user_id": None, "name": "Meera Iyer", "email": "meera@homekey.in", "phone": "9900112233",
                                     "agency": "HomeKey Realtors", "status": "pending", "commission_type": "flat", "commission_value": 75000}, conn=c)
        sky = await db.insert("projects", {"org_id": o, "name": "Skyline Heights", "location": "Whitefield", "city": "Bengaluru", "lat": 12.9698, "lng": 77.75,
                                           "status": "active", "description": "Twin towers with sky lounge and metro access.",
                                           "amenities": ["Clubhouse", "Infinity pool", "Sky lounge", "EV charging"], "price_from": 8500000, "image_url": IMG_A,
                                           "towers": ["A", "B"], "floors": 5, "launch": "2024-06", "rera": "PRM/KA/RERA/1251/446/PR/180922"}, conn=c)
        aur = await db.insert("projects", {"org_id": o, "name": "Aurum Residences", "location": "Baner", "city": "Pune", "lat": 18.559, "lng": 73.7868,
                                           "status": "active", "description": "Boutique luxury residences with private decks.",
                                           "amenities": ["Concierge", "Spa", "Smart home"], "price_from": 14500000, "image_url": IMG_B,
                                           "towers": ["T1"], "floors": 4, "launch": "2025-01", "rera": "P52100047711"}, conn=c)
        await db.insert("projects", {"org_id": o, "name": "Coral Bay", "location": "Kharghar", "city": "Navi Mumbai", "lat": 19.0473, "lng": 73.0699,
                                     "status": "upcoming", "description": "Sea-facing launch — pre-registrations open.", "amenities": ["Sea view"],
                                     "price_from": 11000000, "image_url": IMG_C, "towers": [], "floors": 0, "launch": "2026-11", "rera": "Applied"}, conn=c)
        zp = await db.insert("projects", {"org_id": z, "name": "Zenith Grove", "location": "Gachibowli", "city": "Hyderabad", "lat": 17.44, "lng": 78.35,
                                          "status": "active", "price_from": 7000000, "image_url": IMG_C, "towers": ["Z"], "floors": 2}, conn=c)

        rnd = random.Random(42)

        async def units(org_id, pid, towers, floors, layout, base):
            for t in towers:
                for f in range(1, floors + 1):
                    for i, (facing, bhk, area) in enumerate(layout, start=1):
                        r = rnd.random()
                        st = "available" if r < 0.65 else "reserved" if r < 0.72 else "sold" if r < 0.94 else "blocked"
                        await db.insert("units", {"org_id": org_id, "project_id": pid, "tower": t, "floor": f, "unit_no": f"{f}{i:02d}", "bhk": bhk,
                                                  "carpet_area": area, "facing": facing, "base_price": base[bhk] + f * 60000, "status": st,
                                                  "reserved_until": now() + timedelta(hours=rnd.randint(4, 47)) if st == "reserved" else None}, conn=c)

        await units(o, sky["id"], ["A", "B"], 5, [("North", 2, 1150), ("East", 3, 1480), ("South", 2, 1120), ("West", 3, 1510)], {2: 8500000, 3: 11500000})
        await units(o, aur["id"], ["T1"], 4, [("North", 3, 1850), ("East", 4, 2450), ("West", 3, 1820)], {3: 14500000, 4: 21000000})
        await units(z, zp["id"], ["Z"], 2, [("North", 2, 1100), ("South", 3, 1400)], {2: 7000000, 3: 9500000})
        for i, u in enumerate(await db.fetch("select id from units where org_id = $1 and status = 'sold'", o, conn=c)):
            ex = [s1, s2][i % 2]
            await db.execute("update units set sold_by = $2, sold_by_name = $3, buyer_name = $4, buyer_phone = $5, agreement_value = base_price, "
                             "sold_at = now() - make_interval(days => $6) where id = $1", u["id"], ex["id"], ex["name"], f"Buyer {i + 1}",
                             f"98{i:08d}", i + 1, conn=c)

        leads = [
            ("Ananya Gupta", "9876501234", "facebook", sky, 9000000, 12000000, 3, "East", "0-3 months", "negotiation", s1, None, 9),
            ("Rohan Desai", "9823456710", "magicbricks", sky, 7500000, 9500000, 2, "North", "3-6 months", "site_visit_scheduled", s1, None, 5),
            ("Sneha Kulkarni", "9765432109", "99acres", aur, 14000000, 17000000, 3, "North", "0-3 months", "contacted", s2, None, 3),
            ("Aditya Menon", "9988776655", "google_ads", sky, 8000000, 10000000, 2, "South", "6-12 months", "new", s2, None, 0),
            ("Manish Agarwal", "9456789012", "channel_partner", sky, 9500000, 12500000, 3, "East", "0-3 months", "closed_won", s2, cp, 20),
            ("Pooja Shetty", "9567890123", "channel_partner", aur, 15000000, 18000000, 3, "North", "3-6 months", "site_visit_scheduled", s1, cp, 4),
        ]
        ids = {}
        for name, phone, src, p, bmin, bmax, bhk, facing, tl, stage, ex, cpu, days in leads:
            created = now() - timedelta(days=days, hours=1)
            ld = {"org_id": o, "name": name, "phone": phone, "email": f"{name.split()[0].lower()}@example.com", "source": src, "project_id": p["id"],
                  "project_name": p["name"], "budget_min": bmin, "budget_max": bmax, "bhk": bhk, "preferred_facing": facing, "location": p["location"],
                  "timeline": tl, "stage": stage, "assigned_to": ex["id"], "assigned_name": ex["name"], "cp_user_id": cpu["id"] if cpu else None,
                  "cp_name": "Prime Realty Partners" if cpu else None, "locked": bool(cpu), "qualified": stage in ("negotiation", "closed_won"),
                  "engagement": {"whatsapp": "sent", "choice": None}, "created_by": oa["id"], "created_at": created, "updated_at": created,
                  "last_activity_at": created}
            ld.update(rule_score(ld, 3))
            row = await db.insert("leads", ld, conn=c)
            ids[name] = row
            for kind, text in (("created", f"Lead captured via {src.replace('_', ' ')}"), ("assignment", f"Assigned to {ex['name']} (smart assignment)"),
                               ("whatsapp", "[DEMO] Instant WhatsApp engagement sent")):
                await db.insert("activities", {"org_id": o, "lead_id": row["id"], "type": kind, "text": text, "user_name": "RCortexa Automation", "created_at": created}, conn=c)

        won = ids["Manish Agarwal"]
        u = await db.fetchrow("select * from units where project_id = $1 and status = 'available' and bhk = 3 order by floor limit 1", sky["id"], conn=c)
        await db.execute("update units set status = 'sold', lead_id = $2, buyer_name = $3, buyer_phone = $4, sold_by = $5, sold_by_name = $6, "
                         "agreement_value = base_price, sold_at = now() - interval '2 days' where id = $1", u["id"], won["id"], won["name"], won["phone"], s2["id"], s2["name"], conn=c)
        await db.insert("activities", {"org_id": o, "lead_id": won["id"], "type": "booking", "text": f"Booked {u['tower']}-{u['unit_no']}", "user_name": s2["name"]}, conn=c)
        await db.insert("commissions", {"org_id": o, "partner_id": partner["id"], "partner_user_id": cp["id"], "agency": "Prime Realty Partners",
                                        "lead_id": won["id"], "lead_name": won["name"], "unit_id": u["id"], "unit_label": f"{u['tower']}-{u['unit_no']}",
                                        "agreement_value": u["base_price"], "amount": round(u["base_price"] * 0.02), "milestone": "On booking", "status": "approved"}, conn=c)
        rd = ids["Rohan Desai"]
        await db.insert("site_visits", {"org_id": o, "lead_id": rd["id"], "lead_name": rd["name"], "lead_phone": rd["phone"], "project_id": sky["id"],
                                        "project_name": sky["name"], "location": sky["location"], "maps_url": "https://maps.google.com/?q=12.9698,77.75",
                                        "scheduled_at": now() + timedelta(days=1), "status": "scheduled", "assigned_to": s1["id"], "assigned_name": s1["name"]}, conn=c)
        zl = {"org_id": z, "name": "Zenith Buyer One", "phone": "9000000001", "source": "website", "project_id": zp["id"], "project_name": zp["name"],
              "stage": "new", "assigned_to": zs["id"], "assigned_name": zs["name"], "bhk": 2, "budget_max": 8000000}
        zl.update(rule_score(zl))
        await db.insert("leads", zl, conn=c)
        await db.insert("notifications", {"org_id": o, "user_id": oa["id"], "title": "New channel partner", "body": "HomeKey Realtors requested portal access",
                                          "kind": "partner", "link": "/partners"}, conn=c)
    print("demo data seeded")


async def main(cmd: str):
    try:
        await {"migrate": migrate, "seed": seed, "check": check}[cmd]()
    finally:
        await db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("migrate", "seed", "check"):
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1]))
