"""JSON API for the Paylog mobile app (Android + iOS).

Authentication is a bearer token (`Authorization: Bearer <token>`), never a
cookie, so these endpoints are not exposed to CSRF and are exempt from it.
Tokens:
  - are random, and only their SHA-256 is stored;
  - last API_TOKEN_DAYS (30) days and every use pushes the expiry forward, so
    an app that is used regularly stays signed in;
  - end on sign-out, account deletion, or a password change/reset (they carry
    the same password fingerprint as web sessions).
Amounts are integer cents; dates are ISO "YYYY-MM-DD".
"""

import hashlib
import math
import secrets

from flask import Blueprint, current_app, g, jsonify, request
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash

from database.db import get_db
from routes import budgets as budgets_routes
from routes import settings as settings_routes
from routes import transactions as tx_routes
from routes.analytics import RANGES, resolve_range
from routes.auth import (
    _DUMMY_HASH, first_name, get_user, send_reset_email, send_verification_email, validate_email,
    validate_name, validate_password,
)
from routes.goals import MAX_GOALS, describe_goal, get_owned_goal, validate_goal
from routes.recurring import MAX_RULES, get_owned_rule, monthly_commitments, toggle_rule
from services import analytics
from services.categories import (
    CATEGORIES, CURRENCIES, EXPENSE_CATEGORIES, FREQUENCIES, INCOME_CATEGORIES, MODES, THEMES,
)
from services.dates import add_months, last_n_month_keys, month_end, month_start, parse_date, parse_month, today
from services.mailer import mail_enabled
from services.money import format_money, parse_amount
from services.receipt_ai import ReceiptAIError, ai_enabled, extract_receipt
from services.receipt_ocr import OnlineReaderError, ocr_enabled, read_lines
from services.receipts import MAX_TEXT_LENGTH, parse_receipt_lines, parse_receipt_text
from services.recurring import run_due
from services.security import email_ip_throttle, email_throttle, login_throttle
from services.tokens import session_fingerprint

bp = Blueprint("api", __name__, url_prefix="/api/v1")

PUBLIC_ENDPOINTS = {"api.login", "api.register", "api.forgot_password", "api.meta", "api.health"}
# Refreshing the expiry on every single request would write to the database
# constantly; once an hour is plenty for a 30-day window.
TOUCH_INTERVAL = "-1 hours"


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

class ApiError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


def fail(message, status=400, **extra):
    raise ApiError(message, status, **extra)


def body():
    data = request.get_json(silent=True)
    if data is None:
        data = request.form.to_dict()
    if not isinstance(data, dict):
        fail("Send a JSON object.")
    # Numbers are accepted for amounts, but the validators expect text.
    return {k: (str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v) for k, v in data.items()}


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(user, device=""):
    token = secrets.token_urlsafe(32)
    days = int(current_app.config["API_TOKEN_DAYS"])
    db = get_db()
    db.execute(
        "INSERT INTO api_tokens (user_id, token_hash, fp, device, expires_at)"
        " VALUES (?, ?, ?, ?, datetime('now', ?))",
        (user["id"], hash_token(token), session_fingerprint(user), (device or "")[:80], f"+{days} days"),
    )
    # Keep only the newest sign-ins per account, and drop expired ones.
    db.execute("DELETE FROM api_tokens WHERE expires_at < datetime('now')")
    db.execute(
        "DELETE FROM api_tokens WHERE user_id = ? AND id NOT IN"
        " (SELECT id FROM api_tokens WHERE user_id = ? ORDER BY id DESC LIMIT ?)",
        (user["id"], user["id"], int(current_app.config["API_MAX_TOKENS_PER_USER"])),
    )
    db.commit()
    return token


def bearer_token():
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def authenticate():
    """Set g.user / g.token_id from the bearer token, or return None."""
    token = bearer_token()
    if not token:
        return None
    db = get_db()
    row = db.execute(
        "SELECT * FROM api_tokens WHERE token_hash = ? AND expires_at > datetime('now')", (hash_token(token),)
    ).fetchone()
    if row is None:
        return None
    user = get_user(row["user_id"])
    if user is None or row["fp"] != session_fingerprint(user):
        # The password changed since this sign-in: the token is dead for good.
        db.execute("DELETE FROM api_tokens WHERE id = ?", (row["id"],))
        db.commit()
        return None
    days = int(current_app.config["API_TOKEN_DAYS"])
    touched = db.execute(
        "UPDATE api_tokens SET last_used_at = datetime('now'), expires_at = datetime('now', ?)"
        " WHERE id = ? AND last_used_at < datetime('now', ?)",
        (f"+{days} days", row["id"], TOUCH_INTERVAL),
    ).rowcount
    if touched:
        db.commit()
    g.token_id = row["id"]
    return user


