"""Google Sheets access helpers for Official Creations Lead Automation."""

import time

from google.oauth2.service_account import Credentials
import gspread

from config import GOOGLE_CREDENTIALS_FILE, GOOGLE_SHEET_NAME

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

LEADS_HEADERS = [
    "Lead ID",
    "Business Name",
    "Industry",
    "Location",
    "Phone",
    "Instagram ID",
    "Lead Source",
    "Opportunity",
    "Buying Signal",
    "Score",
    "Priority",
    "Approve",
    "Approval Reason",
    "Reject After Call",
    "Status",
    "Notified",
    "Slack Notified",
    "Telegram Notified",
    "Created At",
]

# Preserve these existing Learning Data fields, including Phone and Instagram ID.
LEARNING_HEADERS = [
    "Record ID",
    "Date",
    "Industry",
    "Location",
    "Search Query",
    "Source",
    "Business Name",
    "Business Type",
    "OSM Category",
    "Contact Available",
    "Industry Match",
    "Website Status",
    "Review Outcome",
    "Rejection Reason",
    "Outcome Quality",
    "Phone",
    "Instagram ID",
]

# Additional evidence fields. These are appended only when missing.
LEARNING_EXTRA_HEADERS = [
    "Source URL",
    "Website",
    "Website Evidence",
    "Website Evidence URL",
    "Buying Signal",
    "Buying Signal Evidence",
    "Buying Signal URL",
    "Buying Signal Date",
    "Discovery Evidence",
]

REQUIRED_TABS = [
    "Leads",
    "Called Rejected",
    "Settings",
    "Blacklisted",
    "Learning Data",
]

# Process-wide caches so repeated calls do not re-open the spreadsheet
# or re-fetch a worksheet handle on every access. A fresh process (each
# `py main.py` run) always starts with an empty cache.
_spreadsheet_cache = None
_worksheet_cache = {}


def _with_backoff(func, *args, max_retries=5, base_delay=2, **kwargs):
    """Retry a Sheets/Drive API call with exponential backoff on 429s.

    Only retries actual rate-limit errors (HTTP 429). Any other error is
    raised immediately -- this never hides a real failure or pretends a
    write succeeded when it did not.
    """
    attempt = 0

    while True:
        try:
            return func(*args, **kwargs)
        except gspread.exceptions.APIError as exc:
            status = None
            try:
                status = exc.response.status_code
            except Exception:
                status = None

            if status != 429 or attempt >= max_retries:
                raise

            delay = base_delay * (2 ** attempt)
            print(
                f"WARNING: Sheets API rate limited (429). "
                f"Retrying in {delay}s... "
                f"(attempt {attempt + 1}/{max_retries})"
            )
            time.sleep(delay)
            attempt += 1


def connect_to_sheet(force_refresh=False):
    """Connect to the configured Google Spreadsheet.

    Cached for the life of the process -- call with force_refresh=True
    only if you specifically need a fresh handle (e.g. after a very
    long-running session).
    """
    global _spreadsheet_cache

    if _spreadsheet_cache is None or force_refresh:
        credentials = Credentials.from_service_account_file(
            GOOGLE_CREDENTIALS_FILE,
            scopes=SCOPES,
        )
        client = gspread.authorize(credentials)
        _spreadsheet_cache = _with_backoff(client.open, GOOGLE_SHEET_NAME)

    return _spreadsheet_cache


def get_worksheet(name, force_refresh=False):
    """Return a worksheet by name, cached for the life of the process."""
    if force_refresh or name not in _worksheet_cache:
        spreadsheet = connect_to_sheet(force_refresh=force_refresh)
        _worksheet_cache[name] = _with_backoff(spreadsheet.worksheet, name)

    return _worksheet_cache[name]


def get_leads_sheet():
    return get_worksheet("Leads")


def get_called_rejected_sheet():
    return get_worksheet("Called Rejected")


def get_settings_sheet():
    return get_worksheet("Settings")


def get_blacklisted_sheet():
    return get_worksheet("Blacklisted")


