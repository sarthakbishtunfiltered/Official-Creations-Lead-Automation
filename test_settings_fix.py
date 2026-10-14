"""
Focused test for the Settings -> discovery.py key-matching fix.

Uses your real Settings values (from section 6 of the handover doc)
directly as a dict -- no Google Sheets connection, no network calls.
Run with:

    py test_settings_fix.py

Place this in the project root (next to discovery.py) before running.
"""

from discovery import _industries_from_settings, _locations_from_settings

# Exactly what read_settings() produces today, per the handover notes.
real_settings = {
    "industries": "Interior Designer",
    "cities / locations": "ahmedabad south bopal",
    "discovery sources": "OSM (OpenStreetMap)",
    "buying-signal window": "14",
    "minimum business age": "1",
    "automation status": "START",
    "run until": "2026-10-10T12:30:00Z",
    "session duration (min)": "90",
}

industries = _industries_from_settings(real_settings)
locations = _locations_from_settings(real_settings)

print(f"Industries parsed: {industries}")
print(f"Locations parsed:  {locations}")

assert industries, "FAIL: industries came back empty"
assert locations, "FAIL: locations came back empty -- the bug is still present"

print("\nPASS: both industries and locations parsed correctly.")