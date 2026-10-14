from google_sheets import (
    connect_to_sheet,
    get_leads_sheet,
    get_blacklisted_sheet,
    get_called_rejected_sheet,
    get_settings_sheet,
    get_learning_sheet,
    read_settings,
    verify_required_tabs,
    verify_leads_headers,
    get_contact_requirement,
)
from session_runner import run_session


def main():
    print("Starting OC Lead Automation...\n")

    try:
        spreadsheet = connect_to_sheet()
        print("Google Sheets connection successful.")
        print(f"Spreadsheet: {spreadsheet.title}\n")

        verify_required_tabs(spreadsheet)

        print("REQUIRED TABS:")
        required_tabs = [
            "Leads",
            "Called Rejected",
            "Settings",
            "Blacklisted",
            "Learning Data",
        ]

        available_tabs = {worksheet.title for worksheet in spreadsheet.worksheets()}

        for tab_name in required_tabs:
            if tab_name not in available_tabs:
                raise RuntimeError(
                    f"Required tab '{tab_name}' is missing. "
                    "Create it before running the automation."
                )
            print(f"✓ {tab_name}")

        leads = get_leads_sheet()
        verify_leads_headers(leads)

        print("\nLEADS HEADERS:")
        for index, header in enumerate(leads.row_values(1), start=1):
            print(f"{index}. {header}")

        settings = read_settings()

        print("\nSETTINGS:")
        for key, value in settings.items():
            print(f"{key}: {value}")

        print("\nCONTACT REQUIREMENT:")
        print(get_contact_requirement(settings))

        blacklisted = get_blacklisted_sheet()
        called_rejected = get_called_rejected_sheet()
        settings_sheet = get_settings_sheet()
        learning_sheet = get_learning_sheet()

        print("\nOTHER TAB HEADERS:")
        for title, worksheet in [
            ("BLACKLISTED", blacklisted),
            ("CALLED REJECTED", called_rejected),
            ("SETTINGS", settings_sheet),
            ("LEARNING DATA", learning_sheet),
        ]:
            print(f"\n{title}:")
            for index, header in enumerate(worksheet.row_values(1), start=1):
                print(f"{index}. {header}")

        print("\n----------------------------------------")
        print("Google Sheets foundation verified.")
        print("----------------------------------------\n")

        print("Starting automation session...\n")
        run_session()

    except Exception as exc:
        print(f"\nERROR: {exc}")
        raise


if __name__ == "__main__":
    main()