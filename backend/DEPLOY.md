# Deploying the Paylog server on PythonAnywhere

These steps switch the live site at **devnirmal.pythonanywhere.com** from the old Spendly code to Paylog.
**Every existing account and transaction is kept**: Paylog uses the same database file and upgrades it
automatically (it only adds a table for app sign-ins and removes leftover demo accounts).

> Never paste passwords or keys into chat, GitHub or screenshots. They only go in the PythonAnywhere WSGI file.

## 1. Back up first (1 minute)

PythonAnywhere → **Files** → open `Spendly/instance/` → download `spendly.db` to your PC.

## 2. Get the Paylog code (Bash console)

PythonAnywhere → **Consoles** → **Bash**, then paste:

```bash
cd ~
git clone https://github.com/NIRMALKANDEL/PAYLOG.git Paylog
cd Paylog/backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 3. Point the website at Paylog (Web tab)

On the **Web** tab change these three boxes:

| Setting | New value |
|---|---|
| Source code | `/home/devNirmal/Paylog/backend` |
| Virtualenv | `/home/devNirmal/Paylog/backend/venv` |
| Static files: URL `/static/` → Directory | `/home/devNirmal/Paylog/backend/static` |

## 4. Edit the WSGI file (Web tab → "WSGI configuration file")

Change only these lines and leave your secret values exactly as they are:

```python
path = "/home/devNirmal/Paylog/backend"          # was .../Spendly
os.environ["DATABASE_PATH"] = "/home/devNirmal/Spendly/instance/spendly.db"   # keep: same data
os.environ["BACKUP_DIR"] = "/home/devNirmal/Spendly/instance/backups"          # add this line
os.environ["MAIL_FROM"] = "Paylog <your-gmail@gmail.com>"                      # was "Spendly <...>"
```

## 5. Reload and check

1. Click the green **Reload** button.
2. Open https://devnirmal.pythonanywhere.com: you should see the new Paylog logo.
3. Open https://devnirmal.pythonanywhere.com/api/v1/health: it should show `{"ok": true}`.
4. Sign in on the website with your usual account: your data is all there.

If something goes wrong, put the three Web-tab boxes back to the `Spendly` paths, change `path` in the WSGI file
back, and click **Reload**. The old site comes straight back.

## 6. Backups

Paylog makes a daily copy of the database by itself (in `BACKUP_DIR`, newest 14 kept) the first time
someone uses the site each day. Free accounts can't run scheduled tasks, so nothing else is needed. On a paid
account you can also add a task: `cd /home/devNirmal/Paylog/backend && venv/bin/flask --app app backup-db`

## Updating later

```bash
cd ~/Paylog && git pull && cd backend && source venv/bin/activate && pip install -r requirements.txt
```

Then **Reload** on the Web tab.

**Free account: once a month** go to the Web tab and click **Run until 1 month from today**, or the site is
switched off (PythonAnywhere emails you a week before).
