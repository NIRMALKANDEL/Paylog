"""The JSON API used by the Paylog mobile app."""

import io
from datetime import timedelta

import pytest

from database.db import get_db
from tests.conftest import TODAY

PASSWORD = "secret123"


class Api:
    def __init__(self, app, token=None):
        self.app = app
        self.http = app.test_client()
        self.token = token

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def get(self, url, **kw):
        return self.http.get("/api/v1" + url, headers=self._headers(), **kw)

    def post(self, url, json=None, **kw):
        return self.http.post("/api/v1" + url, json=json, headers=self._headers(), **kw)

    def put(self, url, json=None):
        return self.http.put("/api/v1" + url, json=json, headers=self._headers())

    def patch(self, url, json=None):
        return self.http.patch("/api/v1" + url, json=json, headers=self._headers())

    def delete(self, url):
        return self.http.delete("/api/v1" + url, headers=self._headers())

    def register(self, email="asha@example.com", name="Asha Rao", password=PASSWORD):
        resp = self.post("/auth/register", {"name": name, "email": email, "password": password, "device": "Pixel"})
        assert resp.status_code == 201, resp.json
        self.token = resp.json["token"]
        return resp

    def add(self, **fields):
        data = {"kind": "expense", "amount": "100", "category": "Food", "date": "2026-09-10", **fields}
        return self.post("/transactions", data)


@pytest.fixture
def api(app):
    client = Api(app)
    client.register()
    return client


# ------------------------------------------------------------------ #
# Sign-in and tokens                                                  #
# ------------------------------------------------------------------ #

def test_register_and_login_return_a_token(app):
    anon = Api(app)
    resp = anon.register()
    assert resp.json["user"]["email"] == "asha@example.com"
    assert "password_hash" not in resp.json["user"]
    assert resp.json["user"]["theme"] == "paylog"  # new accounts get the Paylog look
    login = Api(app).post("/auth/login", {"email": "ASHA@example.com", "password": PASSWORD})
    assert login.status_code == 200 and login.json["token"] != resp.json["token"]


def test_only_a_hash_of_the_token_is_stored(app, api):
    with app.app_context():
        stored = get_db().execute("SELECT token_hash FROM api_tokens").fetchone()[0]
    assert api.token not in stored and len(stored) == 64


def test_register_validates(app):
    anon = Api(app)
    assert anon.post("/auth/register", {"name": "A", "email": "bad", "password": PASSWORD}).status_code == 400
    anon.register()
    dup = Api(app).post("/auth/register", {"name": "B", "email": "asha@example.com", "password": PASSWORD})
    assert dup.status_code == 400 and "already exists" in dup.json["error"]


def test_wrong_password_and_throttling(app, api):
    anon = Api(app)
    for _ in range(5):
        assert anon.post("/auth/login", {"email": "asha@example.com", "password": "nope1234"}).status_code == 401
    assert anon.post("/auth/login", {"email": "asha@example.com", "password": PASSWORD}).status_code == 429


def test_requests_without_a_valid_token_are_rejected(app, api):
    assert Api(app).get("/me").status_code == 401
    assert Api(app, token="made-up").get("/dashboard").status_code == 401
    assert api.get("/me").status_code == 200


def test_session_cookie_is_not_accepted_by_the_api(app, client):
    client.register()  # signed in on the website
    assert client.raw.get("/api/v1/me").status_code == 401


def test_token_lasts_30_days_and_use_extends_it(app, api):
    with app.app_context():
        db = get_db()
        days = db.execute("SELECT julianday(expires_at) - julianday('now') FROM api_tokens").fetchone()[0]
        assert 29.9 < days <= 30
        # Pretend the phone last used the app 20 days ago.
        db.execute("UPDATE api_tokens SET last_used_at = datetime('now', '-20 days'),"
                   " expires_at = datetime('now', '+10 days')")
        db.commit()
    assert api.get("/me").status_code == 200
    with app.app_context():
        days = get_db().execute("SELECT julianday(expires_at) - julianday('now') FROM api_tokens").fetchone()[0]
    assert days > 29.9


def test_expired_token_is_rejected(app, api):
    with app.app_context():
        db = get_db()
        db.execute("UPDATE api_tokens SET expires_at = datetime('now', '-1 minutes')")
        db.commit()
    assert api.get("/me").status_code == 401


def test_logout_revokes_only_that_token(app, api):
    other = Api(app)
    other.token = Api(app).post("/auth/login", {"email": "asha@example.com", "password": PASSWORD}).json["token"]
    assert api.post("/auth/logout").status_code == 200
    assert api.get("/me").status_code == 401
    assert other.get("/me").status_code == 200


