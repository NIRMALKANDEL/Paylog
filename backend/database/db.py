"""SQLite access: connection per request and schema creation."""

import sqlite3
from pathlib import Path

import click
from flask import current_app, g
from flask.cli import with_appcontext

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    email                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT    NOT NULL,
    currency             TEXT    NOT NULL DEFAULT 'INR',
    theme                TEXT    NOT NULL DEFAULT 'paylog',
    mode                 TEXT    NOT NULL DEFAULT 'system',
    accent               TEXT,
    monthly_budget_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_budget_cents >= 0),
    email_verified       INTEGER NOT NULL DEFAULT 0,
    auto_save_receipts   INTEGER NOT NULL DEFAULT 1,
    verification_sent_at TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL CHECK (kind IN ('expense', 'income')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category     TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    frequency    TEXT    NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
    anchor_day   INTEGER NOT NULL,
    next_date    TEXT    NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL CHECK (kind IN ('expense', 'income')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category     TEXT    NOT NULL,
    date         TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
    reference    TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions (user_id, date);

CREATE TABLE IF NOT EXISTS budgets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category     TEXT    NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    UNIQUE (user_id, category)
);

-- Mobile app sign-ins. Only a SHA-256 of each token is stored; `fp` ties the
-- token to the password, so changing or resetting it signs the app out.
CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT    NOT NULL UNIQUE,
    fp           TEXT    NOT NULL,
    device       TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens (user_id);

CREATE TABLE IF NOT EXISTS goals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    target_cents INTEGER NOT NULL CHECK (target_cents > 0),
    saved_cents  INTEGER NOT NULL DEFAULT 0 CHECK (saved_cents >= 0),
    target_date  TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """Return this request's connection, opening it on first use."""
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add
# them to an existing database, so they are applied here, idempotently.
MIGRATIONS = [
    ("users", "email_verified", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "verification_sent_at", "TEXT"),
    ("transactions", "reference", "TEXT"),  # UPI transaction ID, used to spot duplicate receipts
    ("users", "auto_save_receipts", "INTEGER NOT NULL DEFAULT 1"),
]


def migrate(db):
    for table, column, definition in MIGRATIONS:
        existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
    db.execute("CREATE INDEX IF NOT EXISTS idx_transactions_user_reference ON transactions (user_id, reference)")
    # The demo sandbox was removed; clear out any throwaway demo accounts left behind.
    if "is_demo" in {row["name"] for row in db.execute("PRAGMA table_info(users)")}:
        db.execute("DELETE FROM users WHERE is_demo = 1")


def init_db():
    Path(current_app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    db = get_db()
    db.executescript(SCHEMA)
    migrate(db)
    db.commit()


# ------------------------------------------------------------------ #
# CLI                                                                 #
# ------------------------------------------------------------------ #

@click.command("init-db")
@with_appcontext
def init_db_command():
    """Create tables if they do not exist."""
    init_db()
    click.echo("Database initialised.")


@click.command("backup-db")
@with_appcontext
def backup_db_command():
    """Snapshot the database into BACKUP_DIR (run daily from a scheduler)."""
    from services.backup import create_backup, list_backups

    cfg = current_app.config
    path = create_backup(cfg["DATABASE"], cfg["BACKUP_DIR"], cfg["BACKUP_KEEP"])
    click.echo(f"Backup written to {path}")
    click.echo(f"{len(list_backups(cfg['BACKUP_DIR']))} backups kept in {cfg['BACKUP_DIR']}")


def init_app(app):
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    app.cli.add_command(backup_db_command)
    with app.app_context():
        init_db()
