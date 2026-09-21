import re
from urllib.parse import urlparse


# =========================================================
# OC QUALIFICATION ENGINE
# =========================================================
#
# Purpose:
# Broad discovery happens in discovery.py.
# This file decides whether a discovered business is
# sufficiently relevant to continue through the pipeline.
#
# IMPORTANT:
# This is NOT the final lead-scoring system yet.
# Rating, reviews, business age, buying signals, tier,
# blacklist and Google Sheets integration come later.
# =========================================================


# =========================================================
# INDUSTRY SIGNALS
# =========================================================
#
# These are signals, NOT exact requirements.
# A business does not need to contain one of these words
# to be relevant.
# =========================================================

INDUSTRY_SIGNALS = {

    "Interior designers": {

        "strong": [
            "interior designer",
            "interior design",
            "interior studio",
            "interior decorator",
            "interior decorators",
            "interior contractor",
            "turnkey interior",
            "turnkey interiors",
            "home interiors",
            "residential interiors",
            "commercial interiors",
            "interior works",
            "interior solution",
            "interior solutions",
        ],

        "related": [
            "furniture",
            "custom furniture",
            "customised furniture",
            "customized furniture",
            "furniture designer",
            "furniture maker",
            "furniture manufacturer",
            "modular kitchen",
            "modular kitchens",
            "modular wardrobe",
            "modular wardrobes",
            "wardrobe",
            "wardrobes",
            "carpenter",
            "carpentry",
            "woodwork",
            "kitchen cabinets",
            "kitchen cabinet",
            "kitchen designer",
            "home decor",
            "home décor",
            "space planning",
            "false ceiling",
            "tv unit",
            "wall panel",
            "storage solution",
            "bespoke furniture",
            "custom cabinetry",
        ],

        "exclude": [
            "handicraft",
            "handicrafts",
            "moorti",
            "murti",
            "idol",
            "statue",
            "gift shop",
            "hardware",
            "plumbing",
            "electrical",
        ],
    },


    "Wedding & event photographers": {

        "strong": [
            "wedding photographer",
            "wedding photography",
            "event photographer",
            "event photography",
            "photography studio",
            "photography",
            "photographer",
            "pre wedding photography",
            "pre-wedding photography",
            "wedding films",
        ],

        "related": [
            "photo studio",
            "photo studio",
            "cinematography",
            "cinematographer",
            "videographer",
            "video production",
            "wedding films",
            "bridal photography",
            "portrait studio",
        ],

        "exclude": [
            "camera repair",
            "camera store",
            "camera shop",
            "electronics",
            "photo frame",
            "printing press",
        ],
    },


    "Boutique/women salon owners": {

        "strong": [
            "beauty salon",
            "women salon",
            "ladies salon",
            "ladies beauty salon",
            "women's salon",
            "womens salon",
            "hair salon",
            "hairdresser",
            "beauty parlour",
            "beauty parlor",
            "beauty studio",
            "women boutique",
            "ladies boutique",
        ],

        "related": [
            "salon",
            "beauty",
            "hair",
            "makeup",
            "make-up",
            "boutique",
            "fashion boutique",
            "designer boutique",
            "nail studio",
            "spa",
        ],

        "exclude": [
            "hardware",
            "automobile",
            "car service",
            "garage",
            "electrical",
            "plumbing",
        ],
    },


    "Cloud kitchens run by homemakers": {

        "strong": [
            "cloud kitchen",
            "home kitchen",
            "home food",
            "home foods",
            "homemade food",
            "homemade foods",
            "home bakery",
            "home bakery",
            "home chef",
            "home chefs",
            "tiffin service",
            "tiffin centre",
            "tiffin center",
        ],

        "related": [
            "kitchen",
            "restaurant",
            "fast food",
            "cafe",
            "bakery",
            "cakes",
            "catering",
            "food delivery",
            "food services",
            "food",
        ],

        "exclude": [
            "bar",
            "pub",
            "nightclub",
        ],
    },


    "Freelance architects & small design firms": {

        "strong": [
            "architect",
            "architects",
            "architecture studio",
            "architecture firm",
            "architectural studio",
            "architectural design",
            "design studio",
            "design firm",
            "architecture and design",
        ],

        "related": [
            "design",
            "designer",
            "planning",
            "urban design",
            "building design",
            "residential design",
            "commercial design",
            "landscape design",
        ],

        "exclude": [
            "hardware",
            "plumbing",
            "electrical",
            "tiles",
            "sanitary",
        ],
    },


    "Event decorators": {

        "strong": [
            "event decorator",
            "event decorators",
            "event decoration",
            "event management",
            "event planner",
            "event planning",
            "wedding decorator",
            "wedding decoration",
            "party decorator",
            "party decoration",
            "decoration services",
        ],

        "related": [
            "decorator",
            "decoration",
            "decor",
            "event",
            "events",
            "party",
            "wedding",
            "mandap",
            "tent",
            "balloon decoration",
            "balloon decorator",
        ],

        "exclude": [
            "hardware",
            "electrical",
            "plumbing",
            "automobile",
            "car service",
        ],
    },


    "Independent doctors/dentists/clinics": {

        "strong": [
            "doctor",
            "doctors",
            "clinic",
            "medical clinic",
            "dental clinic",
            "dentist",
            "dental",
            "physician",
            "medical practice",
            "health clinic",
        ],

        "related": [
            "medical",
            "health",
            "healthcare",
            "specialist",
            "diagnostic",
            "consultant",
            "dr ",
            "dr.",
        ],

        "exclude": [
            "veterinary",
            "vet clinic",
            "pet clinic",
            "animal hospital",
            "animal clinic",
        ],
    },


    "Real estate agents/brokers": {

        "strong": [
            "real estate",
            "realty",
            "real estate agent",
            "real estate broker",
            "property agent",
            "property broker",
            "estate agent",
            "estate broker",
            "realtor",
            "real estate consultant",
        ],

        "related": [
            "property",
            "properties",
            "broker",
            "brokers",
            "realty",
            "developer",
            "developers",
            "property consultant",
            "property consultancy",
        ],

        "exclude": [
            "hotel",
            "restaurant",
            "furniture",
            "hardware",
            "construction material",
        ],
    },


    "Driving schools": {

        "strong": [
            "driving school",
            "driving classes",
            "driving academy",
            "motor driving school",
            "motor training school",
            "driving instructor",
        ],

        "related": [
            "driving",
            "motor training",
            "driving training",
            "car training",
            "driving lessons",
        ],

        "exclude": [
            "car repair",
            "garage",
            "car wash",
            "automobile parts",
            "spare parts",
            "car dealer",
        ],
    },


    "CA firms & small legal practices": {

        "strong": [
            "chartered accountant",
            "chartered accountants",
            "ca firm",
            "ca firms",
            "accounting firm",
            "accountant",
            "tax consultant",
            "tax consultancy",
            "law firm",
            "legal firm",
            "lawyer",
            "advocate",
            "advocates",
            "legal practice",
        ],

        "related": [
            "accounting",
            "accounts",
            "tax",
            "taxation",
            "audit",
            "auditor",
            "legal",
            "law",
            "attorney",
            "consultant",
            "consultancy",
        ],

        "exclude": [
            "school",
            "college",
            "hospital",
            "restaurant",
            "hotel",
        ],
    },
}


