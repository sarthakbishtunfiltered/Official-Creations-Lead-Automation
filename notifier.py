"""
notifier.py — Official Creations Lead Automation

Standalone notification service.

Watches the Leads sheet for approved leads and sends them to:
- Slack
- Telegram

Slack and Telegram have independent notification tracking.
If one channel fails, it will retry on the next notifier run
without sending a duplicate to the channel that already succeeded.

Required environment variables:
    GOOGLE_SERVICE_ACCOUNT_JSON
    SPREADSHEET_ID
    SLACK_BOT_TOKEN
    SLACK_CHANNEL_ID
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID

Required Leads sheet columns:
    Approve
    Slack Notified
    Telegram Notified
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

    creds = Credentials.from_service_account_info(
        creds_dict,
        scopes=SCOPES,
    )

    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(os.environ["SPREADSHEET_ID"])

    return spreadsheet.worksheet(LEADS_TAB)


def send_slack(lead: dict) -> bool:
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("SLACK_CHANNEL_ID")

    if not token or not channel:
        print("Slack configuration missing.", file=sys.stderr)
        return False

    text = (
        f"*New qualified lead:* {lead.get('Business Name', '—')}\n"
        f"Industry: {lead.get('Industry', '—')} | "
        f"Location: {lead.get('Location', '—')}\n"
        f"Phone: {lead.get('Phone', '—')} | "
        f"Source: {lead.get('Lead Source', '—')}\n"
        f"Score: {lead.get('Score', '—')} | "
        f"Priority: {lead.get('Priority', '—')}"
    )

    try:
        resp = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={
                "Authorization": f"Bearer {token}",
            },
            json={
                "channel": channel,
                "text": text,
            },
            timeout=15,
        )

        data = resp.json()
        ok = resp.ok and data.get("ok") is True

        if not ok:
            print(
                f"Slack send failed: {resp.text}",
                file=sys.stderr,
            )

        return bool(ok)

    except Exception as exc:
        print(
            f"Slack send error: {exc}",
            file=sys.stderr,
        )
        return False


def send_telegram(lead: dict) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("Telegram configuration missing.", file=sys.stderr)
        return False

    text = (
        f"New qualified lead: {lead.get('Business Name', '—')}\n"
        f"Industry: {lead.get('Industry', '—')} | "
        f"Location: {lead.get('Location', '—')}\n"
        f"Phone: {lead.get('Phone', '—')} | "
        f"Source: {lead.get('Lead Source', '—')}\n"
        f"Score: {lead.get('Score', '—')} | "
        f"Priority: {lead.get('Priority', '—')}"
    )

    try:
        resp = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": text,
            },
            timeout=15,
        )

        data = resp.json()
        ok = resp.ok and data.get("ok") is True

        if not ok:
            print(
                f"Telegram send failed: {resp.text}",
                file=sys.stderr,
            )

        return bool(ok)

    except Exception as exc:
        print(
            f"Telegram send error: {exc}",
            file=sys.stderr,
        )
        return False


def main():
    sheet = get_sheet()

    records = sheet.get_all_records()
    headers = sheet.row_values(1)

    required_columns = [
        "Approve",
        "Slack Notified",
        "Telegram Notified",
    ]

    missing_columns = [
        column
        for column in required_columns
        if column not in headers
    ]

    if missing_columns:
        print(
            "WARNING: Missing required Leads sheet column(s): "
            + ", ".join(missing_columns),
            file=sys.stderr,
        )
        print(
            "Add these columns to row 1 and run the notifier again.",
            file=sys.stderr,
        )
        return

    slack_col = headers.index("Slack Notified") + 1
    telegram_col = headers.index("Telegram Notified") + 1

    sent_count = 0
    retry_count = 0

    for row_number, row in enumerate(records, start=2):

        # Only approved/qualified leads are notified.
        if not is_true(row.get("Approve", "")):
            continue

        slack_sent = is_true(row.get("Slack Notified", ""))
        telegram_sent = is_true(row.get("Telegram Notified", ""))

        # Nothing left to send.
        if slack_sent and telegram_sent:
            continue

        if not slack_sent:
            slack_ok = send_slack(row)

            if slack_ok:
                sheet.update_cell(
                    row_number,
                    slack_col,
                    "TRUE",
                )
                sent_count += 1
            else:
                retry_count += 1

        if not telegram_sent:
            telegram_ok = send_telegram(row)

            if telegram_ok:
                sheet.update_cell(
                    row_number,
                    telegram_col,
                    "TRUE",
                )
                sent_count += 1
            else:
                retry_count += 1

    print(
        f"notifier.py: sent {sent_count} notification(s), "
        f"{retry_count} channel(s) need retry."
    )


if __name__ == "__main__":
    main()