def test_password_change_signs_out_other_devices_but_not_this_one(app, api, client):
    other = Api(app)
    other.token = Api(app).post("/auth/login", {"email": "asha@example.com", "password": PASSWORD}).json["token"]
    client.login()
    resp = api.post("/me/password", {"current_password": PASSWORD, "new_password": "newpass123"})
    assert resp.status_code == 200
    assert api.get("/me").status_code == 200
    assert other.get("/me").status_code == 401
    assert client.get("/dashboard").status_code == 302  # website session ended too
    bad = api.post("/me/password", {"current_password": "wrong", "new_password": "x1234567"})
    assert bad.status_code == 400


def test_password_reset_on_the_website_signs_the_app_out(app, api):
    with app.app_context():
        db = get_db()
        db.execute("UPDATE users SET password_hash = 'changed'")
        db.commit()
    assert api.get("/me").status_code == 401


def test_old_sign_ins_are_pruned(app, api):
    app.config["API_MAX_TOKENS_PER_USER"] = 3
    for _ in range(5):
        Api(app).post("/auth/login", {"email": "asha@example.com", "password": PASSWORD})
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM api_tokens").fetchone()[0] == 3


def test_forgot_password_sends_mail_without_revealing_accounts(app, api):
    from tests.conftest import outbox

    before = len(outbox(app))
    anon = Api(app)
    assert anon.post("/auth/forgot-password", {"email": "asha@example.com"}).status_code == 200
    assert anon.post("/auth/forgot-password", {"email": "nobody@example.com"}).status_code == 200
    assert len(outbox(app)) == before + 1
    assert anon.post("/auth/forgot-password", {"email": "x"}).status_code == 400


def test_meta_is_public(app):
    data = Api(app).get("/meta").json
    assert "Food" in data["categories"]["expense"] and data["currencies"]["INR"]["symbol"] == "₹"


# ------------------------------------------------------------------ #
# Profile                                                             #
# ------------------------------------------------------------------ #

def test_update_profile(api):
    resp = api.patch("/me", {"name": "Asha R", "currency": "USD", "mode": "dark", "theme": "ocean",
                             "accent": "#AABBCC", "auto_save_receipts": False})
    user = resp.json["user"]
    assert (user["name"], user["currency"], user["mode"], user["theme"], user["accent"]) == \
        ("Asha R", "USD", "dark", "ocean", "#aabbcc")
    assert user["auto_save_receipts"] is False
    for bad in ({"currency": "XYZ"}, {"mode": "neon"}, {"theme": "x"}, {"accent": "red"}, {"name": ""}):
        assert api.patch("/me", bad).status_code == 400


def test_change_email(api):
    assert api.post("/me/email", {"email": "new@example.com", "password": "wrong"}).status_code == 400
    resp = api.post("/me/email", {"email": "new@example.com", "password": PASSWORD})
    assert resp.json["user"]["email"] == "new@example.com" and resp.json["user"]["email_verified"] is False


def test_delete_account_removes_everything(app, api):
    api.add()
    assert api.post("/me/delete", {"password": "wrong"}).status_code == 400
    assert api.post("/me/delete", {"password": PASSWORD}).status_code == 200
    assert api.get("/me").status_code == 401
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM api_tokens").fetchone()[0] == 0


def test_exports(api):
    api.add(description="=cmd")
    csv_text = api.get("/transactions/export.csv").data.decode("utf-8-sig")
    assert "'=cmd" in csv_text
    assert api.get("/me/export.json").json["transactions"][0]["amount_cents"] == 10000


# ------------------------------------------------------------------ #
# Transactions                                                        #
# ------------------------------------------------------------------ #

def test_transaction_crud(api):
    created = api.add(amount="250.50", description="Lunch")
    assert created.status_code == 201
    tx = created.json["transaction"]
    assert tx["amount_cents"] == 25050 and tx["description"] == "Lunch"
    updated = api.put(f"/transactions/{tx['id']}", {"kind": "expense", "amount": 300, "category": "Groceries",
                                                   "date": "2026-09-11", "description": "Veg"})
    assert updated.json["transaction"]["category"] == "Groceries"
    assert updated.json["transaction"]["amount_cents"] == 30000
    assert api.get(f"/transactions/{tx['id']}").status_code == 200
    assert api.delete(f"/transactions/{tx['id']}").status_code == 200
    assert api.get(f"/transactions/{tx['id']}").status_code == 404


