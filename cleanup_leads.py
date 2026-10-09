"""
Safely remove unapproved leads older than 48 hours.

Default mode: DRY RUN. No rows are deleted.
Use --execute to perform actual deletion.

Rows without a Business Name are ignored.
Rows with missing/invalid timestamps or ambiguous approval
values are skipped for safety.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import gspread
from google.oauth2.service_account import Credentials

from config import GOOGLE_CREDENTIALS_FILE, GOOGLE_SHEET_NAME

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

DEFAULT_RETENTION_HOURS = 48


def connect_to_spreadsheet():
    credentials_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    spreadsheet_id = os.getenv("SPREADSHEET_ID")

    if credentials_json:
        try:
            credentials_info = json.loads(credentials_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON."
            ) from exc

        credentials = Credentials.from_service_account_info(
            credentials_info,
            scopes=SCOPES,
        )
    else:
        credentials = Credentials.from_service_account_file(
            GOOGLE_CREDENTIALS_FILE,
            scopes=SCOPES,
        )

    client = gspread.authorize(credentials)

    if spreadsheet_id:
        return client.open_by_key(spreadsheet_id)

    return client.open(GOOGLE_SHEET_NAME)


def parse_timestamp(value):
    if not value:
        return None

    try:
        timestamp = datetime.fromisoformat(
            str(value).strip().replace("Z", "+00:00")
        )

        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)

        return timestamp.astimezone(timezone.utc)

    except (ValueError, OverflowError):
        return None


def parse_approval(value):
    normalized = str(value or "").strip().lower()

    if normalized in {"true", "yes", "1"}:
        return True

    if normalized in {"", "false", "no", "0"}:
        return False

    return None


def cleanup_leads(dry_run=True, retention_hours=DEFAULT_RETENTION_HOURS):
    spreadsheet = connect_to_spreadsheet()
    worksheet = spreadsheet.worksheet("Leads")
    rows = worksheet.get_all_values()

    if not rows:
        print("The Leads sheet is empty. Nothing to process.")
        return

    headers = [value.strip() for value in rows[0]]

    if len(headers) != len(set(headers)):
        raise RuntimeError(
            "Duplicate column headers found. Cleanup stopped safely."
        )

    header_map = {
        header: index
        for index, header in enumerate(headers)
        if header
    }

    required = {"Business Name", "Approve", "Created At"}
    missing = required - set(header_map)

    if missing:
        raise RuntimeError(
            "Missing required headers: " + ", ".join(sorted(missing))
        )

    business_index = header_map["Business Name"]
    approval_index = header_map["Approve"]
    timestamp_index = header_map["Created At"]

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=retention_hours)

    candidates = []
    ignored_empty = 0
    preserved_approved = 0
    preserved_recent = 0
    skipped_timestamp = 0
    skipped_approval = 0

    print("=" * 55)
    print("OFFICIAL CREATIONS — LEAD CLEANUP")
    print("=" * 55)
    print(f"Spreadsheet: {spreadsheet.title}")
    print(f"Worksheet:   {worksheet.title}")
    print(f"UTC time:    {now.isoformat()}")
    print(f"Cutoff:      {cutoff.isoformat()}")
    print(f"Mode:        {'DRY RUN' if dry_run else 'EXECUTE'}")
    print("-" * 55)

    for row_number, row in enumerate(rows[1:], start=2):

        def cell(index):
            return row[index] if index < len(row) else ""

        business_name = cell(business_index).strip()

        # Checkbox-only rows and other rows without a business name
        # are not valid leads and must never be deleted by this script.
        if not business_name:
            ignored_empty += 1
            continue

        approval = parse_approval(cell(approval_index))

        if approval is None:
            skipped_approval += 1
            print(
                f"SKIP row {row_number}: {business_name} "
                "- unclear approval value."
            )
            continue

        if approval:
            preserved_approved += 1
            continue

        raw_timestamp = cell(timestamp_index).strip()
        created_at = parse_timestamp(raw_timestamp)

        if created_at is None:
            skipped_timestamp += 1
            print(
                f"SKIP row {row_number}: {business_name} "
                "- missing or invalid Created At."
            )
            continue

        if created_at > now:
            print(
                f"SKIP row {row_number}: {business_name} "
                "- timestamp is in the future."
            )
            continue

        if created_at > cutoff:
            preserved_recent += 1
            continue

        candidates.append(
            {
                "row_number": row_number,
                "business_name": business_name,
                "created_at": created_at,
            }
        )

    print("\nEXPIRED UNAPPROVED LEADS")
    print("-" * 55)

    if candidates:
        for item in candidates:
            age = now - item["created_at"]
            print(
                f"Row {item['row_number']}: {item['business_name']} "
                f"| Age: {age}"
            )
    else:
        print("No expired unapproved leads found.")

    print("\nSUMMARY")
    print("-" * 55)
    print(f"Rows without business names ignored: {ignored_empty}")
    print(f"Approved leads preserved:            {preserved_approved}")
    print(f"Recent unapproved leads preserved:   {preserved_recent}")
    print(f"Missing/invalid timestamps skipped:  {skipped_timestamp}")
    print(f"Ambiguous approvals skipped:         {skipped_approval}")
    print(f"Expired deletion candidates:          {len(candidates)}")

    if dry_run:
        print("\nDRY RUN COMPLETE — NO ROWS WERE DELETED.")
        return

    if not candidates:
        print("\nNo deletions necessary.")
        return

    deleted = 0

    for item in sorted(
        candidates,
        key=lambda candidate: candidate["row_number"],
        reverse=True,
    ):
        worksheet.delete_rows(item["row_number"])
        deleted += 1
        print(
            f"DELETED row {item['row_number']}: "
            f"{item['business_name']}"
        )

    print(f"\nCleanup complete. Deleted {deleted} expired lead(s).")


def main():
    parser = argparse.ArgumentParser(
        description="Clean up unapproved leads older than 48 hours."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually delete expired leads. Without this flag, dry run only.",
    )

    args = parser.parse_args()

    try:
        cleanup_leads(
            dry_run=not args.execute,
            retention_hours=DEFAULT_RETENTION_HOURS,
        )
    except Exception as exc:
        print(f"\nCLEANUP FAILED: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()