def get_learning_sheet():
    return get_worksheet("Learning Data")


def verify_required_tabs(spreadsheet=None):
    """Check required tabs without creating, renaming, or deleting anything."""
    spreadsheet = spreadsheet or connect_to_sheet()
    existing = {
        worksheet.title
        for worksheet in _with_backoff(spreadsheet.worksheets)
    }
    missing = [name for name in REQUIRED_TABS if name not in existing]

    if missing:
        raise ValueError(
            "Missing required tabs: " + ", ".join(missing)
        )

    return True


def _verify_headers(worksheet, expected, sheet_name):
    """Validate headers without automatically modifying the spreadsheet."""
    actual = _with_backoff(worksheet.row_values, 1)

    if not actual:
        raise ValueError(
            f"{sheet_name} has no header row. "
            "Add the required headers manually before continuing."
        )

    missing = [
        header for header in expected
        if header not in actual
    ]

    if missing:
        raise ValueError(
            f"{sheet_name} is missing headers: "
            + ", ".join(missing)
        )

    return True


def verify_leads_headers(sheet=None):
    """Validate Leads headers without writing to the Leads worksheet."""
    return _verify_headers(
        sheet or get_leads_sheet(),
        LEADS_HEADERS,
        "Leads",
    )


def verify_learning_headers(sheet=None):
    """Validate required Learning Data headers."""
    worksheet = sheet or get_learning_sheet()
    headers = _with_backoff(worksheet.row_values, 1)

    if not headers:
        raise ValueError(
            "Learning Data has no header row. "
            "Add the required headers manually before continuing."
        )

    missing = [
        header for header in LEARNING_HEADERS
        if header not in headers
    ]

    if missing:
        raise ValueError(
            "Learning Data is missing headers: "
            + ", ".join(missing)
        )

    return True


def _normalise_key(value):
    """Normalize text for consistent comparisons."""
    return " ".join(
        str(value or "")
        .strip()
        .lower()
        .replace("_", " ")
        .split()
    )


def read_settings():
    """Read Settings as key-value pairs from columns A and B."""
    rows = _with_backoff(get_settings_sheet().get_all_values)
    settings = {}

    for row in rows:
        if not row or not str(row[0]).strip():
            continue

        key = str(row[0]).strip()
        value = str(row[1]).strip() if len(row) > 1 else ""

        if (
            _normalise_key(key) in {
                "setting",
                "settings",
                "key",
                "setting name",
            }
            and _normalise_key(value) in {
                "value",
                "setting value",
            }
        ):
            continue

        settings[key] = value

    # Preserve original keys and add normalized keys for compatibility.
    for key, value in list(settings.items()):
        settings[_normalise_key(key)] = value

    aliases = {
        "buying signal window": "buying-signal window",
        "session duration": "session duration (min)",
    }

    for alias, canonical in aliases.items():
        if alias in settings and canonical not in settings:
            settings[canonical] = settings[alias]

    return settings


def get_contact_requirement(settings=None):
    """A lead is contactable with a phone number OR an Instagram ID."""
    return "Phone OR Instagram"


def is_contactable(lead):
    """Return True when a phone number or Instagram ID is available."""
    return bool(
        str(lead.get("Phone", "") or "").strip()
        or str(lead.get("Instagram ID", "") or "").strip()
    )


def get_all_leads():
    """Return all existing Leads records."""
    return _with_backoff(get_leads_sheet().get_all_records)


def find_lead_row_by_business_name(business_name):
    """Find a Leads row by normalized business name."""
    target = _normalise_key(business_name)

    if not target:
        return None

    for row_number, record in enumerate(get_all_leads(), start=2):
        if _normalise_key(record.get("Business Name")) == target:
            return row_number

    return None


def append_lead(lead):
    """Append a lead using the configured Leads header order."""
    worksheet = get_leads_sheet()
    headers = _with_backoff(worksheet.row_values, 1)

    if not headers:
        raise ValueError("Leads has no header row.")

    missing = [
        header for header in LEADS_HEADERS
        if header not in headers
    ]

    if missing:
        raise ValueError(
            "Leads is missing headers: " + ", ".join(missing)
        )

    values = [lead.get(header, "") for header in headers]

    _with_backoff(
        worksheet.append_row,
        values,
        value_input_option="USER_ENTERED",
    )