def test_transaction_validation(api):
    assert api.add(amount="-5").status_code == 400
    assert api.add(category="Nope").json["error"].startswith("Choose a valid")
    assert api.add(date="1999-01-01").status_code == 400


def test_list_filters_and_pages(api):
    for i in range(25):
        api.add(amount=str(10 + i), description=f"Item {i}")
    api.add(kind="income", category="Salary", amount="5000", description="Pay")
    first = api.get("/transactions").json
    assert first["pages"] == 2 and len(first["items"]) == 20 and first["summary"]["count"] == 26
    assert api.get("/transactions?kind=income").json["summary"]["income"] == 500000
    assert api.get("/transactions?q=Item 2").json["summary"]["count"] == 6
    assert api.get("/transactions?page=2").json["page"] == 2


def test_users_cannot_see_each_others_data(app, api):
    tx_id = api.add().json["transaction"]["id"]
    other = Api(app)
    other.register(email="ravi@example.com")
    assert other.get(f"/transactions/{tx_id}").status_code == 404
    assert other.delete(f"/transactions/{tx_id}").status_code == 404
    assert other.get("/transactions").json["summary"]["count"] == 0


def test_duplicate_upi_reference_needs_confirmation(api):
    assert api.add(reference="123456789012").status_code == 201
    dup = api.add(reference="123456789012")
    assert dup.status_code == 409 and dup.json["duplicate"]
    assert api.add(reference="123456789012", allow_duplicate=True).status_code == 201


def test_quick_add_from_widget(api):
    preview = api.get("/transactions/quick/preview?q=250 swiggy yesterday").json
    assert preview["ok"] and preview["amount"] == "₹250" and preview["when"] == "yesterday"
    saved = api.post("/transactions/quick", {"q": "lunch 180"})
    assert saved.status_code == 201
    assert saved.json["transaction"]["amount_cents"] == 18000
    assert saved.json["transaction"]["category"] == "Food"
    assert api.post("/transactions/quick", {"q": "no amount"}).status_code == 400
    assert api.get("/transactions/quick/preview?q=").json["ok"] is False


def test_quick_add_written_offline_keeps_its_day(api):
    two_days_ago = (TODAY - timedelta(days=2)).isoformat()
    three_days_ago = (TODAY - timedelta(days=3)).isoformat()
    plain = api.post("/transactions/quick", {"q": "250 lunch", "written_on": two_days_ago})
    assert plain.status_code == 201 and plain.json["transaction"]["date"] == two_days_ago
    relative = api.post("/transactions/quick", {"q": "180 uber yesterday", "written_on": two_days_ago})
    assert relative.json["transaction"]["date"] == three_days_ago
    ahead = (TODAY + timedelta(days=1)).isoformat()  # phone already past midnight
    assert api.post("/transactions/quick", {"q": "250 lunch", "written_on": ahead}).json["transaction"]["date"] == ahead
    future = (TODAY + timedelta(days=2)).isoformat()
    assert api.post("/transactions/quick", {"q": "250 lunch", "written_on": future}).status_code == 400
    old = (TODAY - timedelta(days=61)).isoformat()
    assert api.post("/transactions/quick", {"q": "250 lunch", "written_on": old}).status_code == 400
    assert api.post("/transactions/quick", {"q": "250 lunch", "written_on": "soon"}).status_code == 400


def test_csv_import(api):
    good = "date,type,category,amount,description\n2026-09-01,expense,Food,120,Tea\n2026-09-02,income,Salary,900,\n"
    resp = api.http.post("/api/v1/transactions/import", headers=api._headers(),
                         data={"file": (io.BytesIO(good.encode()), "t.csv")}, content_type="multipart/form-data")
    assert resp.status_code == 200 and resp.json["imported"] == 2
    bad = "date,category,amount\n2026-09-01,Nope,1\n"
    resp = api.http.post("/api/v1/transactions/import", headers=api._headers(),
                         data={"file": (io.BytesIO(bad.encode()), "t.csv")}, content_type="multipart/form-data")
    assert resp.status_code == 400 and resp.json["errors"]


# ------------------------------------------------------------------ #
# Receipts                                                            #
# ------------------------------------------------------------------ #

RECEIPT = """Paid successfully to
Swiggy
₹349
12 Sep 2026, 1:15 pm
UPI transaction ID 612345678901
Google Pay"""