def user_json(user):
    return {
        "id": user["id"],
        "name": user["name"],
        "first_name": first_name(user),
        "email": user["email"],
        "currency": user["currency"],
        "theme": user["theme"],
        "mode": user["mode"],
        "accent": user["accent"],
        "monthly_budget_cents": user["monthly_budget_cents"],
        "email_verified": bool(user["email_verified"]),
        "auto_save_receipts": bool(user["auto_save_receipts"]),
        "created_at": user["created_at"],
    }


def tx_json(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "amount_cents": row["amount_cents"],
        "category": row["category"],
        "date": row["date"],
        "description": row["description"],
        "reference": row["reference"] if "reference" in row.keys() else None,
        "time": row["time"] if "time" in row.keys() else None,
        "method": row["method"] if "method" in row.keys() else None,
        "recurring": bool(row["recurring_id"]) if "recurring_id" in row.keys() else False,
    }


def goal_json(info):
    goal = info["goal"]
    return {
        "id": goal["id"],
        "name": goal["name"],
        "target_cents": goal["target_cents"],
        "saved_cents": goal["saved_cents"],
        "target_date": goal["target_date"],
        "percent": round(info["percent"], 1),
        "remaining_cents": info["remaining"],
        "months_left": info["months_left"],
        "monthly_needed_cents": info["monthly_needed"],
        "status": info["status"],
    }


def rule_json(rule):
    return {
        "id": rule["id"],
        "kind": rule["kind"],
        "amount_cents": rule["amount_cents"],
        "category": rule["category"],
        "description": rule["description"],
        "frequency": rule["frequency"],
        "next_date": rule["next_date"],
        "active": bool(rule["active"]),
    }


def budget_json(status):
    def with_status(item):
        return {**item, "percent": round(item["percent"], 1), "status": analytics.status_for(item["percent"])}

    return {
        "overall": with_status(status["overall"]) if status["overall"] else None,
        "categories": [with_status(c) for c in status["categories"]],
        "total_spent": status["total_spent"],
    }


def fmt_money(cents):
    return format_money(cents, g.user["currency"])


def refresh_user():
    g.user = get_user(g.user["id"])
    return g.user


# ------------------------------------------------------------------ #
# Request lifecycle                                                   #
# ------------------------------------------------------------------ #

@bp.before_request
def require_token():
    # The API ignores the browser session cookie completely.
    g.user = None
    if request.endpoint in PUBLIC_ENDPOINTS:
        return None
    user = authenticate()
    if user is None:
        return jsonify(ok=False, error="Please sign in again.", code="unauthorized"), 401
    g.user = user
    run_due(get_db(), user["id"], today())
    return None


@bp.after_request
def no_store(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.errorhandler(ApiError)
def handle_api_error(err):
    return jsonify(ok=False, error=err.message, **err.extra), err.status


@bp.errorhandler(HTTPException)
def handle_http_error(err):
    messages = {404: "Not found.", 405: "Method not allowed.", 413: "That file is too large."}
    return jsonify(ok=False, error=messages.get(err.code, err.description)), err.code


# ------------------------------------------------------------------ #
# Public                                                              #
# ------------------------------------------------------------------ #

@bp.get("/health")
def health():
    return jsonify(ok=True)


@bp.get("/meta")
def meta():
    return jsonify(
        categories=CATEGORIES,
        currencies={code: {"symbol": s, "grouping": grp, "label": label} for code, (s, grp, label) in CURRENCIES.items()},
        themes=THEMES,
        modes=list(MODES),
        frequencies=list(FREQUENCIES),
        ranges={k: v[0] for k, v in RANGES.items()},
        mail_enabled=mail_enabled(),
        receipt_ai=ai_enabled(),
        online_reader=online_reader(),
    )


@bp.post("/auth/register")
def register():
    data = body()
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    error = validate_name(name) or validate_email(email) or validate_password(password)
    db = get_db()
    if not error and db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        error = "An account with that email already exists."
    if error:
        fail(error)
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, theme) VALUES (?, ?, ?, 'paylog')",
        (name, email, generate_password_hash(password)),
    )
    db.commit()
    user = get_user(cur.lastrowid)
    verification_sent = False
    if mail_enabled():
        email_throttle.record(f"email:{email}")
        verification_sent = send_verification_email(user)
    token = issue_token(user, data.get("device"))
    return jsonify(ok=True, token=token, user=user_json(user), verification_sent=verification_sent), 201