def update_lead_row(row_number, updates):
    """Update specified fields without changing other Leads columns."""
    worksheet = get_leads_sheet()
    headers = _with_backoff(worksheet.row_values, 1)

    if not headers:
        raise ValueError("Leads has no header row.")

    for header, value in updates.items():
        if header not in headers:
            raise ValueError(f"Unknown Leads header: {header}")

        _with_backoff(
            worksheet.update_cell,
            row_number,
            headers.index(header) + 1,
            value,
        )


def merge_contact_information(
    business_name,
    phone=None,
    instagram_id=None,
):
    """Fill missing contact information for an existing lead."""
    row_number = find_lead_row_by_business_name(business_name)

    if row_number is None:
        return False

    worksheet = get_leads_sheet()
    headers = _with_backoff(worksheet.row_values, 1)
    row = _with_backoff(worksheet.row_values, row_number)

    current = {
        header: row[index] if index < len(row) else ""
        for index, header in enumerate(headers)
    }

    updates = {}

    if phone and not str(current.get("Phone", "")).strip():
        updates["Phone"] = str(phone).strip()

    if instagram_id and not str(
        current.get("Instagram ID", "")
    ).strip():
        updates["Instagram ID"] = (
            str(instagram_id).strip().lstrip("@")
        )

    if updates:
        update_lead_row(row_number, updates)

    return True


def get_learning_records():
    """Return all existing Learning Data records."""
    return _with_backoff(get_learning_sheet().get_all_records)


def _ensure_learning_headers(worksheet):
    """
    Preserve all existing Learning Data columns and append only missing
    required or additional headers in a single write. Never replace the
    existing header row.
    """
    headers = _with_backoff(worksheet.row_values, 1)

    if not headers:
        raise ValueError(
            "Learning Data has no header row. "
            "Add the existing Learning Data headers manually first."
        )

    required_headers = LEARNING_HEADERS + LEARNING_EXTRA_HEADERS
    missing_headers = [
        header for header in required_headers
        if header not in headers
    ]

    if missing_headers:
        # Add all missing columns at the right in one call, rather than
        # one update_cell() per missing header.
        start_column = len(headers) + 1
        end_column = len(headers) + len(missing_headers)

        start_a1 = gspread.utils.rowcol_to_a1(
            1, start_column
        ).rstrip("0123456789")
        end_a1 = gspread.utils.rowcol_to_a1(
            1, end_column
        ).rstrip("0123456789")

        _with_backoff(
            worksheet.update,
            range_name=f"{start_a1}1:{end_a1}1",
            values=[missing_headers],
        )

        headers = headers + missing_headers

    return headers


def update_learning_row(row_number, record):
    """
    Update a Learning Data record while preserving the live sheet's
    existing column order and every unrelated column value.

    Kept for backward compatibility / single-row callers. Prefer
    upsert_learning_records() for anything writing more than a handful
    of records, since this does its own header + row read per call.
    """
    worksheet = get_learning_sheet()
    headers = _with_backoff(worksheet.row_values, 1)

    if not headers:
        raise ValueError("Learning Data has no header row.")

    # Read the existing row so fields not included in this update survive.
    existing_row = _with_backoff(worksheet.row_values, row_number)

    existing_record = {
        header: (
            existing_row[index]
            if index < len(existing_row)
            else ""
        )
        for index, header in enumerate(headers)
    }

    # Update only keys explicitly provided by the caller.
    existing_record.update(record)

    values = [
        existing_record.get(header, "")
        for header in headers
    ]

    last_col = gspread.utils.rowcol_to_a1(
        1,
        len(headers),
    ).rstrip("0123456789")

    _with_backoff(
        worksheet.update,
        range_name=f"A{row_number}:{last_col}{row_number}",
        values=[values],
        value_input_option="USER_ENTERED",
    )


