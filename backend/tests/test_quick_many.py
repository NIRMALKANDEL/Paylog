"""Several quick entries at once: "250 lunch, 40 tea; salary 65000"."""

import html

import pytest

from database.db import get_db
from services.quickadd import split_entries
from tests.test_api import api  # noqa: F401  (fixture)


@pytest.mark.parametrize("text, entries", [
    ("250 lunch, 40 tea", ["250 lunch", "40 tea"]),
    ("250 lunch,40 tea;salary 65000\n2k rent", ["250 lunch", "40 tea", "salary 65000", "2k rent"]),
    ("1,250 rent", ["1,250 rent"]),                       # comma grouping digits
    ("bonus 1,25,000, 300 cab", ["bonus 1,25,000", "300 cab"]),
    ("250, 40", ["250", "40"]),                           # a space after the comma separates
    ("250,100 tea", ["250,100 tea"]),                     # read as one number, as typed
    ("lunch 250,tea 40", ["lunch 250", "tea 40"]),
    (" , ;\n", []),
    ("250 lunch", ["250 lunch"]),
])
def test_split_entries(text, entries):
    assert split_entries(text) == entries


def rows(app):
    with app.app_context():
        return get_db().execute("SELECT kind, amount_cents, category, description FROM transactions ORDER BY id").fetchall()


def test_website_quick_add_saves_every_entry(app, auth_client):
    resp = auth_client.post("/transactions/quick", {"q": "250 lunch, 40 tea; salary 65000", "next": "/dashboard"})
    assert resp.status_code == 302
    assert [tuple(r) for r in rows(app)] == [("expense", 25000, "Food", "Lunch"), ("expense", 4000, "Food", "Tea"),
                                             ("income", 6500000, "Salary", "")]
    page = html.unescape(auth_client.get("/dashboard").get_data(as_text=True))
    assert "Saved 3 entries · ₹290 debit · ₹65,000 credit" in page and "Undo all" in page


def test_website_undo_all_removes_only_those_entries(app, auth_client):
    auth_client.add_tx(amount="999")
    auth_client.post("/transactions/quick", {"q": "250 lunch, 40 tea"})
    with app.app_context():
        ids = [r[0] for r in get_db().execute("SELECT id FROM transactions ORDER BY id")]
    auth_client.post("/transactions/undo", {"ids": [str(i) for i in ids[1:]] + ["999999"]})
    assert [r["amount_cents"] for r in rows(app)] == [99900]


def test_website_one_bad_entry_saves_nothing(app, auth_client):
    resp = auth_client.post("/transactions/quick", {"q": "250 lunch, tea, 40 snacks"}, follow_redirects=True)
    assert "“tea”: Add an amount" in html.unescape(resp.get_data(as_text=True))
    assert rows(app) == []


def test_website_single_entry_is_unchanged(app, auth_client):
    auth_client.post("/transactions/quick", {"q": "180 lunch yesterday"})
    page = html.unescape(auth_client.get("/dashboard").get_data(as_text=True))
    assert "Saved ₹180 · Lunch · Food" in page and "Undo all" not in page


def test_website_preview_lists_entries(auth_client):
    data = auth_client.get("/transactions/quick/preview?q=250 lunch, 40 tea").json
    assert data["ok"] and data["count"] == 2
    assert [(e["amount"], e["category"]) for e in data["entries"]] == [("₹250", "Food"), ("₹40", "Food")]
    assert data["amount"] == "₹250"  # first entry's fields stay at the top level
    single = auth_client.get("/transactions/quick/preview?q=250 lunch").json
    assert single["count"] == 1 and single["amount"] == "₹250"
    bad = auth_client.get("/transactions/quick/preview?q=250 lunch, tea").json
    assert not bad["ok"] and bad["error"].startswith("“tea”:")


def test_too_many_entries(auth_client):
    data = auth_client.get("/transactions/quick/preview?q=" + ", ".join(["10 tea"] * 21)).json
    assert not data["ok"] and "up to 20" in data["error"]


def test_api_quick_add_several(app, api):  # noqa: F811
    resp = api.post("/transactions/quick", {"q": "250 lunch, 40 tea", "written_on": "2026-09-14", "kind": "expense"})
    assert resp.status_code == 201
    body = resp.json
    assert body["count"] == 2 and len(body["transactions"]) == 2
    assert body["transaction"]["id"] == body["transactions"][0]["id"]
    assert [e["when"] for e in body["entries"]] == ["yesterday", "yesterday"]
    preview = api.get("/transactions/quick/preview?q=250 lunch; salary 65000").json
    assert [e["kind"] for e in preview["entries"]] == ["expense", "income"]


def test_api_resent_multi_entry_note_saves_once(app, api):  # noqa: F811
    note = {"q": "250 lunch, 40 tea, 60 snacks", "client_id": "7c1e2f30-aaaa-bbbb-cccc-0123456789ab"}
    first = api.post("/transactions/quick", note)
    again = api.post("/transactions/quick", note)
    assert first.status_code == 201 and again.status_code == 200
    assert [t["id"] for t in again.json["transactions"]] == [t["id"] for t in first.json["transactions"]]
    assert len(rows(app)) == 3


def test_api_bad_entry_saves_nothing(app, api):  # noqa: F811
    resp = api.post("/transactions/quick", {"q": "250 lunch, tea"})
    assert resp.status_code == 400 and resp.json["error"].startswith("“tea”:")
    assert rows(app) == []
