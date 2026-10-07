<p align="center"><img src="brand/logo-1024.png" width="112" alt="Paylog logo"></p>

<h1 align="center">Paylog</h1>
<p align="center"><b>Know where your money goes.</b><br>
Personal finance tracker for Android, iPhone and the web, with a home-screen quick-note widget.</p>

<p align="center">
<b><a href="https://github.com/NIRMALKANDEL/Paylog/releases/latest">Download for Android</a></b> ·
<b><a href="https://devnirmal.pythonanywhere.com">Open the web app</a></b> (iPhone: Share → Add to Home Screen)
</p>

---

Paylog is the next version of Spendly: a new name and logo, a real native mobile app (React Native / Expo),
a home-screen widget, sign-ins that last 30 days, and no demo data.

| Folder | What it is |
|---|---|
| `backend/` | Flask + SQLite server: the website **and** the JSON API the app uses (`/api/v1`). 299 tests. |
| `mobile/` | The Android + iOS app (Expo SDK 57, React Native 0.86, Expo Router, TypeScript). |
| `brand/` | The logo (`logo.svg`, `logo-1024.png`). |

## Features

- **Accounts:** register, sign in, forgot/reset password by email, email confirmation, change email/password,
  export (CSV + full JSON backup), delete account.
- **Money:** expenses + income, categories, search/filter/sort, CSV import, budgets (overall + per category),
  savings goals, recurring transactions, analytics with charts and plain-language insights,
  5 calculators (savings growth, goal planner, time to goal, emergency fund, loan EMI).
- **Quick note:** type `250 lunch`, `salary 65000`, `2k rent yesterday` — one entry per line, with a live preview.
- **Home-screen widget** (Android + iOS): a note card showing this month's spending.
  - **Android:** tap it and a small note card slides up over the home screen with the keyboard open. Type
    `250 lunch`, tap Save: it's added to your account straight away **without opening the app**, the widget's
    total updates, and you can Undo for a few seconds. Offline, notes wait on the phone and are sent as soon as
    you're back online (keeping the day you wrote them). Unsaved text stays as a draft, like a notes app.
    (Android widgets can't contain a text box themselves; this card is the closest thing.)
  - **iPhone:** tapping the widget opens the app's quick note with the keyboard up.
- **Receipt scanning:** pick a GPay / PhonePe / Paytm / BHIM screenshot or photo a bill. The text is read **on the
  phone** (Google ML Kit / Apple Vision); clearly read payments are saved instantly with Undo.
- **Design:** light / dark / system, 6 colour themes, 7 currencies (₹ with Indian grouping).

## Stay signed in (the Android logout fix)

The old app logged people out because its login cookie was a *browser-session* cookie unless "keep me signed in"
was ticked, and Android throws those away whenever it closes the app in the background.

- **Mobile app:** signing in creates a random token stored in the phone's secure storage (Android Keystore / iOS
  Keychain). It lasts **30 days and every use renews it**, so an app you use regularly never logs you out.
  Only a real "please sign in again" from the server ends it, never a bad network.
- **Website:** every sign-in is now a persistent 30-day cookie that renews on each visit.
- You are signed out only when you tap **Sign out**, change or reset your password (other devices), delete the
  account, or don't open the app for 30 days.
- Only a SHA-256 hash of each token is stored on the server.

## Run it on your PC

**Backend** (Windows, from `paylog\backend`):

```
python -m venv venv
venv\Scripts\pip install -r requirements-dev.txt
venv\Scripts\python app.py            # website + API on http://127.0.0.1:5001
venv\Scripts\python -m pytest         # run the tests
```

**Mobile app** (from `paylog\mobile`, needs Node 20+):

```
npm install
npx tsc --noEmit                      # typecheck
npx expo lint                         # lint
```

Build an Android APK (needs Java 21 + Android SDK; see `mobile/BUILD.md`).

## Deploy the server

The app talks to `https://devnirmal.pythonanywhere.com` by default (change it with `EXPO_PUBLIC_API_URL` at build
time). The server there must run **this** backend so the `/api/v1` endpoints exist. Step-by-step instructions are
in [`backend/DEPLOY.md`](backend/DEPLOY.md). Existing Spendly accounts and data keep working: the database is the
same and upgrades itself.

## License

MIT
