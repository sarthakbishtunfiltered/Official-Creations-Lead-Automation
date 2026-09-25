// ============================================================
// CONFIG — fill these in once. Nothing else in the frontend
// needs editing. See SETUP.md for how to get each value.
// ============================================================

const CONFIG = {
  // Google Cloud OAuth 2.0 Client ID (Web application type).
  // Create in Google Cloud Console → APIs & Services → Credentials.
  GOOGLE_CLIENT_ID: "987101804945-f88mi0u2m9lgsumrn1v4er73nreq9rjn.apps.googleusercontent.com",

  // The Lead Database spreadsheet's ID — the long string in its URL:
  // https://docs.google.com/spreadsheets/d/  <THIS_PART>  /edit
  SPREADSHEET_ID: "1oyTvlDKd7gZ9WyibLDwqL2A5ElGS30IbHa7voO0xhwM",

  // Google Drive file ID of the same spreadsheet (same value as
  // SPREADSHEET_ID — Sheets IDs and Drive file IDs are the same
  // string). Used only to check the signed-in user's Viewer/Editor
  // role via the Drive API.
  DRIVE_FILE_ID: "1oyTvlDKd7gZ9WyibLDwqL2A5ElGS30IbHa7voO0xhwM",

  // Exact sheet tab names, as they appear in the spreadsheet.
  TABS: {
    LEADS: "Leads",
    BLACKLISTED: "Blacklisted",
    CALLED_REJECTED: "Called Rejected",
    SETTINGS: "Settings",
  },

  // How often the site re-reads the sheet, in milliseconds.
  POLL_INTERVAL_MS: 30000,
};