def upsert_learning_record(record):
    """
    Insert or update a single Learning Data record using Record ID.

    Back-compat single-record wrapper around upsert_learning_records().
    Fine for occasional single-record use (e.g. syncing one dashboard
    decision); for a batch of discoveries, call upsert_learning_records()
    directly instead, since this still does a full sheet read per call.
    """
    record_id = str(record.get("Record ID", "") or "").strip()
    results = upsert_learning_records([record])
    return results.get(record_id, "skipped")


def upsert_learning_records(records):
    """
    Insert or update many Learning Data records in as few Google Sheets
    API calls as possible: one read of the whole sheet, then at most one
    batched write for updates and one batched write for inserts --
    regardless of how many records are passed in.

    This replaces calling upsert_learning_record() once per candidate,
    which was opening the spreadsheet and reading headers/IDs fresh for
    every single record and is what caused the 429 "Quota exceeded for
    quota metric Read requests" errors on larger discovery runs.

    Existing columns (including Phone and Instagram ID) and any existing
    row values not present in a given record are preserved. Returns a
    dict of {record_id: "inserted" | "updated"}; records with no
    Record ID are skipped and not included in the result.
    """
    records = [
        record for record in records
        if str(record.get("Record ID", "") or "").strip()
    ]

    if not records:
        return {}

    worksheet = get_learning_sheet()
    headers = _ensure_learning_headers(worksheet)

    if "Record ID" not in headers:
        raise ValueError(
            "Learning Data is missing the Record ID header."
        )

    all_values = _with_backoff(worksheet.get_all_values)

    if not all_values:
        raise ValueError("Learning Data has no header row.")

    sheet_headers = all_values[0]
    id_index = (
        sheet_headers.index("Record ID")
        if "Record ID" in sheet_headers
        else None
    )

    existing_by_id = {}

    if id_index is not None:
        for row_number, row in enumerate(all_values[1:], start=2):
            record_id = (
                row[id_index].strip()
                if id_index < len(row)
                else ""
            )

            if record_id:
                existing_by_id[record_id] = (row_number, row)

    last_col = gspread.utils.rowcol_to_a1(
        1,
        len(sheet_headers),
    ).rstrip("0123456789")

    updates = []
    inserts = []
    results = {}

    for record in records:
        record_id = str(record.get("Record ID", "")).strip()

        if record_id in results:
            # Same Record ID seen twice in this batch; keep the latest.
            pass

        existing = existing_by_id.get(record_id)

        if existing is not None:
            row_number, existing_row = existing

            existing_record = {
                header: (
                    existing_row[index]
                    if index < len(existing_row)
                    else ""
                )
                for index, header in enumerate(sheet_headers)
            }
            existing_record.update(record)

            values = [
                existing_record.get(header, "")
                for header in sheet_headers
            ]

            if row_number is None:
                # Queued for insertion earlier in this same batch --
                # just update the queued insert row in place.
                for index, queued in enumerate(inserts):
                    if queued is existing_row:
                        inserts[index] = values
                        existing_by_id[record_id] = (None, values)
                        break
            else:
                updates.append({
                    "range": f"A{row_number}:{last_col}{row_number}",
                    "values": [values],
                })

            results[record_id] = "updated"
        else:
            values = [
                record.get(header, "")
                for header in sheet_headers
            ]
            inserts.append(values)
            # Mark as seen so a duplicate Record ID later in this same
            # batch updates this queued row instead of inserting twice.
            existing_by_id[record_id] = (None, values)
            results[record_id] = "inserted"

    if updates:
        _with_backoff(
            worksheet.batch_update,
            updates,
            value_input_option="USER_ENTERED",
        )

    if inserts:
        _with_backoff(
            worksheet.append_rows,
            inserts,
            value_input_option="USER_ENTERED",
        )

    return results


def test_connection():
    """Test spreadsheet authentication and access."""
    spreadsheet = connect_to_sheet()

    print("Google Sheets connection successful.")
    print(f"Spreadsheet: {spreadsheet.title}")

    return True