@bp.post("/auth/login")
def login():
    data = body()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    keys = (f"ip:{request.remote_addr}", f"email:{email}")
    if login_throttle.is_blocked(*keys):
        fail("Too many failed attempts. Please wait 15 minutes and try again.", 429)
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    valid = check_password_hash(user["password_hash"] if user else _DUMMY_HASH, password)
    if not (user and valid):
        login_throttle.record_failure(*keys)
        fail("Incorrect email or password.", 401)
    login_throttle.reset(*keys)
    return jsonify(ok=True, token=issue_token(user, data.get("device")), user=user_json(user))


@bp.post("/auth/forgot-password")
def forgot_password():
    if not mail_enabled():
        fail("Password reset by email isn't available right now.", 503)
    email = (body().get("email") or "").strip().lower()
    if validate_email(email):
        fail("Enter a valid email address.")
    ip_key = f"ip:{request.remote_addr}"
    if email_ip_throttle.is_blocked(ip_key):
        fail("Too many requests. Please wait 15 minutes and try again.", 429)
    email_ip_throttle.record(ip_key)
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    # Same answer whether or not the account exists.
    if user and not email_throttle.is_blocked(f"email:{email}"):
        email_throttle.record(f"email:{email}")
        send_reset_email(user)
    return jsonify(ok=True, message=f"If {email} has an account, a reset link is on its way.")


# ------------------------------------------------------------------ #
# Account                                                             #
# ------------------------------------------------------------------ #

@bp.post("/auth/logout")
def logout():
    db = get_db()
    db.execute("DELETE FROM api_tokens WHERE id = ?", (g.token_id,))
    db.commit()
    return jsonify(ok=True)


@bp.get("/me")
def me():
    return jsonify(user=user_json(g.user))


@bp.patch("/me")
def update_me():
    data = body()
    user = g.user
    fields = {}
    if "name" in data:
        name = (data.get("name") or "").strip()
        if error := validate_name(name):
            fail(error)
        fields["name"] = name
    if "currency" in data:
        if data["currency"] not in CURRENCIES:
            fail("Choose a supported currency.")
        fields["currency"] = data["currency"]
    if "theme" in data:
        if data["theme"] not in THEMES:
            fail("Choose a valid theme.")
        fields["theme"] = data["theme"]
    if "mode" in data:
        if data["mode"] not in MODES:
            fail("Choose light, dark or system.")
        fields["mode"] = data["mode"]
    if "accent" in data:
        accent = (data.get("accent") or "").strip() or None
        if accent and not settings_routes.HEX_COLOR.match(accent):
            fail("Accent must be a colour like #1a472a.")
        fields["accent"] = accent.lower() if accent else None
    if "auto_save_receipts" in data:
        value = data["auto_save_receipts"]
        fields["auto_save_receipts"] = 1 if value in (True, 1, "1", "true", "on") else 0
    if fields:
        db = get_db()
        assignments = ", ".join(f"{column} = ?" for column in fields)  # keys are fixed names above
        db.execute(f"UPDATE users SET {assignments} WHERE id = ?", (*fields.values(), user["id"]))
        db.commit()
    return jsonify(ok=True, user=user_json(refresh_user()))


