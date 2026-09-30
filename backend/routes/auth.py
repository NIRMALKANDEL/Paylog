import re
import secrets

from flask import (
    Blueprint, current_app, flash, g, redirect, render_template, request, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

from database.db import get_db
from services.mailer import mail_enabled, send_mail
from services.security import (
    email_ip_throttle, email_throttle, login_required, login_throttle, safe_next_url,
)
from services.tokens import (
    check_reset_token, check_verify_token, make_reset_token, make_verify_token, session_fingerprint,
)

bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Hash of a random password, checked when the email is unknown so a failed
# login takes the same time whether or not the account exists.
_DUMMY_HASH = generate_password_hash(secrets.token_hex(16))


def validate_password(password):
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if len(password) > 128:
        return "Password must be at most 128 characters."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password must contain at least one letter and one number."
    return None


def validate_name(name):
    if not name:
        return "Name is required."
    if len(name) > 60:
        return "Name must be at most 60 characters."
    return None


def validate_email(email):
    if not email or len(email) > 254 or not EMAIL_RE.match(email):
        return "Enter a valid email address."
    return None


def get_user(user_id):
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def start_session(user):
    """Log in with a fresh session so a pre-login session id can't be reused.

    Sessions are always persistent (30 days, renewed on every visit). A
    browser-only cookie was lost whenever Android closed the app in the
    background, which signed people out constantly.
    """
    session.clear()
    session["user_id"] = user["id"]
    session["fp"] = session_fingerprint(user)
    session.permanent = True


def load_logged_in_user():
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        user = get_user(user_id)
        # A password change elsewhere alters the fingerprint and ends this session.
        if user is None or session.get("fp") != session_fingerprint(user):
            session.clear()
        else:
            g.user = user


def client_ip():
    return request.remote_addr or "unknown"


def first_name(user):
    parts = user["name"].split()
    return parts[0] if parts else "there"


# ------------------------------------------------------------------ #
# Emails                                                              #
# ------------------------------------------------------------------ #

def send_verification_email(user):
    link = url_for("auth.verify_email", token=make_verify_token(user), _external=True)
    name = first_name(user)
    text = (
        f"Hi {name},\n\n"
        "Please confirm your email address for Paylog by opening this link:\n\n"
        f"{link}\n\n"
        "The link is valid for 3 days. If you didn't create a Paylog account, you can ignore this email.\n\n"
        "- Paylog"
    )
    html = render_template("email/verify.html", name=name, link=link)
    sent = send_mail(user["email"], "Confirm your Paylog email", text, html)
    if sent:
        db = get_db()
        db.execute("UPDATE users SET verification_sent_at = datetime('now') WHERE id = ?", (user["id"],))
        db.commit()
    return sent


def send_reset_email(user):
    link = url_for("auth.reset_password", token=make_reset_token(user), _external=True)
    name = first_name(user)
    text = (
        f"Hi {name},\n\n"
        "Someone (hopefully you) asked to reset your Paylog password. Open this link to choose a new one:\n\n"
        f"{link}\n\n"
        "The link works once and expires in 1 hour. If you didn't ask for this, ignore this email; "
        "your password stays the same.\n\n"
        "- Paylog"
    )
    html = render_template("email/reset.html", name=name, link=link)
    return send_mail(user["email"], "Reset your Paylog password", text, html)


@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("main.dashboard"))
    form = {"name": "", "email": ""}
    error = None
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")
        form = {"name": name, "email": email}
        error = validate_name(name) or validate_email(email) or validate_password(password)
        if not error and password != confirm:
            error = "Passwords do not match."
        db = get_db()
        if not error and db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            error = "An account with that email already exists."
        if not error:
            cur = db.execute(
                "INSERT INTO users (name, email, password_hash, theme) VALUES (?, ?, ?, 'paylog')",
                (name, email, generate_password_hash(password)),
            )
            db.commit()
            user = get_user(cur.lastrowid)
            start_session(user)
            message = f"Welcome to Paylog, {first_name(user)}!"
            if mail_enabled():
                email_throttle.record(f"email:{email}")
                if send_verification_email(user):
                    message += f" We sent a confirmation link to {email}."
            flash(message, "success")
            return redirect(url_for("main.dashboard"))
    return render_template("auth/register.html", form=form, error=error), (400 if error else 200)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("main.dashboard"))
    email = ""
    error = None
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        keys = (f"ip:{request.remote_addr}", f"email:{email}")
        if login_throttle.is_blocked(*keys):
            error = "Too many failed attempts. Please wait 15 minutes and try again."
            return render_template("auth/login.html", email=email, error=error), 429
        user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        valid = check_password_hash(user["password_hash"] if user else _DUMMY_HASH, password)
        if user and valid:
            login_throttle.reset(*keys)
            start_session(user)
            target = safe_next_url(request.args.get("next"), url_for("main.dashboard"))
            return redirect(target)
        login_throttle.record_failure(*keys)
        error = "Incorrect email or password."
    return render_template("auth/login.html", email=email, error=error), (401 if error else 200)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You've been signed out.", "info")
    return redirect(url_for("main.landing"))