def test_clear_receipt_is_saved_automatically(api):
    resp = api.post("/receipts/parse", {"text": RECEIPT})
    assert resp.json["saved"]["amount_cents"] == 34900
    assert resp.json["saved"]["category"] == "Food"
    again = api.post("/receipts/parse", {"text": RECEIPT})
    assert again.json["saved"] is None and again.json["duplicate"]


def test_receipt_review_when_auto_save_is_off(api):
    api.patch("/me", {"auto_save_receipts": False})
    resp = api.post("/receipts/parse", {"text": RECEIPT})
    assert resp.json["saved"] is None and resp.json["form"]["amount"] == "349"
    assert api.post("/receipts/parse", {"text": ""}).status_code == 422


# ------------------------------------------------------------------ #
# Dashboard, analytics, budgets, goals, recurring                     #
# ------------------------------------------------------------------ #

def test_dashboard(api):
    api.add(kind="income", category="Salary", amount="1000", date="2026-09-01")
    api.add(amount="250", date="2026-09-02")
    data = api.get("/dashboard").json
    assert data["this_month"]["income"] == 100000 and data["this_month"]["expense"] == 25000
    assert data["has_any"] and len(data["recent"]) == 2 and len(data["trend"]) == 6
    assert len(data["pace"]["this_month"]) == 15  # FIXED_TODAY is 15 Sep


def test_analytics(api):
    api.add(amount="500", date="2026-08-03")
    for key in ("3m", "6m", "12m", "ytd", "all", "bogus"):
        data = api.get(f"/analytics?range={key}").json
        assert data["summary"]["expense"] == 50000, key
    custom = api.get("/analytics?range=custom&start=2026-09-01&end=2026-09-30").json
    assert custom["summary"]["expense"] == 0 and len(custom["weekdays"]) == 7


def test_budgets(api):
    api.add(amount="4500", category="Food")
    resp = api.put("/budgets", {"overall": "20000", "limits": {"Food": "5000", "Travel": ""}})
    data = resp.json
    assert data["overall_cents"] == 2000000 and data["limits"] == {"Food": 500000}
    food = data["status"]["categories"][0]
    assert food["category"] == "Food" and food["status"] == "warning"
    assert api.put("/budgets", {"limits": {"Food": "abc"}}).status_code == 400
    assert api.get("/budgets?month=2026-08").json["month"] == "2026-08"


def test_goals(api):
    resp = api.post("/goals", {"name": "Laptop", "target": "1000", "saved": "100", "target_date": "2027-03-01"})
    goal = resp.json["goals"][0]
    assert goal["status"] == "scheduled" and goal["monthly_needed_cents"]
    gid = goal["id"]
    reached = api.post(f"/goals/{gid}/contribute", {"amount": "900"}).json
    assert reached["reached"] and reached["goals"][0]["status"] == "complete"
    assert api.post(f"/goals/{gid}/contribute", {"amount": "5000", "action": "withdraw"}).status_code == 400
    assert api.put(f"/goals/{gid}", {"name": "", "target": "1"}).status_code == 400
    assert api.put(f"/goals/{gid}", {"name": "Phone", "target": "2000"}).json["goals"][0]["name"] == "Phone"
    assert api.delete(f"/goals/{gid}").json["goals"] == []


def test_recurring(api):
    resp = api.post("/recurring", {"kind": "expense", "amount": "500", "category": "Bills", "date": "2026-07-15",
                                   "frequency": "monthly", "description": "Internet"})
    assert resp.status_code == 201 and resp.json["backfilled"] == 3
    rule = resp.json["rules"][0]
    assert resp.json["monthly"]["expense"] == 50000
    paused = api.post(f"/recurring/{rule['id']}/toggle").json
    assert paused["active"] is False and paused["monthly"]["expense"] == 0
    assert api.post(f"/recurring/{rule['id']}/toggle").json["active"] is True
    assert api.post("/recurring", {"kind": "expense", "amount": "1", "category": "Bills", "date": "2026-09-01",
                                   "frequency": "daily"}).status_code == 400
    assert api.delete(f"/recurring/{rule['id']}").json["rules"] == []


def test_calculators_average(api):
    api.add(amount="3000", date="2026-07-10")
    assert api.get("/calculators").json["avg_monthly_expense"] == 1000


def test_unknown_api_url_is_json(api):
    resp = api.get("/nope")
    assert resp.status_code == 404 and resp.json["ok"] is False


def test_paylog_theme_is_accepted(api):
    assert api.patch("/me", {"theme": "paylog"}).json["user"]["theme"] == "paylog"
    assert api.patch("/me", {"theme": "forest"}).json["user"]["theme"] == "forest"
