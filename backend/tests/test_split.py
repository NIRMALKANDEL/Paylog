"""Shared expenses: splits, balances, settling up, and keeping groups private."""

import html
import random

import pytest

from database.db import get_db
from services import split
from tests.conftest import user_id
from tests.test_api import Api, api  # noqa: F401  (fixture)


# ------------------------------------------------------------------ #
# The maths                                                          #
# ------------------------------------------------------------------ #

def test_equal_shares_add_up_exactly():
    assert split.equal_shares(1000, [1, 2, 3]) == {1: 334, 2: 333, 3: 333}
    assert split.equal_shares(10001, [5, 6]) == {5: 5001, 6: 5000}
    for _ in range(200):
        amount = random.randint(1, 10_000_000)
        people = list(range(random.randint(1, 30)))
        shares = split.equal_shares(amount, people)
        assert sum(shares.values()) == amount and max(shares.values()) - min(shares.values()) <= 1


def test_settle_up_plan_clears_every_balance():
    for _ in range(300):
        nets = {m: random.randint(-50_000, 50_000) for m in range(random.randint(2, 12))}
        nets[0] -= sum(nets.values())  # balances always sum to zero
        plan = split.suggest_settlements(nets)
        left = dict(nets)
        for payer, receiver, cents in plan:
            assert cents > 0 and nets[payer] < 0 < nets[receiver]
            left[payer] += cents
            left[receiver] -= cents
        assert all(v == 0 for v in left.values())
        assert len(plan) <= max(len([v for v in nets.values() if v]) - 1, 0)


def test_simplified_debts_example():
    # A paid 300 for all three, B paid 150 for all three: C owes A 150, B is square... after shares:
    # shares 150 each -> A +150, B 0, C -150.
    assert split.suggest_settlements({1: 15000, 2: 0, 3: -15000}) == [(3, 1, 15000)]
    # Chain A owes B, B owes C collapses to A pays C.
    assert split.suggest_settlements({1: -500, 2: 0, 3: 500}) == [(1, 3, 500)]


# ------------------------------------------------------------------ #
# Website                                                            #
# ------------------------------------------------------------------ #

def text(resp):
    return html.unescape(resp.get_data(as_text=True))


def make_group(client, name="Goa trip", members="Rahul, Priya"):
    resp = client.post("/shared/", {"name": name, "members": members})
    assert resp.status_code == 302, text(resp)
    return int(resp.headers["Location"].rstrip("/").split("/")[-1].split("#")[0])


def members_of(app, group_id):
    with app.app_context():
        return {m["name"]: m["id"] for m in split.get_members(get_db(), group_id)}


def nets_of(app, group_id):
    with app.app_context():
        names = {v: k for k, v in members_of(app, group_id).items()}
        return {names[m]: v for m, v in split.balances(get_db(), group_id).items()}


def test_create_group_adds_you(app, auth_client):
    gid = make_group(auth_client)
    assert members_of(app, gid).keys() == {"You", "Rahul", "Priya"}
    page = text(auth_client.get(f"/shared/{gid}"))
    assert "Goa trip" in page and "No expenses yet" in page
    assert "Goa trip" in text(auth_client.get("/shared/"))


@pytest.mark.parametrize("members, message", [
    ("", "Add at least one other person"),
    ("Rahul, rahul", "listed twice"),
    ("you", "listed twice"),
    ("x" * 41, "at most 40"),
])
def test_create_group_validates(auth_client, members, message):
    resp = auth_client.post("/shared/", {"name": "Trip", "members": members})
    assert resp.status_code == 400 and message in text(resp)


def test_equal_expense_and_balances(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {
        "paid_by": ids["You"], "amount": "900", "description": "Dinner", "date": "2026-09-10",
        "split": "equal", "members": [ids["You"], ids["Rahul"], ids["Priya"]]})
    assert nets_of(app, gid) == {"You": 60000, "Rahul": -30000, "Priya": -30000}
    page = text(auth_client.get(f"/shared/{gid}"))
    assert "Dinner" in page and "Rahul → You" in page and "₹600" in page