# =========================================================
# TEXT NORMALIZATION
# =========================================================

def normalize(value):
    """
    Convert arbitrary text into a normalized lowercase form.
    """

    if value is None:
        return ""

    value = str(value).lower()

    value = value.replace(
        "’",
        "'"
    )

    value = re.sub(
        r"\s+",
        " ",
        value
    )

    return value.strip()


# =========================================================
# BUSINESS TEXT EXTRACTION
# =========================================================

def build_business_text(
    business
):
    """
    Combine useful public business information into one
    searchable text field.

    We deliberately inspect several OSM fields instead
    of relying only on the business name.
    """

    tags = business.get(
        "OSM Tags",
        {}
    )

    values = [

        business.get(
            "Business Name",
            ""
        ),

        business.get(
            "Address",
            ""
        ),

        business.get(
            "Location",
            ""
        ),

        tags.get(
            "name",
            ""
        ),

        tags.get(
            "description",
            ""
        ),

        tags.get(
            "brand",
            ""
        ),

        tags.get(
            "operator",
            ""
        ),

        tags.get(
            "shop",
            ""
        ),

        tags.get(
            "office",
            ""
        ),

        tags.get(
            "craft",
            ""
        ),

        tags.get(
            "amenity",
            ""
        ),

        tags.get(
            "healthcare",
            ""
        ),

        tags.get(
            "speciality",
            ""
        ),

        tags.get(
            "cuisine",
            ""
        ),
    ]

    return normalize(
        " ".join(
            str(value)
            for value in values
            if value
        )
    )


