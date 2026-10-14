"""Time zone, recurring safety, reminders, budget warnings, payment method, exports, quick-note retries."""

import io
from datetime import date, datetime, timedelta

from database.db import connect, get_db
from services.dates import app_timezone, today
from services.recurring import run_due
from tests.conftest import TODAY, user_id
from tests.test_api import Api, api  # noqa: F401  (fixture)


# ------------------------------------------------------------------ #
# Time zone                                                          #
# ------------------------------------------------------------------ #

def test_today_follows_the_app_time_zone(app):
    app.config["FIXED_TODAY"] = None
    with app.app_context():
        assert today() == datetime.now(app_timezone("Asia/Kolkata")).date()
        app.config["APP_TIMEZONE"] = "UTC"
        assert today() == datetime.now(app_timezone("UTC")).date()


def test_time_zone_offsets_and_fallback():
    moment = datetime(2026, 10, 14, 20, 0)  # 20:00 UTC is 01:30 next day in India
    india = app_timezone("Asia/Kolkata").utcoffset(moment)
    assert india == timedelta(hours=5, minutes=30)
    assert app_timezone("Not/AZone").utcoffset(moment) == timedelta(0)


# ------------------------------------------------------------------ #
# Recurring: one copy only, reminders                                #
# ------------------------------------------------------------------ #

class RacingConnection:
    """Lets another request run the same rules between this request's read and its write."""

    def __init__(self, conn, other):
        self.conn, self.other, self.raced = conn, other, False

    def execute(self, sql, params=()):
        if sql.startswith("UPDATE recurring") and not self.raced:
            self.raced = True
            self.other()
        return self.conn.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self.conn, name)


def test_recurring_runs_from_two_requests_add_each_occurrence_once(app, auth_client):
    auth_client.post("/recurring/", {"kind": "expense", "amount": "100", "category": "Bills",
                                     "date": "2026-09-20", "frequency": "weekly"})
    uid = user_id(app)
    day = date(2026, 10, 4)
    other_created = []

    def other_request():
        conn = connect(app.config["DATABASE"])
        other_created.append(run_due(conn, uid, day))
        conn.close()

    conn = connect(app.config["DATABASE"])
    mine = run_due(RacingConnection(conn, other_request), uid, day)
    conn.close()
    with app.app_context():
        dates = [r[0] for r in get_db().execute("SELECT date FROM transactions ORDER BY date")]
    assert other_created == [3] and mine == 0
    assert dates == ["2026-09-20", "2026-09-27", "2026-10-04"]


def test_upcoming_recurring_items_on_dashboards(app, auth_client):
    auth_client.post("/recurring/", {"kind": "expense", "amount": "799", "category": "Bills",
                                     "date": "2026-09-19", "frequency": "monthly", "description": "Broadband"})
    auth_client.post("/recurring/", {"kind": "expense", "amount": "50", "category": "Bills",
                                     "date": "2026-09-30", "frequency": "monthly", "description": "Far away"})
    page = auth_client.get("/dashboard").get_data(as_text=True)
    assert "Coming up this week" in page and "Broadband" in page and "Far away" not in page


def test_api_dashboard_lists_upcoming(api):  # noqa: F811
    api.post("/recurring", {"kind": "income", "amount": "1000", "category": "Salary", "date": "2026-09-17",
                            "frequency": "monthly"})
    data = api.get("/dashboard").json
    assert [(u["next_date"], u["kind"]) for u in data["upcoming"]] == [("2026-09-17", "income")]
    assert api.get("/dashboard?month=2026-08").json["upcoming"] == []


def test_dashboard_warns_when_close_to_a_budget(auth_client):
    auth_client.post("/budgets/", {"overall": "", "budget_Food": "1000"})
    auth_client.add_tx(amount="900", category="Food", day="2026-09-05")
    page = auth_client.get("/dashboard").get_data(as_text=True)
    assert "Close to your budget in Food (₹100 left)" in page


def test_dashboard_warns_when_over_the_monthly_budget(auth_client):
    auth_client.post("/budgets/", {"overall": "1000"})
    auth_client.add_tx(amount="1200", category="Food", day="2026-09-05")
    page = auth_client.get("/dashboard").get_data(as_text=True)
    assert "₹200 more than your monthly budget" in page


# ------------------------------------------------------------------ #
# Payment method and time on the website                             #
# ------------------------------------------------------------------ #

def test_web_form_saves_and_edits_payment_method_and_time(app, auth_client):
    auth_client.post("/transactions/new", {"kind": "expense", "amount": "80", "category": "Food",
                                           "date": "2026-09-10", "method": "Cash", "time": "13:05"})
    with app.app_context():
        tx = get_db().execute("SELECT * FROM transactions").fetchone()
    assert (tx["method"], tx["time"]) == ("Cash", "13:05")
    assert "Cash" in auth_client.get("/transactions/").get_data(as_text=True)
    form = auth_client.get(f"/transactions/{tx['id']}/edit").get_data(as_text=True)
    assert 'value="Cash"' in form and 'value="13:05"' in form
    auth_client.post(f"/transactions/{tx['id']}/edit", {"kind": "expense", "amount": "80", "category": "Food",
                                                        "date": "2026-09-10", "method": "UPI", "time": ""})
    with app.app_context():
        tx = get_db().execute("SELECT * FROM transactions").fetchone()
    assert (tx["method"], tx["time"]) == ("UPI", None)


