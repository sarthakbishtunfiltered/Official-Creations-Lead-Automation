"""Manual discovery inspection script -- NOT a pytest test.

Prints the raw candidate businesses found by the live discover_businesses()
pipeline (Bing web search + Instagram profile scraping) for a single
industry/location, so results can be eyeballed without touching Google
Sheets or qualification logic.

This makes real network requests. Run it manually:

    py inspect_discovery.py

It is intentionally named without a "test_" prefix so pytest does not
collect or import it automatically.
"""
from discovery import discover_businesses


def main():
    print("Starting OC discovery inspection test...\n")

    industry = "Interior designers"
    location = "Ahmedabad, Gujarat"

    print(f"Inspecting raw candidates for {industry} in {location}...\n")

    candidates = discover_businesses(
        industry=industry,
        locations=[location],
    )

    print(f"\n========== RAW CANDIDATES: {len(candidates)} ==========\n")

    if not candidates:
        print("No raw candidates found.")
        return

    for number, business in enumerate(candidates, start=1):
        print(f"{number}. {business['Business Name']}")
        print(f"   Phone: {business['Phone']}")
        print(f"   Instagram: {business['Instagram ID']}")
        print(
            f"   Website: {business['Website']} "
            f"({business['Website Status']})"
        )
        print(f"   Source: {business['Lead Source']}")
        print(f"   Source URL: {business['Source URL']}")
        print(f"   Search Query: {business['Search Query']}")
        print("\n" + "-" * 70 + "\n")


if __name__ == "__main__":
    main()
