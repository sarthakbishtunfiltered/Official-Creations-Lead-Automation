import contextlib
import io
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from cleanup_leads import cleanup_leads, parse_approval, parse_timestamp


def timestamp_hours_ago(hours):
    return (
        datetime.now(timezone.utc) - timedelta(hours=hours)
    ).isoformat()


class TestTimestampParsing(unittest.TestCase):
    def test_valid_timestamp(self):
        result = parse_timestamp(timestamp_hours_ago(1))
        self.assertIsNotNone(result)

    def test_invalid_timestamp(self):
        self.assertIsNone(parse_timestamp("not-a-timestamp"))

    def test_missing_timestamp(self):
        self.assertIsNone(parse_timestamp(""))

    def test_utc_z_timestamp(self):
        result = parse_timestamp("2026-10-01T10:00:00Z")
        self.assertIsNotNone(result)
        self.assertEqual(result.tzinfo, timezone.utc)


class TestApprovalParsing(unittest.TestCase):
    def test_approved_values(self):
        for value in ["TRUE", "true", "yes", "1"]:
            with self.subTest(value=value):
                self.assertTrue(parse_approval(value))

    def test_unapproved_values(self):
        for value in ["FALSE", "false", "no", "0", ""]:
            with self.subTest(value=value):
                self.assertFalse(parse_approval(value))

    def test_ambiguous_value(self):
        self.assertIsNone(parse_approval("maybe"))


class TestCleanupDryRun(unittest.TestCase):
    def setUp(self):
        self.headers = [
            "Lead ID",
            "Business Name",
            "Approve",
            "Created At",
        ]

        self.rows = [
            self.headers,
            ["1", "Expired Unapproved", "FALSE", timestamp_hours_ago(60)],
            ["2", "Recent Unapproved", "FALSE", timestamp_hours_ago(12)],
            ["3", "Old Approved", "TRUE", timestamp_hours_ago(100)],
            ["4", "Missing Timestamp", "FALSE", ""],
            ["5", "", "FALSE", timestamp_hours_ago(100)],
            ["6", "Ambiguous Approval", "maybe", timestamp_hours_ago(100)],
        ]

        self.worksheet = Mock()
        self.worksheet.title = "Leads"
        self.worksheet.get_all_values.return_value = self.rows

        self.spreadsheet = Mock()
        self.spreadsheet.title = "Test Spreadsheet"
        self.spreadsheet.worksheet.return_value = self.worksheet

    @patch("cleanup_leads.connect_to_spreadsheet")
    def test_dry_run_identifies_only_expired_unapproved_lead(self, connect):
        connect.return_value = self.spreadsheet

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cleanup_leads(dry_run=True)

        result = output.getvalue()

        self.assertIn("Expired Unapproved", result)
        self.assertNotIn("Recent Unapproved |", result)
        self.assertNotIn("Old Approved |", result)
        self.assertIn("Expired deletion candidates:          1", result)
        self.assertIn("DRY RUN COMPLETE — NO ROWS WERE DELETED.", result)

        self.worksheet.delete_rows.assert_not_called()

    @patch("cleanup_leads.connect_to_spreadsheet")
    def test_execute_deletes_only_expired_unapproved_lead(self, connect):
        connect.return_value = self.spreadsheet

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cleanup_leads(dry_run=False)

        self.worksheet.delete_rows.assert_called_once_with(2)

    @patch("cleanup_leads.connect_to_spreadsheet")
    def test_missing_required_header_stops_safely(self, connect):
        connect.return_value = self.spreadsheet
        self.worksheet.get_all_values.return_value = [
            ["Business Name", "Approve"],
            ["Example", "FALSE"],
        ]

        with self.assertRaisesRegex(RuntimeError, "Missing required headers"):
            cleanup_leads(dry_run=True)

        self.worksheet.delete_rows.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)