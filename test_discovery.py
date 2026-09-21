from discovery import discover_businesses


def main():
    print("Starting OC discovery test...\n")

    industry = "Interior designers"
    locations = ["Ahmedabad"]

    businesses = discover_businesses(
        industry,
        locations,
    )

    print(
        "\n========== DISCOVERED BUSINESSES ==========\n"
    )

    if not businesses:
        print("No businesses discovered.")
        return

    for number, business in enumerate(
        businesses,
        start=1,
    ):
        print(
            f"{number}. "
            f"{business['Business Name']}"
        )

        print(
            f"   Industry: "
            f"{business['Industry']}"
        )

        print(
            f"   Location: "
            f"{business['Location']}"
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
            f"   Source: "
            f"{business['Lead Source']}"
        )

        print(
            f"   OSM ID: "
            f"{business['OSM ID']}"
        )

        print()


if __name__ == "__main__":
    main()