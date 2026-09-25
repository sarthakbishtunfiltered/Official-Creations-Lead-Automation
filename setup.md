# Setup Guide — Official Creations Lead Automation Dashboard

Everything code-level is done. What's left is account-specific setup —
things only you can create (API credentials, sheet columns, secrets).

## 1. Google Sheet — add two things

Your existing Leads/Blacklisted/Called Rejected/Settings tabs stay as
they are. Add:

- **A "Notified" column** to the **Leads** tab (any position). Used only
  by `notifier.py` to avoid sending the same Slack/Telegram message twice.
- **Settings tab rows**, if not already present (column A = name, column B = value):
  - `Automation Status` → start it as `STOPPED`
  - `Run Until` → leave blank
  - `Session Duration (min)` → leave blank
  - Plus your existing settings rows: `Industries`, `Cities / Locations`,
    `Discovery Sources`, `Buying-Signal Window`, `Minimum Business Age`

If your Settings tab uses different row labels than these, update the
`SETTINGS_KEYS` / `FIELD_KEYS` objects at the top of `frontend/js/dashboard.js`
and `frontend/js/settings.js` to match — everything else works as-is.

## 2. Google Cloud — OAuth Client ID (for website login)

1. Go to Google Cloud Console → use the same project as your existing
   service account, or create one.
2. Enable the **Google Sheets API** and **Google Drive API**.
3. APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   → Application type: **Web application**.
4. Under Authorized JavaScript origins, add your GitHub Pages URL,
   e.g. `https://<your-org>.github.io`.
5. Copy the Client ID into `frontend/js/config.js` → `GOOGLE_CLIENT_ID`.
6. You'll also be asked to configure the OAuth consent screen — set it to
   **Internal** if your team is on Google Workspace, so only your
   organization's accounts can even attempt to sign in.

## 3. Fill in `frontend/js/config.js`

- `GOOGLE_CLIENT_ID` — from step 2.
- `SPREADSHEET_ID` and `DRIVE_FILE_ID` — the ID from your Lead Database
  sheet's URL (same value for both).
- `TABS` — only edit if your actual tab names differ from `Leads`,
  `Blacklisted`, `Called Rejected`, `Settings`.

## 4. Enable GitHub Pages

Repo → Settings → Pages → Deploy from branch → pick the branch and the
`frontend/` folder (or `/root` if you move the frontend files to the repo
root — either works, just keep the relative paths intact).

## 5. GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The full contents of your existing `credentials/service_account.json`, pasted as one JSON string |
| `SPREADSHEET_ID` | Same Sheet ID as above |
| `SLACK_BOT_TOKEN` | A Slack bot token with `chat:write` scope |
| `SLACK_CHANNEL_ID` | The channel ID to post qualified-lead alerts to |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot's token |
| `TELEGRAM_CHAT_ID` | The chat/channel ID to post to |

`requirements.txt` (existing) needs `gspread` and `google-auth` added if
not already present, for `notifier.py` and `session_runner.py` to run in
Actions.

## 6. The one open item — `session_runner.py`

This new file drives a run session by calling a single-cycle function
from your existing `main.py`. It assumes `main.py` can expose something
like `run_one_cycle()`. **I have not seen your actual `main.py`**, so
I placeholder-imported this rather than guess at its structure — please
share it (or describe its current loop) so I can either wire this to an
existing function, or write the small, minimal extraction needed. Per
your instruction, I won't touch `main.py` (or anything discovery/
qualification depend on) without your review first.

## What you don't need to do

- No servers to run yourself — GitHub Pages hosts the site, GitHub
  Actions runs both the automation session and the notifier, all
  within free tiers.
- No separate login system — access is entirely governed by who has
  Viewer/Editor rights on the Lead Database sheet.
- No changes needed to `discovery.py`, `qualification.py`, or
  `google_sheets.py`.