@bp.post("/me/password")
def change_password():
    data = body()
    if not check_password_hash(g.user["password_hash"], data.get("current_password") or ""):
        fail("Your current password is incorrect.")
    new = data.get("new_password") or ""
    if error := validate_password(new):
        fail(error)
    db = get_db()
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(new), g.user["id"]))
    # This phone stays signed in; every other device and browser is signed out.
    db.execute("DELETE FROM api_tokens WHERE user_id = ? AND id != ?", (g.user["id"], g.token_id))
    db.execute("UPDATE api_tokens SET fp = ? WHERE id = ?", (session_fingerprint(get_user(g.user["id"])), g.token_id))
    db.commit()
    return jsonify(ok=True, message="Password changed. Other devices have been signed out.")


@bp.post("/me/email")
def change_email():
    data = body()
    user = g.user
    new_email = (data.get("email") or "").strip().lower()
    if not check_password_hash(user["password_hash"], data.get("password") or ""):
        fail("Your password is incorrect; email not changed.")
    if error := validate_email(new_email):
        fail(error)
    if new_email == user["email"].lower():
        fail("That's already your email address.")
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (new_email,)).fetchone():
        fail("Another account already uses that email.")
    db.execute("UPDATE users SET email = ?, email_verified = 0, verification_sent_at = NULL WHERE id = ?",
               (new_email, user["id"]))
    db.commit()
    message = "Email updated."
    if mail_enabled():
        email_throttle.record(f"email:{new_email}")
        if send_verification_email(get_user(user["id"])):
            message += f" We sent a confirmation link to {new_email}."
    return jsonify(ok=True, message=message, user=user_json(refresh_user()))


@bp.post("/me/resend-verification")
def resend_verification():
    user = g.user
    if user["email_verified"] or not mail_enabled():
        return jsonify(ok=True, message="Nothing to send.")
    cooldown = int(current_app.config["EMAIL_RESEND_COOLDOWN_SECONDS"])
    recent = get_db().execute(
        "SELECT 1 FROM users WHERE id = ? AND verification_sent_at > datetime('now', ?)",
        (user["id"], f"-{cooldown} seconds"),
    ).fetchone()
    email_key = f"email:{user['email'].lower()}"
    if recent or email_throttle.is_blocked(email_key):
        fail("We just sent you a link. Please wait a minute before asking again.", 429)
    email_throttle.record(email_key)
    if not send_verification_email(user):
        fail("We couldn't send the email right now. Please try again later.", 502)
    return jsonify(ok=True, message=f"Confirmation link sent to {user['email']}.")


@bp.post("/me/delete")
def delete_account():
    if not check_password_hash(g.user["password_hash"], body().get("password") or ""):
        fail("Password is incorrect; your account was not deleted.")
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (g.user["id"],))  # cascades to all data and tokens
    db.commit()
    return jsonify(ok=True)


@bp.get("/me/export.json")
def export_json():
    return settings_routes.export_json()


# ------------------------------------------------------------------ #
# Dashboard                                                           #
# ------------------------------------------------------------------ #

@bp.get("/dashboard")
def dashboard():
    db = get_db()
    user = g.user
    uid = user["id"]
    real_today = today()
    current = month_start(real_today)
    # ?month=YYYY-MM looks back at an earlier month; the future isn't shown.
    this_first = min(parse_month(request.args.get("month"), current), current)
    is_current = this_first == current
    now = real_today if is_current else month_end(this_first)
    prev_first = add_months(this_first, -1)
    trend = analytics.monthly_series(db, uid, last_n_month_keys(now, 6))
    recent = db.execute(
        "SELECT * FROM transactions WHERE user_id = ? AND date BETWEEN ? AND ?"
        " ORDER BY date DESC, id DESC LIMIT 8",
        (uid, this_first.isoformat(), month_end(this_first).isoformat()),
    ).fetchall()
    goals = db.execute(
        "SELECT * FROM goals WHERE user_id = ? ORDER BY (saved_cents * 1.0 / target_cents) DESC LIMIT 3", (uid,)
    ).fetchall()
    has_any = db.execute("SELECT 1 FROM transactions WHERE user_id = ? LIMIT 1", (uid,)).fetchone()
    return jsonify(
        month=this_first.isoformat()[:7],
        month_name=this_first.strftime("%B %Y"),
        is_current=is_current,
        prev_month=add_months(this_first, -1).isoformat()[:7],
        next_month=None if is_current else add_months(this_first, 1).isoformat()[:7],
        today=real_today.isoformat(),
        has_any=bool(has_any),
        this_month=analytics.totals(db, uid, this_first, month_end(now)),
        last_month=analytics.totals(db, uid, prev_first, month_end(prev_first)),
        categories=analytics.category_totals(db, uid, this_first, month_end(now)),
        budget=budget_json(analytics.budget_status(db, user, this_first)),
        recent=[tx_json(r) for r in recent],
        goals=[goal_json(describe_goal(r, real_today)) for r in goals],
        insights=analytics.dashboard_insights(db, user, now, fmt_money) if is_current else [],
        trend=trend,
        pace={
            "days_in_month": month_end(now).day,
            "this_month": analytics.cumulative_daily(db, uid, this_first, through_day=now.day),
            "last_month": analytics.cumulative_daily(db, uid, prev_first),
            "budget": user["monthly_budget_cents"],
        },
    )


