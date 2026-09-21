from discovery import (
    discover_businesses,
    geocode_location,
    find_industry_tags,
    query_overpass,
    query_overpass_fallback,
    extract_business,
)


def main():

    print(
        "Starting OC discovery inspection test...\n"
    )

    industry = "Interior designers"
    location = "Ahmedabad, Gujarat"

    print(
        f"Inspecting raw candidates for "
        f"{industry} in {location}...\n"
    )

    bounding_box = geocode_location(
        location
    )

    tag_queries = find_industry_tags(
        industry
    )

    elements = query_overpass(
        bounding_box,
        tag_queries
    )

    if not elements:

        elements = query_overpass_fallback(
            bounding_box,
            industry
        )

    print(
        f"\n========== RAW CANDIDATES: "
        f"{len(elements)} ==========\n"
    )

    if not elements:

        print("No raw candidates found.")
        return

    for number, element in enumerate(
        elements,
        start=1
    ):

        business = extract_business(
            element,
            industry,
            location
        )

        if not business:
            continue

        print(
            f"{number}. "
            f"{business['Business Name']}"
        )

        print(
            f"   Phone: "
            f"{business['Phone']}"
        )

        print(
            f"   Instagram: "
            f"{business['Instagram ID']}"
        )

        print(
            f"   Website: "
            f"{business['Website']}"
        )

        print(
            f"   Email: "
            f"{business['Email']}"
        )

        print(
            f"   Address: "
            f"{business['Address']}"
        )

        print(
            f"   OSM Type: "
            f"{business['OSM Type']}"
        )

        print(
            f"   OSM ID: "
            f"{business['OSM ID']}"
        )

        print(
            f"   OSM Tags: "
            f"{business['OSM Tags']}"
        )

        print(
            "\n" + "-" * 70 + "\n"
        )


if __name__ == "__main__":
    main()