def test_exact_split_must_add_up(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    base = {"paid_by": ids["Rahul"], "amount": "1000", "date": "2026-09-10", "split": "exact",
            f"share_{ids['You']}": "700", f"share_{ids['Priya']}": "200"}
    resp = auth_client.post(f"/shared/{gid}/expenses", base, follow_redirects=True)
    assert "add up to 900, but the expense is 1000" in text(resp)
    assert nets_of(app, gid) == {"You": 0, "Rahul": 0, "Priya": 0}
    auth_client.post(f"/shared/{gid}/expenses", {**base, f"share_{ids['Rahul']}": "100"})
    assert nets_of(app, gid) == {"You": -70000, "Rahul": 90000, "Priya": -20000}


def test_expense_must_involve_someone_besides_the_payer(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    resp = auth_client.post(f"/shared/{gid}/expenses", {
        "paid_by": ids["You"], "amount": "100", "date": "2026-09-10", "split": "equal", "members": [ids["You"]]},
        follow_redirects=True)
    assert "nobody owes anything" in text(resp)


@pytest.mark.parametrize("amount", ["0", "-5", "abc", "1.234"])
def test_expense_rejects_bad_amounts(app, auth_client, amount):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {"paid_by": ids["You"], "amount": amount, "date": "2026-09-10",
                                                 "split": "equal", "members": list(ids.values())})
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM split_expenses").fetchone()[0] == 0


def test_settle_up_and_no_double_settlement(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {
        "paid_by": ids["You"], "amount": "900", "date": "2026-09-10", "split": "equal",
        "members": list(ids.values())})
    pay = {"from_member": ids["Rahul"], "to_member": ids["You"], "amount": "300"}
    auth_client.post(f"/shared/{gid}/settlements", pay)
    assert nets_of(app, gid)["Rahul"] == 0
    again = auth_client.post(f"/shared/{gid}/settlements", pay, follow_redirects=True)
    assert "Rahul doesn't owe anything" in text(again)
    too_much = auth_client.post(f"/shared/{gid}/settlements",
                                {**pay, "from_member": ids["Priya"], "amount": "301"}, follow_redirects=True)
    assert "That's more than is owed: at most 300" in text(too_much)
    auth_client.post(f"/shared/{gid}/settlements", {**pay, "from_member": ids["Priya"], "amount": "100"})
    assert nets_of(app, gid) == {"You": 20000, "Rahul": 0, "Priya": -20000}
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM split_settlements").fetchone()[0] == 2


def test_wrong_direction_settlement_is_refused(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {
        "paid_by": ids["You"], "amount": "200", "date": "2026-09-10", "split": "equal",
        "members": [ids["You"], ids["Rahul"]]})
    resp = auth_client.post(f"/shared/{gid}/settlements",
                            {"from_member": ids["You"], "to_member": ids["Rahul"], "amount": "100"},
                            follow_redirects=True)
    assert "You don't owe anything in this group." in text(resp)
    assert nets_of(app, gid)["Rahul"] == -10000


def test_deleting_an_expense_or_payment_recalculates(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {"paid_by": ids["Priya"], "amount": "300", "date": "2026-09-10",
                                                 "split": "equal", "members": list(ids.values())})
    auth_client.post(f"/shared/{gid}/settlements", {"from_member": ids["You"], "to_member": ids["Priya"],
                                                    "amount": "100"})
    with app.app_context():
        db = get_db()
        sid = db.execute("SELECT id FROM split_settlements").fetchone()[0]
        eid = db.execute("SELECT id FROM split_expenses").fetchone()[0]
    auth_client.post(f"/shared/{gid}/settlements/{sid}/delete")
    assert nets_of(app, gid) == {"You": -10000, "Rahul": -10000, "Priya": 20000}
    auth_client.post(f"/shared/{gid}/expenses/{eid}/delete")
    assert nets_of(app, gid) == {"You": 0, "Rahul": 0, "Priya": 0}
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM split_shares").fetchone()[0] == 0


def test_members_in_use_cannot_be_removed(app, auth_client):
    gid = make_group(auth_client)
    auth_client.post(f"/shared/{gid}/members", {"name": "Sam"})
    ids = members_of(app, gid)
    assert "Sam" in ids
    auth_client.post(f"/shared/{gid}/expenses", {"paid_by": ids["You"], "amount": "100", "date": "2026-09-10",
                                                 "split": "equal", "members": [ids["You"], ids["Rahul"]]})
    resp = auth_client.post(f"/shared/{gid}/members/{ids['Rahul']}/delete", follow_redirects=True)
    assert "Delete those first" in text(resp)
    auth_client.post(f"/shared/{gid}/members/{ids['You']}/delete")
    auth_client.post(f"/shared/{gid}/members/{ids['Sam']}/delete")
    assert members_of(app, gid).keys() == {"You", "Rahul", "Priya"}
    dup = auth_client.post(f"/shared/{gid}/members", {"name": "priya"}, follow_redirects=True)
    assert "already someone called" in text(dup)


def test_delete_group_removes_everything(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {"paid_by": ids["You"], "amount": "100", "date": "2026-09-10",
                                                 "split": "equal", "members": list(ids.values())})
    auth_client.post(f"/shared/{gid}/settlements", {"from_member": ids["Rahul"], "to_member": ids["You"],
                                                    "amount": "33.33"})
    auth_client.post(f"/shared/{gid}/delete")
    with app.app_context():
        db = get_db()
        for table in ("split_groups", "split_members", "split_expenses", "split_shares", "split_settlements"):
            assert db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, table


def test_shared_expenses_stay_out_of_personal_totals(app, auth_client):
    gid = make_group(auth_client)
    ids = members_of(app, gid)
    auth_client.post(f"/shared/{gid}/expenses", {"paid_by": ids["You"], "amount": "100", "date": "2026-09-10",
                                                 "split": "equal", "members": list(ids.values())})
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0


def test_groups_are_private(app, auth_client):
    gid = make_group(auth_client, "Secret plans")
    ids = members_of(app, gid)
    auth_client.post("/logout")
    auth_client.ensure_csrf()
    auth_client.register(name="Mallory", email="mallory@example.com")
    assert auth_client.get(f"/shared/{gid}").status_code == 404
    assert "Secret plans" not in text(auth_client.get("/shared/"))
    for url, data in [
        (f"/shared/{gid}/expenses", {"paid_by": ids["You"], "amount": "1", "date": "2026-09-10", "split": "equal",
                                     "members": list(ids.values())}),
        (f"/shared/{gid}/members", {"name": "Eve"}),
        (f"/shared/{gid}/delete", {}),
        (f"/shared/{gid}/rename", {"name": "Mine"}),
    ]:
        assert auth_client.post(url, data).status_code == 404, url
    with app.app_context():
        assert get_db().execute("SELECT name FROM split_groups").fetchone()[0] == "Secret plans"
        assert get_db().execute("SELECT COUNT(*) FROM split_members").fetchone()[0] == 3


def test_other_groups_members_cant_be_used(app, auth_client):
    first, second = make_group(auth_client, "A"), make_group(auth_client, "B", "Zed")
    outsider = members_of(app, second)["Zed"]
    ids = members_of(app, first)
    resp = auth_client.post(f"/shared/{first}/expenses", {"paid_by": outsider, "amount": "100", "date": "2026-09-10",
                                                          "split": "equal", "members": list(ids.values())},
                            follow_redirects=True)
    assert "Choose who paid" in text(resp)


def test_shared_pages_need_sign_in(client):
    assert client.get("/shared/").status_code == 302


def test_nav_has_shared_link(auth_client):
    assert 'href="/shared/"' in text(auth_client.get("/dashboard"))


# ------------------------------------------------------------------ #
# API                                                                 #
# ------------------------------------------------------------------ #

def test_api_shared_flow(app, api):  # noqa: F811
    resp = api.post("/shared/groups", {"name": "Flat", "members": ["Asha", "Ben"]})
    assert resp.status_code == 201
    group = resp.json["group"]
    me = next(m["id"] for m in group["members"] if m["is_me"])
    ben = next(m["id"] for m in group["members"] if m["name"] == "Ben")
    asha = next(m["id"] for m in group["members"] if m["name"] == "Asha")
    gid = group["id"]
    resp = api.post(f"/shared/groups/{gid}/expenses", {"paid_by": ben, "amount": 1500, "description": "Rent share",
                                                       "split": "exact", "shares": {str(me): "500", str(asha): 1000}})
    assert resp.status_code == 201, resp.json
    group = resp.json["group"]
    assert group["my_net_cents"] == -50000 and group["expenses"][0]["my_share_cents"] == 50000
    assert sorted((s["from_member"], s["amount_cents"]) for s in group["suggested"]) == [(me, 50000), (asha, 100000)]
    resp = api.post(f"/shared/groups/{gid}/settlements", {"from_member": me, "to_member": ben, "amount": 500})
    assert resp.status_code == 201 and resp.json["group"]["my_net_cents"] == 0
    again = api.post(f"/shared/groups/{gid}/settlements", {"from_member": me, "to_member": ben, "amount": 500})
    assert again.status_code == 400
    listing = api.get("/shared/groups").json["groups"]
    assert listing == [{"id": gid, "name": "Flat", "member_count": 3, "my_net_cents": 0}]
    assert api.patch(f"/shared/groups/{gid}", {"name": "Flat 4B"}).json["group"]["name"] == "Flat 4B"
    assert api.delete(f"/shared/groups/{gid}").status_code == 200
    assert api.get(f"/shared/groups/{gid}").status_code == 404


def test_api_shared_validation_and_privacy(app, api):  # noqa: F811
    assert api.post("/shared/groups", {"name": "X", "members": "Ben"}).status_code == 400
    gid = api.post("/shared/groups", {"name": "X", "members": ["Ben"]}).json["group"]["id"]
    bad = api.post(f"/shared/groups/{gid}/expenses", {"paid_by": 999999, "amount": 10, "members": []})
    assert bad.status_code == 400 and bad.json["error"] == "Choose who paid."
    other = Api(app)
    other.register(email="eve@example.com", name="Eve")
    assert other.get(f"/shared/groups/{gid}").status_code == 404
    assert other.post(f"/shared/groups/{gid}/members", {"name": "Eve"}).status_code == 404
    assert other.delete(f"/shared/groups/{gid}").status_code == 404
    assert other.get("/shared/groups").json["groups"] == []
    assert Api(app).get("/shared/groups").status_code == 401


def test_account_deletion_removes_shared_groups(app, auth_client):
    make_group(auth_client)
    uid = user_id(app)
    with app.app_context():
        db = get_db()
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        db.commit()
        assert db.execute("SELECT COUNT(*) FROM split_members").fetchone()[0] == 0