# ------------------------------------------------------------------ #
# Transactions                                                        #
# ------------------------------------------------------------------ #

@bp.get("/transactions")
def list_transactions():
    db = get_db()
    filters = tx_routes.read_filters(request.args)
    where, params = tx_routes.build_where(filters)
    summary = db.execute(
        f"""
        SELECT COUNT(*) AS count,
               COALESCE(SUM(CASE WHEN kind = 'income'  THEN amount_cents END), 0) AS income,
               COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents END), 0) AS expense
        FROM transactions WHERE {where}
        """,
        params,
    ).fetchone()
    per_page = tx_routes.PER_PAGE
    pages = max(1, math.ceil(summary["count"] / per_page))
    page = min(max(request.args.get("page", 1, type=int) or 1, 1), pages)
    rows = db.execute(
        f"SELECT * FROM transactions WHERE {where} ORDER BY {tx_routes.SORTS[filters['sort']]} LIMIT ? OFFSET ?",
        params + [per_page, (page - 1) * per_page],
    ).fetchall()
    return jsonify(
        items=[tx_json(r) for r in rows],
        page=page,
        pages=pages,
        summary=dict(summary),
        categories=sorted(set(EXPENSE_CATEGORIES + INCOME_CATEGORIES)),
    )


@bp.post("/transactions")
def create_transaction():
    data = body()
    clean, error = tx_routes.validate_transaction(data)
    if error:
        fail(error)
    duplicate = tx_routes.find_duplicate(g.user["id"], clean["reference"])
    if duplicate and data.get("allow_duplicate") not in (True, "1", "true"):
        fail("You've already saved a payment with this UPI reference.", 409, duplicate=dict(duplicate))
    tx_id = tx_routes.insert_transaction(g.user["id"], clean)
    return jsonify(ok=True, transaction=tx_json(tx_routes.get_owned_transaction(tx_id))), 201


@bp.get("/transactions/<int:tx_id>")
def get_transaction(tx_id):
    return jsonify(transaction=tx_json(tx_routes.get_owned_transaction(tx_id)))


@bp.put("/transactions/<int:tx_id>")
def update_transaction(tx_id):
    tx = tx_routes.get_owned_transaction(tx_id)
    data = body()
    clean, error = tx_routes.validate_transaction(data)
    if error:
        fail(error)
    # Older app versions don't send time/method: keep what's saved instead of clearing it.
    for key in ("time", "method"):
        if key not in data:
            clean[key] = tx[key]
    db = get_db()
    db.execute(
        "UPDATE transactions SET kind = ?, amount_cents = ?, category = ?, date = ?, description = ?,"
        " time = ?, method = ? WHERE id = ? AND user_id = ?",
        (clean["kind"], clean["amount_cents"], clean["category"], clean["date"], clean["description"],
         clean["time"], clean["method"], tx_id, g.user["id"]),
    )
    db.commit()
    return jsonify(ok=True, transaction=tx_json(tx_routes.get_owned_transaction(tx_id)))


@bp.delete("/transactions/<int:tx_id>")
def delete_transaction(tx_id):
    tx_routes.get_owned_transaction(tx_id)
    db = get_db()
    db.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, g.user["id"]))
    db.commit()
    return jsonify(ok=True)


@bp.get("/transactions/quick/preview")
def quick_preview():
    clean, error = tx_routes.quick_parse(request.args.get("q", ""), None, request.args.get("kind"))
    if error:
        return jsonify(ok=False, error=error)
    return jsonify(ok=True, **tx_routes.describe_quick(clean))


