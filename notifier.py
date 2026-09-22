"""
notifier.py — Official Creations Lead Automation

Standalone, new file. Does NOT import from or modify discovery.py,
qualification.py, config.py, or main.py. Its only job: watch the
Leads sheet for qualified leads that haven't been notified yet, and
send them to Slack/Telegram.

Covers both cases identically:
  - leads qualified by the automation (discovery.py / qualification.py)
  - leads added manually via the website (already marked Approve=TRUE)

Runs independently of the 2-hour automation session, on its own
schedule (see .github/workflows/notifier.yml), so a manually-added
lead gets notified even when no automation run is active.

Required environment variables (set as GitHub Actions secrets):
  GOOGLE_SERVICE_ACCOUNT_JSON   - same service account already used
                                  by the existing backend, as a raw
                                  JSON string (not a file path)
  SPREADSHEET_ID                - the Lead Database spreadsheet ID
  SLACK_BOT_TOKEN                - Slack bot token, scope: chat:write
  SLACK_CHANNEL_ID                - target Slack channel ID
  TELEGRAM_BOT_TOKEN              - Telegram bot token
  TELEGRAM_CHAT_ID                - target Telegram chat/channel ID

Expected Leads sheet columns used here (must already exist, or be
added once): "Approve", "Notified". Everything else is read-only.
"""

import os
import json
import sys
import gspread
import requests
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
LEADS_TAB = "Leads"

TRUE_VALUES = {"true", "yes", "1", "✓"}


def is_true(value: str) -> bool:
    return str(value).strip().lower() in TRUE_VALUES


def get_sheet():
    creds_json = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    creds_dict = json.loads(creds_json)
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(os.environ["SPREADSHEET_ID"])
    return spreadsheet.worksheet(LEADS_TAB)


def send_slack(lead: dict) -> bool:
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("SLACK_CHANNEL_ID")
    if not token or not channel:
        return False
    text = (
        f"*New qualified lead:* {lead.get('Business Name', '—')}\n"
        f"Industry: {lead.get('Industry', '—')} | Location: {lead.get('Location', '—')}\n"
        f"Phone: {lead.get('Phone', '—')} | Source: {lead.get('Lead Source', '—')}\n"
        f"Score: {lead.get('Score', '—')} | Priority: {lead.get('Priority', '—')}"
    )
    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": channel, "text": text},
        timeout=15,
    )
    ok = resp.ok and resp.json().get("ok")
    if not ok:
        print(f"Slack send failed: {resp.text}", file=sys.stderr)
    return bool(ok)


def send_telegram(lead: dict) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return False
    text = (
        f"New qualified lead: {lead.get('Business Name', '—')}\n"
        f"Industry: {lead.get('Industry', '—')} | Location: {lead.get('Location', '—')}\n"
        f"Phone: {lead.get('Phone', '—')} | Source: {lead.get('Lead Source', '—')}\n"
        f"Score: {lead.get('Score', '—')} | Priority: {lead.get('Priority', '—')}"
    )
    resp = requests.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text},
        timeout=15,
    )
    ok = resp.ok and resp.json().get("ok")
    if not ok:
        print(f"Telegram send failed: {resp.text}", file=sys.stderr)
    return bool(ok)


def main():
    sheet = get_sheet()
    records = sheet.get_all_records()  # list of dicts, keyed by header row
    headers = sheet.row_values(1)

    if "Notified" not in headers:
        print(
            "WARNING: Leads sheet has no 'Notified' column. "
            "Add one (any position) so this script can track what's "
            "already been sent. Exiting without sending anything.",
            file=sys.stderr,
        )
        return

    notified_col = headers.index("Notified") + 1  # 1-based for gspread

    sent_count = 0
    for i, row in enumerate(records, start=2):  # row 1 is the header
        if not is_true(row.get("Approve", "")):
            continue
        if is_true(row.get("Notified", "")):
            continue

        slack_ok = send_slack(row)
        telegram_ok = send_telegram(row)

        if slack_ok or telegram_ok:
            sheet.update_cell(i, notified_col, "TRUE")
            sent_count += 1

    print(f"notifier.py: sent {sent_count} new notification(s).")


if __name__ == "__main__":
    main()