# ------------------------------------------------------------------ #
# Password reset                                                      #
# ------------------------------------------------------------------ #

@bp.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if g.user:
        return redirect(url_for("settings.index") + "#security")
    if not mail_enabled():
        return render_template("auth/forgot.html", sent=False, email="", unavailable=True), 503
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        if validate_email(email):
            return render_template("auth/forgot.html", sent=False, email=email,
                                   error="Enter a valid email address."), 400
        email_key, ip_key = f"email:{email}", f"ip:{client_ip()}"
        if email_ip_throttle.is_blocked(ip_key):
            return render_template("auth/forgot.html", sent=False, email=email,
                                   error="Too many requests. Please wait 15 minutes and try again."), 429
        email_ip_throttle.record(ip_key)
        user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        # Same response whether or not the account exists, so this page can't be
        # used to discover who has an account.
        if user and not email_throttle.is_blocked(email_key):
            email_throttle.record(email_key)
            send_reset_email(user)
        return render_template("auth/forgot.html", sent=True, email=email)
    return render_template("auth/forgot.html", sent=False, email="")


@bp.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token):
    db = get_db()
    user, problem = check_reset_token(db, token)
    if problem:
        message = ("This reset link has expired." if problem == "expired"
                   else "This reset link is invalid or has already been used.")
        flash(message + " Request a new one below.", "error")
        return redirect(url_for("auth.forgot_password"))
    error = None
    if request.method == "POST":
        password = request.form.get("password", "")
        error = validate_password(password)
        if not error and password != request.form.get("confirm_password", ""):
            error = "Passwords do not match."
        if not error:
            # Following the emailed link proves the address belongs to them.
            db.execute("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?",
                       (generate_password_hash(password), user["id"]))
            db.commit()
            login_throttle.reset(f"email:{user['email']}")
            session.clear()  # every other session ends too: the fingerprint changed
            flash("Your password has been reset. Sign in with your new password.", "success")
            return redirect(url_for("auth.login"))
    return render_template("auth/reset.html", token=token, error=error), (400 if error else 200)


# ------------------------------------------------------------------ #
# Email verification                                                  #
# ------------------------------------------------------------------ #

@bp.route("/verify-email/<token>")
def verify_email(token):
    db = get_db()
    user, problem = check_verify_token(db, token)
    if problem:
        flash("This confirmation link has expired." if problem == "expired"
              else "This confirmation link is invalid.", "error")
    elif user["email_verified"]:
        flash("Your email is already confirmed.", "info")
    else:
        db.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (user["id"],))
        db.commit()
        flash("Email confirmed. Thanks!", "success")
    return redirect(url_for("main.dashboard") if g.user else url_for("auth.login"))


@bp.route("/verify-email/resend", methods=["POST"])
@login_required
def resend_verification():
    user = g.user
    target = safe_next_url(request.form.get("next"), url_for("main.dashboard"))
    if user["email_verified"] or not mail_enabled():
        return redirect(target)
    cooldown = int(current_app.config["EMAIL_RESEND_COOLDOWN_SECONDS"])
    recent = get_db().execute(
        "SELECT 1 FROM users WHERE id = ? AND verification_sent_at > datetime('now', ?)",
        (user["id"], f"-{cooldown} seconds"),
    ).fetchone()
    email_key = f"email:{user['email'].lower()}"
    if recent or email_throttle.is_blocked(email_key):
        flash("We just sent you a link. Please wait a minute before asking again.", "info")
    else:
        email_throttle.record(email_key)
        if send_verification_email(user):
            flash(f"Confirmation link sent to {user['email']}.", "success")
        else:
            flash("We couldn't send the email right now. Please try again later.", "error")
    return redirect(target)