def written_day(raw):
    if not raw:
        return None
    try:
        day = parse_date(raw)
    except ValueError:
        fail("written_on must be a date (YYYY-MM-DD).")
    # -1: the phone's time zone may already be on tomorrow's date.
    if not -1 <= (today() - day).days <= 60:
        fail("written_on must be within the last 60 days.")
    return day


@bp.post("/transactions/quick")
def quick_add():
    """One line of text -> a saved transaction. Used by the app and its home-screen widget.

    Optional `written_on` (YYYY-MM-DD): the day the note was typed, for notes the
    widget saved offline and sends later. The phone's own date also fixes "today"
    when the phone is a day ahead of the server (India just after midnight vs UTC).
    """
    data = body()
    clean, error = tx_routes.quick_parse(data.get("q", ""), written_day(data.get("written_on")),
                                         data.get("kind"), data.get("category"))
    if error:
        fail(error)
    tx_id = tx_routes.insert_transaction(g.user["id"], clean)
    return jsonify(ok=True, transaction=tx_json(tx_routes.get_owned_transaction(tx_id)),
                   **tx_routes.describe_quick(clean)), 201


@bp.get("/transactions/export.csv")
def export_csv():
    return tx_routes.export_csv()


@bp.post("/transactions/import")
def import_csv():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        fail("Choose a CSV file to import.")
    try:
        text = upload.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        fail("The file must be UTF-8 encoded CSV.")
    rows, errors = tx_routes.parse_import(text)
    if errors:
        fail(errors[0] if len(errors) == 1 else f"{len(errors)} rows have problems.", errors=errors[:25])
    tx_routes.save_import(g.user["id"], rows)
    return jsonify(ok=True, imported=len(rows))


# ------------------------------------------------------------------ #
# Receipts                                                            #
# ------------------------------------------------------------------ #

@bp.post("/receipts/parse")
def parse_receipt():
    """Receipt read on the phone -> a draft transaction for the user to review.

    Send `lines` (the phone's OCR, [{"text", "height"}...], top to bottom) or plain
    `text` (a bank SMS, shared text). Or, as multipart, an `image` for the online
    reader when the phone couldn't read it. Nothing is saved here: the app shows
    the draft, and the user saves it (or edits it first).
    """
    now = today()
    data = body()
    receipt = None
    image = None if request.is_json else request.files.get("image")
    if image:
        receipt = read_online(image, now)
    else:
        lines = data.get("lines")
        if isinstance(lines, list) and lines:
            receipt = parse_receipt_lines(lines, now)
        else:
            text = (data.get("text") or "")[:MAX_TEXT_LENGTH]
            if not text.strip():
                fail("We couldn't find any text in that image.", 422)
            receipt = parse_receipt_text(text, now)

    form = receipt.to_form(now)
    duplicate = tx_routes.find_duplicate(g.user["id"], receipt.reference)
    similar = None
    if not duplicate and receipt.amount_cents and receipt.date:
        similar = tx_routes.find_similar(g.user["id"], receipt.kind, receipt.amount_cents, receipt.date)
    return jsonify(
        ok=True,
        form=form,
        found=sorted(receipt.found),
        warnings=receipt.warnings,
        app=receipt.app,
        duplicate=dict(duplicate) if duplicate else None,
        similar=dict(similar) if similar else None,
    )


def read_online(image, now):
    """Read an uploaded receipt image with the configured online reader, or fail with a clear message."""
    from routes.receipts import read_image

    if not online_reader():
        fail("Online reading isn't set up on this server. Please enter the details yourself.", 503)
    raw, media_type = read_image(image, 5 * 1024 * 1024)
    if not raw:
        fail("Choose a JPG, PNG or WebP image.", 400)
    try:
        if ai_enabled():
            return extract_receipt(raw, media_type, now)
        return parse_receipt_lines(read_lines(raw, media_type), now)
    except (ReceiptAIError, OnlineReaderError) as exc:
        fail(f"{exc} Please enter the details yourself.", 422)


def online_reader():
    return ai_enabled() or ocr_enabled()


# ------------------------------------------------------------------ #
# Analytics                                                           #
# ------------------------------------------------------------------ #

