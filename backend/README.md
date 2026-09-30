# Paylog backend

Flask + SQLite. Serves the Paylog **website** and the **JSON API** (`/api/v1`) used by the Android/iOS app.

```
python -m venv venv
venv\Scripts\pip install -r requirements-dev.txt     # macOS/Linux: venv/bin/pip
venv\Scripts\python app.py                           # http://127.0.0.1:5001
venv\Scripts\python -m pytest                        # 299 tests
```

## Layout

```
app.py                 app factory, blueprints, error pages
config.py              settings (sessions 30 days, API tokens 30 days, mail, backups)
database/db.py         schema, automatic migrations, CLI (init-db, backup-db)
routes/api.py          JSON API for the mobile app (bearer tokens)
routes/*.py            website pages: auth, dashboard, transactions, receipts, budgets, goals, recurring, analytics, settings
services/              money, dates, analytics, quick-add parser, receipt parser, security, mail, backups
templates/, static/    website
tests/                 pytest suite (tests/test_api.py covers the API)
```

## API in one minute

- `POST /api/v1/auth/login` `{email, password, device}` → `{token, user}`; send `Authorization: Bearer <token>` after that.
- Tokens last 30 days and renew as they're used. `POST /api/v1/auth/logout` revokes one; changing or resetting
  the password revokes the others.
- Main endpoints: `/me`, `/dashboard`, `/transactions` (+ `/quick`, `/quick/preview`, `/import`, `/export.csv`),
  `/receipts/parse`, `/analytics`, `/budgets`, `/goals`, `/recurring`, `/calculators`, `/meta`.
- Amounts are integer cents; dates are `YYYY-MM-DD`. Errors are `{ok: false, error: "..."}`.

Deploying: see [DEPLOY.md](DEPLOY.md).