# =========================================================
# WEBSITE
# =========================================================

def has_existing_website(
    business
):
    """
    OC rule:
    A business with an existing website must not enter
    the lead database.
    """

    website = normalize(
        business.get(
            "Website",
            ""
        )
    )

    return bool(website)


# =========================================================
# CONTACTABILITY
# =========================================================

def is_contactable(
    business
):
    """
    Contactability rule:
    Phone OR Instagram.

    Phone is preferred but Instagram can qualify a lead
    when phone is unavailable.
    """

    phone = normalize(
        business.get(
            "Phone",
            ""
        )
    )

    instagram = normalize(
        business.get(
            "Instagram ID",
            ""
        )
    )

    return bool(
        phone or instagram
    )


# =========================================================
# SIGNAL MATCHING
# =========================================================

def find_matching_signal(
    text,
    signals
):
    """
    Return the first matching signal.
    """

    for signal in signals:

        signal_normalized = normalize(
            signal
        )

        if signal_normalized in text:

            return signal

    return None


def classify_industry_relevance(
    business,
    industry
):
    """
    Classify the business as:

    STRONG
    RELATED
    UNKNOWN
    EXCLUDED

    This classification is intentionally not treated as
    absolute truth.
    """

    if industry not in INDUSTRY_SIGNALS:

        return {
            "level": "UNKNOWN",
            "signal": "",
            "reason": "Industry mapping unavailable",
        }

    text = build_business_text(
        business
    )

    signals = INDUSTRY_SIGNALS[
        industry
    ]

    # -----------------------------------------------------
    # EXCLUSIONS FIRST
    # -----------------------------------------------------

    exclusion = find_matching_signal(
        text,
        signals["exclude"]
    )

    if exclusion:

        return {
            "level": "EXCLUDED",
            "signal": exclusion,
            "reason": (
                f"Excluded signal: {exclusion}"
            ),
        }

    # -----------------------------------------------------
    # STRONG SIGNAL
    # -----------------------------------------------------

    strong = find_matching_signal(
        text,
        signals["strong"]
    )

    if strong:

        return {
            "level": "STRONG",
            "signal": strong,
            "reason": (
                f"Strong industry signal: {strong}"
            ),
        }

    # -----------------------------------------------------
    # RELATED SIGNAL
    # -----------------------------------------------------

    related = find_matching_signal(
        text,
        signals["related"]
    )

    if related:

        return {
            "level": "RELATED",
            "signal": related,
            "reason": (
                f"Related industry signal: {related}"
            ),
        }

    # -----------------------------------------------------
    # UNKNOWN
    # -----------------------------------------------------

    return {
        "level": "UNKNOWN",
        "signal": "",
        "reason": (
            "No reliable industry signal found"
        ),
    }


# =========================================================
# MAIN QUALIFICATION
# =========================================================

def qualify_business(
    business,
    industry
):
    """
    Run the current OC qualification rules.

    Returns a structured result instead of modifying the
    original business.
    """

    result = {
        "qualified": False,
        "industry": industry,
        "relevance": "UNKNOWN",
        "reason": "",
        "website_status": "",
        "contactability": "",
        "signal": "",
    }

    # -----------------------------------------------------
    # WEBSITE
    # -----------------------------------------------------

    if has_existing_website(
        business
    ):

        result["website_status"] = (
            "Existing website"
        )

        result["reason"] = (
            "Existing website"
        )

        return result

    result["website_status"] = (
        "No website detected"
    )

    # -----------------------------------------------------
    # CONTACTABILITY
    # -----------------------------------------------------

    if not is_contactable(
        business
    ):

        result["contactability"] = (
            "No phone or Instagram"
        )

        result["reason"] = (
            "No phone or Instagram"
        )

        return result

    phone = normalize(
        business.get(
            "Phone",
            ""
        )
    )

    instagram = normalize(
        business.get(
            "Instagram ID",
            ""
        )
    )

    if phone and instagram:

        result["contactability"] = (
            "Phone + Instagram"
        )

    elif phone:

        result["contactability"] = (
            "Phone"
        )

    else:

        result["contactability"] = (
            "Instagram"
        )

    # -----------------------------------------------------
    # INDUSTRY RELEVANCE
    # -----------------------------------------------------

    relevance = classify_industry_relevance(
        business,
        industry
    )

    result["relevance"] = relevance[
        "level"
    ]

    result["signal"] = relevance[
        "signal"
    ]

    # -----------------------------------------------------
    # EXCLUDED
    # -----------------------------------------------------

    if relevance["level"] == "EXCLUDED":

        result["reason"] = relevance[
            "reason"
        ]

        return result

    # -----------------------------------------------------
    # UNKNOWN
    # -----------------------------------------------------

    if relevance["level"] == "UNKNOWN":

        result["reason"] = (
            "Needs industry verification"
        )

        return result

    # -----------------------------------------------------
    # STRONG / RELATED
    # -----------------------------------------------------
    #
    # Both can continue for now.
    # Later verification can decide whether a RELATED
    # candidate becomes a final lead.
    # -----------------------------------------------------

    result["qualified"] = True

    result["reason"] = relevance[
        "reason"
    ]

    return result