@bp.get("/analytics")
def analytics_view():
    db = get_db()
    uid = g.user["id"]
    now = today()
    range_key, start, end = resolve_range(request.args, db, uid, now)
    keys = analytics.month_keys_between(start, end)
    monthly = analytics.monthly_series(db, uid, keys)
    with_spend = [m for m in monthly if m["expense"]]
    return jsonify(
        range=range_key,
        start=start.isoformat(),
        end=end.isoformat(),
        summary=analytics.totals(db, uid, start, end),
        monthly=monthly,
        categories=analytics.category_totals(db, uid, start, end),
        income_categories=analytics.category_totals(db, uid, start, end, kind="income"),
        weekdays=analytics.weekday_totals(db, uid, start, end),
        top=[tx_json(dict(r, kind="expense", reference=None, recurring_id=None))
             for r in analytics.top_expenses(db, uid, start, end)],
        insights=analytics.range_insights(db, uid, start, end, fmt_money),
        avg_month=(sum(m["expense"] for m in with_spend) / len(with_spend)) if with_spend else 0,
        heat_keys=keys[-6:],
        by_category_month=analytics.category_by_month(db, uid, keys[-6:]),
    )


@bp.get("/calculators")
def calculators():
    now = today()
    start = add_months(month_start(now), -3)
    end = month_end(add_months(month_start(now), -1))
    spent = analytics.totals(get_db(), g.user["id"], start, end)["expense"]
    return jsonify(avg_monthly_expense=round(spent / 3 / 100) if spent else None)


# ------------------------------------------------------------------ #
# Budgets                                                             #
# ------------------------------------------------------------------ #

@bp.get("/budgets")
def get_budgets():
    db = get_db()
    uid = g.user["id"]
    current = month_start(today())
    month = min(parse_month(request.args.get("month"), current), current)
    existing = {r["category"]: r["amount_cents"]
                for r in db.execute("SELECT category, amount_cents FROM budgets WHERE user_id = ?", (uid,))}
    spent = {c["category"]: c["total"] for c in analytics.category_totals(db, uid, month, month_end(month))}
    return jsonify(
        month=month.isoformat()[:7],
        month_label=month.strftime("%B %Y"),
        is_current=month == current,
        prev_month=add_months(month, -1).isoformat()[:7],
        next_month=add_months(month, 1).isoformat()[:7] if month < current else None,
        overall_cents=g.user["monthly_budget_cents"],
        limits=existing,
        spent=spent,
        categories=EXPENSE_CATEGORIES,
        status=budget_json(analytics.budget_status(db, g.user, month)),
    )


@bp.put("/budgets")
def save_budgets():
    data = request.get_json(silent=True) or {}
    raw_limits = data.get("limits") or {}
    if not isinstance(raw_limits, dict):
        fail("limits must be an object of category: amount.")
    overall = data.get("overall")
    errors = budgets_routes.apply_budgets(
        get_db(), g.user["id"],
        "" if overall is None else str(overall),
        {c: "" if raw_limits.get(c) is None else str(raw_limits.get(c)) for c in EXPENSE_CATEGORIES},
    )
    if errors:
        fail(errors[0], errors=errors)
    refresh_user()
    return get_budgets()


# ------------------------------------------------------------------ #
# Goals                                                               #
# ------------------------------------------------------------------ #

def goals_payload():
    now = today()
    goals = [describe_goal(row, now) for row in get_db().execute(
        "SELECT * FROM goals WHERE user_id = ? ORDER BY target_date IS NULL, target_date, id", (g.user["id"],))]
    return {
        "goals": [goal_json(i) for i in goals],
        "totals": {
            "target": sum(i["goal"]["target_cents"] for i in goals),
            "saved": sum(min(i["goal"]["saved_cents"], i["goal"]["target_cents"]) for i in goals),
            "monthly": sum(i["monthly_needed"] or 0 for i in goals),
        },
    }


@bp.get("/goals")
def list_goals():
    return jsonify(goals_payload())