def test_web_form_rejects_bad_time(auth_client):
    resp = auth_client.post("/transactions/new", {"kind": "expense", "amount": "80", "category": "Food",
                                                  "date": "2026-09-10", "time": "25:00"})
    assert resp.status_code == 400


# ------------------------------------------------------------------ #
# Quick notes sent twice                                             #
# ------------------------------------------------------------------ #

def test_quick_note_with_the_same_client_id_saves_once(app, api):  # noqa: F811
    note = {"q": "250 lunch", "client_id": "3f2b9c1e-7a6d-4e2f-9b1c-0d5e8f7a6b4c", "written_on": "2026-09-15"}
    first = api.post("/transactions/quick", note)
    again = api.post("/transactions/quick", note)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json["transaction"]["id"] == first.json["transaction"]["id"]
    assert again.json["amount"] == "₹250" and again.json["category"] == "Food"
    api.post("/transactions/quick", {**note, "client_id": "another-note-0001"})
    with app.app_context():
        assert get_db().execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 2


def test_quick_note_client_ids_are_per_user(app, api):  # noqa: F811
    note = {"q": "100 tea", "client_id": "shared-id-123456"}
    api.post("/transactions/quick", note)
    other = Api(app)
    other.register(email="ravi@example.com", name="Ravi")
    resp = other.post("/transactions/quick", note)
    assert resp.status_code == 201  # a new entry for Ravi, not Asha's


def test_quick_note_rejects_a_malformed_client_id(api):  # noqa: F811
    assert api.post("/transactions/quick", {"q": "100 tea", "client_id": "bad id!"}).status_code == 400


def test_quick_note_without_client_id_still_works(api):  # noqa: F811
    assert api.post("/transactions/quick", {"q": "100 tea"}).status_code == 201
    assert api.post("/transactions/quick", {"q": "100 tea"}).status_code == 201


# ------------------------------------------------------------------ #
# Exports                                                             #
# ------------------------------------------------------------------ #

def test_csv_export_round_trips_time_method_and_reference(app, api):  # noqa: F811
    api.add(amount="349", description="Blinkit", time="09:05", method="Google Pay", reference="123456789012")
    text = api.get("/transactions/export.csv").data.decode("utf-8-sig")
    assert text.splitlines()[1] == "2026-09-10,expense,Food,349,Blinkit,09:05,Google Pay,123456789012"
    with app.app_context():
        db = get_db()
        db.execute("DELETE FROM transactions")
        db.commit()
    upload = text.replace("09:05,", "9:05:00,")  # how spreadsheets tend to save times
    resp = api.post("/transactions/import", data={"file": (io.BytesIO(upload.encode()), "back.csv")},
                    content_type="multipart/form-data")
    assert resp.status_code == 200, resp.json
    tx = api.get("/transactions").json["items"][0]
    assert (tx["time"], tx["method"], tx["reference"], tx["amount_cents"]) == ("09:05", "Google Pay",
                                                                               "123456789012", 34900)


def test_old_style_csv_still_imports(api):  # noqa: F811
    good = "date,type,category,amount,description\n2026-09-01,expense,Food,120,Tea\n"
    resp = api.post("/transactions/import", data={"file": (io.BytesIO(good.encode()), "t.csv")},
                    content_type="multipart/form-data")
    assert resp.json["imported"] == 1


def test_json_backup_includes_method(api):  # noqa: F811
    api.add(method="Cash")
    assert api.get("/me/export.json").json["transactions"][0]["method"] == "Cash"


def test_period_report_csv(auth_client):
    auth_client.add_tx(amount="1000", kind="income", category="Salary", day="2026-08-01")
    auth_client.add_tx(amount="300", category="Food", day="2026-08-03")
    auth_client.add_tx(amount="100", category="Transport", day="2026-09-02")
    resp = auth_client.get("/analytics/report.csv?range=custom&start=2026-08-01&end=2026-09-15")
    assert resp.status_code == 200 and "attachment" in resp.headers["Content-Disposition"]
    lines = resp.data.decode("utf-8-sig").splitlines()
    assert lines[0] == "Paylog report,2026-08-01,2026-09-15"
    assert lines[3] == "1000,400,600,60.0"
    assert "Aug 2026,1000,300,700,70.0" in lines and "Sep 2026,0,100,-100," in lines
    assert "Food,300,75.0,1" in lines and "Salary,1000,100.0,1" in lines
    page = auth_client.get("/analytics/").get_data(as_text=True)
    assert "/analytics/report.csv?range=12m" in page


def test_report_needs_sign_in(app, client, api):  # noqa: F811
    assert client.get("/analytics/report.csv").status_code == 302
    assert Api(app).get("/analytics/report.csv").status_code == 401
    assert api.get("/analytics/report.csv?range=3m").status_code == 200


def test_fixed_today_is_used_in_tests(app):
    with app.app_context():
        assert today() == TODAY
