from conftest import PASSWORD, Client, user_id

from database.db import get_db


def test_landing_page_renders(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"Know where your" in resp.data


def test_register_logs_user_in(client):
    resp = client.register()
    assert resp.status_code == 302
    assert resp.location.endswith("/dashboard")
    assert client.get("/dashboard").status_code == 200


def test_password_is_hashed(app, client):
    client.register()
    with app.app_context():
        row = get_db().execute("SELECT password_hash FROM users").fetchone()
    assert PASSWORD not in row["password_hash"]
    assert row["password_hash"].startswith(("scrypt:", "pbkdf2:"))


def test_register_rejects_duplicate_email_case_insensitive(client):
    client.register()
    client.post("/logout")
    client.ensure_csrf()
    resp = client.register(email="ASHA@example.com")
    assert resp.status_code == 400
    assert b"already exists" in resp.data


def test_register_validates_input(client):
    cases = [
        ({"name": "", "email": "a@b.co", "password": "abc12345", "confirm_password": "abc12345"}, b"Name is required"),
        ({"name": "A", "email": "not-an-email", "password": "abc12345", "confirm_password": "abc12345"}, b"valid email"),
        ({"name": "A", "email": "a@b.co", "password": "short1", "confirm_password": "short1"}, b"at least 8"),
        ({"name": "A", "email": "a@b.co", "password": "lettersonly", "confirm_password": "lettersonly"}, b"letter and one number"),
        ({"name": "A", "email": "a@b.co", "password": "abc12345", "confirm_password": "abc12346"}, b"do not match"),
    ]
    for data, message in cases:
        resp = client.post("/register", data)
        assert resp.status_code == 400
        assert message in resp.data


def test_login_and_logout(client):
    client.register()
    client.post("/logout")
    client.ensure_csrf()
    assert client.get("/dashboard").status_code == 302
    resp = client.login()
    assert resp.status_code == 302
    assert client.get("/dashboard").status_code == 200


def test_login_wrong_password(client):
    client.register()
    client.post("/logout")
    client.ensure_csrf()
    resp = client.login(password="wrong-pass1")
    assert resp.status_code == 401
    assert b"Incorrect email or password" in resp.data


def test_login_unknown_email_gives_same_message(client):
    resp = client.login(email="nobody@example.com")
    assert resp.status_code == 401
    assert b"Incorrect email or password" in resp.data


def test_login_is_throttled_after_repeated_failures(client):
    client.register()
    client.post("/logout")
    client.ensure_csrf()
    for _ in range(5):
        client.login(password="wrong-pass1")
    resp = client.login()  # even the right password is refused while locked
    assert resp.status_code == 429


def test_login_redirects_to_safe_next_only(client):
    client.register()
    client.post("/logout")
    client.ensure_csrf()
    resp = client.post("/login?next=/goals/", {"email": "asha@example.com", "password": PASSWORD})
    assert resp.location.endswith("/goals/")
    client.post("/logout")
    client.ensure_csrf()
    resp = client.post("/login?next=//evil.example/x", {"email": "asha@example.com", "password": PASSWORD})
    assert "evil.example" not in resp.location


def test_protected_pages_require_login(client):
    for url in ["/dashboard", "/transactions/", "/budgets/", "/goals/", "/recurring/", "/analytics/", "/settings/"]:
        resp = client.get(url)
        assert resp.status_code == 302
        assert "/login" in resp.location


def test_logout_requires_post(client):
    client.register()
    assert client.get("/logout").status_code == 405


def test_demo_sandbox_is_gone(client):
    assert client.post("/demo").status_code == 404
    for page in ("/", "/login"):
        assert b"demo" not in client.get(page).data.lower()


def session_cookie(resp):
    return next(h for h in resp.headers.getlist("Set-Cookie") if h.startswith("session="))


def test_sign_in_lasts_30_days_without_ticking_anything(client):
    """Android drops browser-only cookies when it closes the app, which signed people out."""
    client.register()
    client.post("/logout")
    client.ensure_csrf()
    resp = client.post("/login", {"email": "asha@example.com", "password": "secret123"})
    cookie = session_cookie(resp)
    assert "Expires=" in cookie
    from email.utils import parsedate_to_datetime
    from datetime import datetime, timezone
    expires = parsedate_to_datetime(cookie.split("Expires=")[1].split(";")[0])
    days = (expires - datetime.now(timezone.utc)).days
    assert 29 <= days <= 30


def test_each_visit_renews_the_session(client):
    client.register()
    resp = client.get("/dashboard")
    assert "Expires=" in session_cookie(resp)


def test_session_of_deleted_user_is_cleared(app, client):
    client.register()
    uid = user_id(app)
    with app.app_context():
        db = get_db()
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        db.commit()
    assert client.get("/dashboard").status_code == 302


def test_new_brand_on_public_pages(client):
    page = client.get("/").data.decode()
    assert "Paylog" in page and "Spendly" not in page
    assert 'class="brand-logo"' in page


def test_new_accounts_default_to_paylog_theme(client):
    client.register()
    assert 'data-theme="paylog"' in client.get("/dashboard").data.decode()