@bp.post("/goals")
def create_goal():
    clean, error = validate_goal(body())
    if error:
        fail(error)
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM goals WHERE user_id = ?", (g.user["id"],)).fetchone()[0] >= MAX_GOALS:
        fail(f"You can have up to {MAX_GOALS} goals.")
    db.execute(
        "INSERT INTO goals (user_id, name, target_cents, saved_cents, target_date) VALUES (?, ?, ?, ?, ?)",
        (g.user["id"], clean["name"], clean["target_cents"], clean["saved_cents"], clean["target_date"]),
    )
    db.commit()
    return jsonify(ok=True, **goals_payload()), 201


@bp.put("/goals/<int:goal_id>")
def update_goal(goal_id):
    get_owned_goal(goal_id)
    clean, error = validate_goal(body())
    if error:
        fail(error)
    db = get_db()
    db.execute(
        "UPDATE goals SET name = ?, target_cents = ?, saved_cents = ?, target_date = ? WHERE id = ? AND user_id = ?",
        (clean["name"], clean["target_cents"], clean["saved_cents"], clean["target_date"], goal_id, g.user["id"]),
    )
    db.commit()
    return jsonify(ok=True, **goals_payload())


@bp.post("/goals/<int:goal_id>/contribute")
def contribute(goal_id):
    goal = get_owned_goal(goal_id)
    data = body()
    try:
        amount = parse_amount(data.get("amount"))
    except ValueError as exc:
        fail(str(exc))
    withdraw = data.get("action") == "withdraw"
    if withdraw and amount > goal["saved_cents"]:
        fail("You can't withdraw more than you've saved.")
    new_saved = goal["saved_cents"] + (-amount if withdraw else amount)
    db = get_db()
    db.execute("UPDATE goals SET saved_cents = ? WHERE id = ? AND user_id = ?", (new_saved, goal_id, g.user["id"]))
    db.commit()
    reached = not withdraw and new_saved >= goal["target_cents"] > goal["saved_cents"]
    message = f"🎉 You reached your goal “{goal['name']}”!" if reached else "Goal balance updated."
    return jsonify(ok=True, message=message, reached=reached, **goals_payload())


@bp.delete("/goals/<int:goal_id>")
def delete_goal(goal_id):
    get_owned_goal(goal_id)
    db = get_db()
    db.execute("DELETE FROM goals WHERE id = ? AND user_id = ?", (goal_id, g.user["id"]))
    db.commit()
    return jsonify(ok=True, **goals_payload())


# ------------------------------------------------------------------ #
# Recurring                                                           #
# ------------------------------------------------------------------ #

def recurring_payload():
    rules = get_db().execute(
        "SELECT * FROM recurring WHERE user_id = ? ORDER BY active DESC, next_date", (g.user["id"],)
    ).fetchall()
    return {"rules": [rule_json(r) for r in rules], "monthly": monthly_commitments(rules)}


@bp.get("/recurring")
def list_recurring():
    return jsonify(recurring_payload())


@bp.post("/recurring")
def create_recurring():
    data = body()
    clean, error = tx_routes.validate_transaction(data)
    frequency = data.get("frequency")
    if not error and frequency not in FREQUENCIES:
        error = "Choose how often this repeats."
    db = get_db()
    uid = g.user["id"]
    if not error and db.execute("SELECT COUNT(*) FROM recurring WHERE user_id = ?", (uid,)).fetchone()[0] >= MAX_RULES:
        error = f"You can have up to {MAX_RULES} recurring items."
    if error:
        fail(error)
    start = parse_date(clean["date"])
    db.execute(
        "INSERT INTO recurring (user_id, kind, amount_cents, category, description, frequency, anchor_day, next_date)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (uid, clean["kind"], clean["amount_cents"], clean["category"], clean["description"], frequency,
         start.day, clean["date"]),
    )
    db.commit()
    created = run_due(db, uid, today())
    return jsonify(ok=True, backfilled=created, **recurring_payload()), 201


@bp.post("/recurring/<int:rule_id>/toggle")
def toggle_recurring(rule_id):
    active = toggle_rule(get_owned_rule(rule_id))
    return jsonify(ok=True, active=active, **recurring_payload())


@bp.delete("/recurring/<int:rule_id>")
def delete_recurring(rule_id):
    get_owned_rule(rule_id)
    db = get_db()
    db.execute("DELETE FROM recurring WHERE id = ? AND user_id = ?", (rule_id, g.user["id"]))
    db.commit()
    return jsonify(ok=True, **recurring_payload())

