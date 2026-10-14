"""The exact request shapes the mobile app sends (mobile/src/app/shared, quick.tsx)."""

from tests.test_api import api  # noqa: F401  (fixture)


def test_app_shared_group_flow(api):  # noqa: F811
    group = api.post("/shared/groups", {"name": "Goa trip", "members": ["Rahul", "Priya"]}).json["group"]
    gid = group["id"]
    ids = {m["name"]: m["id"] for m in group["members"]}
    me = ids["You"]
    # Split equally, Priya left out (app sends the chosen member ids and the phone's date).
    resp = api.post(f"/shared/groups/{gid}/expenses", {"amount": "900", "description": "Dinner", "paid_by": me,
                                                       "split": "equal", "date": "2026-09-14",
                                                       "members": [me, ids["Rahul"]]})
    assert resp.status_code == 201, resp.json
    # Exact amounts: the app's shares object has string keys and string amounts.
    resp = api.post(f"/shared/groups/{gid}/expenses", {"amount": "1250.50", "description": "", "paid_by": ids["Rahul"],
                                                       "split": "exact", "date": "2026-09-14",
                                                       "shares": {str(me): "250.50", str(ids["Priya"]): "1000"}})
    assert resp.status_code == 201, resp.json
    group = resp.json["group"]
    # You paid 900 (450 yours), owe Rahul 250.50: owed 450 - 250.50 = 199.50.
    assert group["my_net_cents"] == 19950
    plan = group["suggested"]
    assert sum(p["amount_cents"] for p in plan) > 0
    # "Mark paid" sends centsToInput(cents) as the amount, plus the date.
    for p in plan:
        amount = f"{p['amount_cents'] // 100}.{p['amount_cents'] % 100:02d}" if p["amount_cents"] % 100 else str(p["amount_cents"] // 100)
        resp = api.post(f"/shared/groups/{gid}/settlements", {"from_member": p["from_member"], "to_member": p["to_member"],
                                                              "amount": amount, "date": "2026-09-14"})
        assert resp.status_code == 201, resp.json
    group = resp.json["group"]
    assert group["suggested"] == [] and all(m["net_cents"] == 0 for m in group["members"])
    assert api.post(f"/shared/groups/{gid}/members", {"name": "Sam"}).status_code == 201
    assert api.patch(f"/shared/groups/{gid}", {"name": "Goa 2026"}).json["group"]["name"] == "Goa 2026"


def test_app_quick_note_sends_all_lines_at_once(api):  # noqa: F811
    note = {"q": "250 lunch\n40 tea\nsalary 65000", "written_on": "2026-09-15", "kind": None,
            "client_id": "mf3k2a9z-4h7x1q0c2b"}
    first = api.post("/transactions/quick", note)
    assert first.status_code == 201 and [t["amount_cents"] for t in first.json["transactions"]] == [25000, 4000, 6500000]
    assert api.post("/transactions/quick", note).status_code == 200  # retried after a dropped connection
    body = api.get("/transactions").json
    assert len(body["items"]) == 3


def test_app_dashboard_lists_upcoming(api):  # noqa: F811
    api.post("/recurring", {"kind": "expense", "amount": "15000", "category": "Rent", "date": "2026-09-17",
                            "description": "House rent", "frequency": "monthly"})
    upcoming = api.get("/dashboard").json["upcoming"]
    assert [(r["description"], r["next_date"]) for r in upcoming] == [("House rent", "2026-09-17")]
