"""
notifier.py — Official Creations Lead Automation

Sends approved leads to:
- Slack
- Telegram

Features:
- Includes Lead ID and Opportunity in notifications.
- Reads Opportunity directly from column H.
- Tracks Slack and Telegram notifications independently.
- Retries failed notifications without resending successful ones.

Required environment variables:
    GOOGLE_SERVICE_ACCOUNT_JSON
    SPREADSHEET_ID
    SLACK_BOT_TOKEN
    SLACK_CHANNEL_ID
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID
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

# Google Sheets column H
OPPORTUNITY_COLUMN = 8


def is_true(value):
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


def format_message(lead):
    """Format a lead notification for Slack and Telegram."""

    return (
        f"New Qualified Lead: {lead.get('Business Name') or '—'}\n"
        f"Lead ID: {lead.get('Lead ID') or '—'}\n"
        f"Industry: {lead.get('Industry') or '—'}\n"
        f"Location: {lead.get('Location') or '—'}\n"
        f"Phone: {lead.get('Phone') or '—'}\n"
        f"Opportunity: {lead.get('Opportunity') or '—'}\n"
        f"Buying Signal: {lead.get('Buying Signal') or '—'}\n"
        f"Source: {lead.get('Lead Source') or '—'}\n"
        f"Score: {lead.get('Score') or '—'}\n"
        f"Priority: {lead.get('Priority') or '—'}"
    )


def send_slack(lead):
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("SLACK_CHANNEL_ID")

    if not token or not channel:
        print("Slack configuration missing.", file=sys.stderr)
        return False

    try:
        response = requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={
                "Authorization": f"Bearer {token}",
            },
            json={
                "channel": channel,
                "text": format_message(lead),
            },
            timeout=15,
        )

        data = response.json()
        success = response.ok and data.get("ok") is True

        if not success:
            print(
                f"Slack send failed: {response.text}",
                file=sys.stderr,
            )

        return success

    except Exception as exc:
        print(f"Slack send error: {exc}", file=sys.stderr)
        return False


def send_telegram(lead):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        print("Telegram configuration missing.", file=sys.stderr)
        return False

    try:
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": format_message(lead),
            },
            timeout=15,
        )

        data = response.json()
        success = response.ok and data.get("ok") is True

        if not success:
            print(
                f"Telegram send failed: {response.text}",
                file=sys.stderr,
            )

        return success

    except Exception as exc:
        print(f"Telegram send error: {exc}", file=sys.stderr)
        return False


def main():
    print("Starting OC Lead Automation notifier...")

    sheet = get_sheet()
    headers = sheet.row_values(1)

    required_columns = [
        "Lead ID",
        "Approve",
        "Slack Notified",
        "Telegram Notified",
    ]

    missing_columns = [
        column for column in required_columns
        if column not in headers
    ]

    if missing_columns:
        raise RuntimeError(
            "Missing required Leads sheet column(s): "
            + ", ".join(missing_columns)
        )

    # Opportunity is explicitly read from column H.
    if len(headers) < OPPORTUNITY_COLUMN:
        raise RuntimeError(
            "The Leads sheet does not have column H."
        )

    opportunity_header = headers[OPPORTUNITY_COLUMN - 1]

    if opportunity_header != "Opportunity":
        raise RuntimeError(
            f"Expected 'Opportunity' in column H, "
            f"but found '{opportunity_header}'. "
            "Check the Leads sheet headers before running."
        )

    records = sheet.get_all_records()

    slack_col = headers.index("Slack Notified") + 1
    telegram_col = headers.index("Telegram Notified") + 1

    sent_count = 0
    retry_count = 0
    skipped_count = 0

    for row_number, lead in enumerate(records, start=2):

        # Only notify approved leads.
        if not is_true(lead.get("Approve", "")):
            continue

        slack_sent = is_true(lead.get("Slack Notified", ""))
        telegram_sent = is_true(lead.get("Telegram Notified", ""))

        if slack_sent and telegram_sent:
            skipped_count += 1
            continue

        # Explicitly read Opportunity from column H.
        # This avoids depending on dictionary key ordering.
        opportunity = sheet.cell(
            row_number,
            OPPORTUNITY_COLUMN,
        ).value

        lead["Opportunity"] = opportunity or "—"

        if not slack_sent:
            if send_slack(lead):
                sheet.update_cell(
                    row_number,
                    slack_col,
                    "TRUE",
                )
                sent_count += 1
                print(
                    f"Slack notification sent: "
                    f"{lead.get('Lead ID', '—')}"
                )
            else:
                retry_count += 1

        if not telegram_sent:
            if send_telegram(lead):
                sheet.update_cell(
                    row_number,
                    telegram_col,
                    "TRUE",
                )
                sent_count += 1
                print(
                    f"Telegram notification sent: "
                    f"{lead.get('Lead ID', '—')}"
                )
            else:
                retry_count += 1

    print("\nNotifier finished.")
    print(f"Notifications sent: {sent_count}")
    print(f"Channels needing retry: {retry_count}")
    print(f"Leads skipped (already notified): {skipped_count}")


if __name__ == "__main__":
    main()