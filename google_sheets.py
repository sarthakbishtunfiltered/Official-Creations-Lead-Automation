from datetime import datetime, timezone

import gspread
from google.oauth2.service_account import Credentials

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
]


REQUIRED_TABS = [
    "Leads",
    "Called Rejected",
    "Settings",
    "Blacklisted",
]


def connect_to_sheet():
    credentials = Credentials.from_service_account_file(
        GOOGLE_CREDENTIALS_FILE,
        scopes=SCOPES,
    )

    client = gspread.authorize(credentials)
    return client.open(GOOGLE_SHEET_NAME)


def get_leads_sheet():
    return connect_to_sheet().worksheet("Leads")


def get_blacklisted_sheet():
    return connect_to_sheet().worksheet("Blacklisted")


def get_called_rejected_sheet():
    return connect_to_sheet().worksheet("Called Rejected")


def get_settings_sheet():
    return connect_to_sheet().worksheet("Settings")


def get_headers(worksheet):
    return worksheet.row_values(1)


def get_header_map(worksheet):
    headers = get_headers(worksheet)

    return {
        header.strip(): index + 1
        for index, header in enumerate(headers)
        if header.strip()
    }


def verify_required_tabs(spreadsheet):
    existing_tabs = {
        worksheet.title
        for worksheet in spreadsheet.worksheets()
    }

    missing_tabs = [
        tab
        for tab in REQUIRED_TABS
        if tab not in existing_tabs
    ]

    if missing_tabs:
        raise RuntimeError(
            "Missing required Google Sheets tabs: "
            + ", ".join(missing_tabs)
        )


def verify_leads_headers(leads_sheet):
    actual_headers = get_headers(leads_sheet)

    if actual_headers[:len(LEADS_HEADERS)] != LEADS_HEADERS:
        raise RuntimeError(
            "Leads tab headers do not match the required structure.\n\n"
            f"Expected:\n{LEADS_HEADERS}\n\n"
            f"Found:\n{actual_headers}"
        )


def read_settings():
    settings_sheet = get_settings_sheet()
    rows = settings_sheet.get_all_values()
    settings = {}

    for row in rows:
        if not row:
            continue

        key = row[0].strip()

        if not key:
            continue

        value = row[1].strip() if len(row) > 1 else ""
        settings[key] = value

    return settings


def get_contact_requirement(settings):
    """
    A lead is contactable when it has either a phone
    number or an Instagram ID.
    """
    return "Phone OR Instagram"


def is_contactable(phone="", instagram_id=""):
    return bool(
        str(phone).strip()
        or str(instagram_id).strip()
    )


def find_lead_row_by_business_name(business_name):
    leads_sheet = get_leads_sheet()
    business_name = str(business_name).strip().lower()

    if not business_name:
        return None

    business_column = leads_sheet.col_values(2)

    for row_number, value in enumerate(
        business_column[1:],
        start=2,
    ):
        if value.strip().lower() == business_name:
            return row_number

    return None


def get_all_leads():
    leads_sheet = get_leads_sheet()
    return leads_sheet.get_all_records()


def append_lead(lead):
    """
    Append one lead using the existing sheet headers.

    Existing notification columns are preserved.
    Created At is populated with a UTC timestamp when
    the caller has not supplied one.
    """

    leads_sheet = get_leads_sheet()
    headers = get_headers(leads_sheet)
    header_map = get_header_map(leads_sheet)

    if "Created At" not in header_map:
        raise RuntimeError(
            "The Leads tab is missing the 'Created At' header. "
            "Add 'Created At' to cell S1 before appending leads."
        )

    lead_data = dict(lead)

    if not str(lead_data.get("Created At", "")).strip():
        lead_data["Created At"] = (
            datetime.now(timezone.utc).isoformat()
        )

    row_values = {
        "Lead ID": lead_data.get("Lead ID", ""),
        "Business Name": lead_data.get("Business Name", ""),
        "Industry": lead_data.get("Industry", ""),
        "Location": lead_data.get("Location", ""),
        "Phone": lead_data.get("Phone", ""),
        "Instagram ID": lead_data.get("Instagram ID", ""),
        "Lead Source": lead_data.get("Lead Source", ""),
        "Opportunity": lead_data.get("Opportunity", ""),
        "Buying Signal": lead_data.get("Buying Signal", ""),
        "Score": lead_data.get("Score", ""),
        "Priority": lead_data.get("Priority", ""),
        "Approve": lead_data.get("Approve", False),
        "Approval Reason": lead_data.get("Approval Reason", ""),
        "Reject After Call": lead_data.get("Reject After Call", False),
        "Status": lead_data.get("Status", ""),
        "Created At": lead_data["Created At"],
    }

    row = [
        row_values.get(header.strip(), "")
        for header in headers
    ]

    leads_sheet.append_row(
        row,
        value_input_option="USER_ENTERED",
    )


def update_lead_row(row_number, lead):
    """
    Update the original A:O lead fields only.

    Notification columns and Created At are preserved.
    """

    leads_sheet = get_leads_sheet()

    row = [
        lead.get("Lead ID", ""),
        lead.get("Business Name", ""),
        lead.get("Industry", ""),
        lead.get("Location", ""),
        lead.get("Phone", ""),
        lead.get("Instagram ID", ""),
        lead.get("Lead Source", ""),
        lead.get("Opportunity", ""),
        lead.get("Buying Signal", ""),
        lead.get("Score", ""),
        lead.get("Priority", ""),
        lead.get("Approve", False),
        lead.get("Approval Reason", ""),
        lead.get("Reject After Call", False),
        lead.get("Status", ""),
    ]

    leads_sheet.update(
        f"A{row_number}:O{row_number}",
        [row],
        value_input_option="USER_ENTERED",
    )


def merge_contact_information(
    existing_lead,
    phone="",
    instagram_id="",
):
    """
    Fill missing contact information without replacing
    existing contact details.
    """

    if not existing_lead.get("Phone") and phone:
        existing_lead["Phone"] = phone

    if not existing_lead.get("Instagram ID") and instagram_id:
        existing_lead["Instagram ID"] = instagram_id

    return existing_lead


def test_connection():
    spreadsheet = connect_to_sheet()

    print("Google Sheets connection successful.")
    print(f"Spreadsheet: {spreadsheet.title}")

    verify_required_tabs(spreadsheet)

    print("\nRequired tabs found:")

    for tab in REQUIRED_TABS:
        print(f"- {tab}")

    leads_sheet = spreadsheet.worksheet("Leads")
    verify_leads_headers(leads_sheet)

    print("\nOriginal Leads headers verified:")

    for index, header in enumerate(LEADS_HEADERS, start=1):
        print(f"{index}. {header}")

    headers = get_headers(leads_sheet)

    if "Created At" in headers:
        print("\nCreated At header verified.")
    else:
        print(
            "\nWARNING: 'Created At' header is missing. "
            "New leads cannot be appended until it is added."
        )

    settings = read_settings()

    print("\nSettings:")

    if settings:
        for key, value in settings.items():
            print(f"{key}: {value}")
    else:
        print("No Settings values entered yet.")

    print(
        "\nContact requirement: "
        + get_contact_requirement(settings)
    )

    print("\nGoogle Sheets setup verification completed.")