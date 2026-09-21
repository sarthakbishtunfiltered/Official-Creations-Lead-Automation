from google_sheets import (
    connect_to_sheet,
    get_leads_sheet,
    get_blacklisted_sheet,
    get_called_rejected_sheet,
    get_settings_sheet,
    read_settings,
    verify_required_tabs,
    verify_leads_headers,
    get_contact_requirement,
)


def main():
    print("Starting OC Lead Automation...\n")

    spreadsheet = connect_to_sheet()

    print("Google Sheets connection successful.")
    print(f"Spreadsheet: {spreadsheet.title}\n")

    # ---------------------------------------------------------
    # VERIFY REQUIRED TABS
    # ---------------------------------------------------------

    verify_required_tabs(spreadsheet)

    print("REQUIRED TABS:")

    for tab_name in [
        "Leads",
        "Called Rejected",
        "Settings",
        "Blacklisted",
    ]:
        print(f"✓ {tab_name}")

    # ---------------------------------------------------------
    # VERIFY LEADS STRUCTURE
    # ---------------------------------------------------------

    leads = get_leads_sheet()

    verify_leads_headers(leads)

    print("\nLEADS HEADERS:")

    for index, header in enumerate(
        leads.row_values(1),
        start=1,
    ):
        print(f"{index}. {header}")

    # ---------------------------------------------------------
    # READ SETTINGS
    # ---------------------------------------------------------

    settings = read_settings()

    print("\nSETTINGS:")

    if settings:
        for key, value in settings.items():
            print(f"{key}: {value}")
    else:
        print("No settings values entered yet.")

    # ---------------------------------------------------------
    # CONTACTABILITY
    # ---------------------------------------------------------

    print("\nCONTACT REQUIREMENT:")
    print(get_contact_requirement(settings))

    # ---------------------------------------------------------
    # OTHER TABS
    # ---------------------------------------------------------

    blacklisted = get_blacklisted_sheet()
    called_rejected = get_called_rejected_sheet()
    settings_sheet = get_settings_sheet()

    print("\nOTHER TAB HEADERS:")

    print("\nBLACKLISTED:")
    for index, header in enumerate(
        blacklisted.row_values(1),
        start=1,
    ):
        print(f"{index}. {header}")

    print("\nCALLED REJECTED:")
    for index, header in enumerate(
        called_rejected.row_values(1),
        start=1,
    ):
        print(f"{index}. {header}")

    print("\nSETTINGS:")
    for index, header in enumerate(
        settings_sheet.row_values(1),
        start=1,
    ):
        print(f"{index}. {header}")

    print("\n----------------------------------------")
    print("OC Lead Automation foundation verified.")
    print("----------------------------------------")


if __name__ == "__main__":
    main()