# =========================================================
# BATCH QUALIFICATION
# =========================================================

def qualify_businesses(
    businesses,
    industry
):
    """
    Qualify a list of discovered businesses.

    Returns only candidates that pass the current
    qualification layer.
    """

    qualified = []

    summary = {
        "total": 0,
        "qualified": 0,
        "existing_website": 0,
        "no_contact": 0,
        "excluded": 0,
        "unknown": 0,
        "strong": 0,
        "related": 0,
    }

    for business in businesses:

        summary["total"] += 1

        result = qualify_business(
            business,
            industry
        )

        business["Qualification"] = result

        if result["qualified"]:

            qualified.append(
                business
            )

            summary["qualified"] += 1

            if result["relevance"] == "STRONG":
                summary["strong"] += 1

            elif result["relevance"] == "RELATED":
                summary["related"] += 1

        else:

            reason = result["reason"]

            if reason == "Existing website":

                summary["existing_website"] += 1

            elif reason == "No phone or Instagram":

                summary["no_contact"] += 1

            elif result["relevance"] == "EXCLUDED":

                summary["excluded"] += 1

            else:

                summary["unknown"] += 1

    return qualified, summary


# =========================================================
# PRINT QUALIFICATION REPORT
# =========================================================

def print_qualification_report(
    businesses,
    industry
):

    qualified, summary = qualify_businesses(
        businesses,
        industry
    )

    print(
        "\n========== QUALIFICATION SUMMARY =========="
    )

    print(
        f"Candidates received: "
        f"{summary['total']}"
    )

    print(
        f"Qualified: "
        f"{summary['qualified']}"
    )

    print(
        f"Strong matches: "
        f"{summary['strong']}"
    )

    print(
        f"Related matches: "
        f"{summary['related']}"
    )

    print(
        f"Existing website: "
        f"{summary['existing_website']}"
    )

    print(
        f"No phone/Instagram: "
        f"{summary['no_contact']}"
    )

    print(
        f"Excluded: "
        f"{summary['excluded']}"
    )

    print(
        f"Unknown / needs verification: "
        f"{summary['unknown']}"
    )

    print(
        "\n========== QUALIFIED BUSINESSES =========="
    )

    if not qualified:

        print(
            "No businesses qualified."
        )

        return qualified

    for number, business in enumerate(
        qualified,
        start=1
    ):

        qualification = business[
            "Qualification"
        ]

        print(
            f"\n{number}. "
            f"{business.get('Business Name', '')}"
        )

        print(
            f"   Relevance: "
            f"{qualification['relevance']}"
        )

        print(
            f"   Signal: "
            f"{qualification['signal']}"
        )

        print(
            f"   Contact: "
            f"{qualification['contactability']}"
        )

        print(
            f"   Phone: "
            f"{business.get('Phone', '')}"
        )

        print(
            f"   Instagram: "
            f"{business.get('Instagram ID', '')}"
        )

        print(
            f"   Website: "
            f"{business.get('Website', '')}"
        )

    return qualified


# =========================================================
# SIMPLE TEST FUNCTION
# =========================================================

def test_qualification(
    businesses,
    industry
):

    return print_qualification_report(
        businesses,
        industry
    )