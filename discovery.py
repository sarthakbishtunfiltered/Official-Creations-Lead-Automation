import requests
import time
import re


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

NOMINATIM_ENDPOINT = (
    "https://nominatim.openstreetmap.org/search"
)

HEADERS = {
    "User-Agent": "OC-Lead-Automation/1.0"
}

OVERPASS_TIMEOUT = 45
OVERPASS_REQUEST_TIMEOUT = 60
GRID_ROWS = 2
GRID_COLUMNS = 2
TAG_BATCH_SIZE = 3
FALLBACK_PATTERN_BATCH_SIZE = 5
OVERPASS_RETRIES = 2


# =========================================================
# OC INDUSTRY → BROAD OSM DISCOVERY TAGS
# =========================================================

INDUSTRY_TAGS = {

    "Interior designers": [
        '["shop"="furniture"]',
        '["shop"="interior_decoration"]',
        '["craft"="interior_designer"]',
        '["office"="architect"]',
        '["office"="design"]',
        '["craft"="carpenter"]',
        '["shop"="kitchen"]',
    ],

    "Wedding & event photographers": [
        '["shop"="photography"]',
        '["shop"="photo"]',
        '["craft"="photographer"]',
        '["office"="photographer"]',
        '["amenity"="studio"]',
    ],

    "Boutique/women salon owners": [
        '["shop"="beauty"]',
        '["shop"="hairdresser"]',
        '["shop"="clothes"]',
        '["shop"="boutique"]',
    ],

    "Cloud kitchens run by homemakers": [
        '["amenity"="restaurant"]',
        '["amenity"="fast_food"]',
        '["amenity"="cafe"]',
        '["craft"="caterer"]',
    ],

    "Freelance architects & small design firms": [
        '["office"="architect"]',
        '["craft"="architect"]',
        '["office"="design"]',
    ],

    "Event decorators": [
        '["shop"="party"]',
        '["craft"="event_decorator"]',
        '["office"="event_management"]',
    ],

    "Independent doctors/dentists/clinics": [
        '["amenity"="clinic"]',
        '["amenity"="doctors"]',
        '["amenity"="dentist"]',
        '["healthcare"="doctor"]',
        '["healthcare"="dentist"]',
    ],

    "Real estate agents/brokers": [
        '["office"="estate_agent"]',
        '["shop"="estate_agent"]',
    ],

    "Driving schools": [
        '["amenity"="driving_school"]',
    ],

    "CA firms & small legal practices": [
        '["office"="accountant"]',
        '["office"="lawyer"]',
        '["office"="tax_advisor"]',
    ],
}


# =========================================================
# FALLBACK NAME / DESCRIPTION SEARCH
# =========================================================

INDUSTRY_FALLBACK_PATTERNS = {

    "Interior designers": [
        "interior",
        "interiors",
        "furniture",
        "modular kitchen",
        "wardrobe",
        "home decor",
        "home décor",
        "interior design",
        "interior designer",
        "design studio",
        "architect",
        "architecture",
        "kitchen",
    ],

    "Wedding & event photographers": [
        "photograph",
        "photo studio",
        "photography",
        "wedding photographer",
        "wedding photography",
        "pre wedding",
        "pre-wedding",
        "event photographer",
        "cinematography",
        "videographer",
    ],

    "Boutique/women salon owners": [
        "salon",
        "beauty",
        "hair salon",
        "hairdresser",
        "beauty parlour",
        "beauty parlor",
        "boutique",
        "ladies boutique",
        "women boutique",
    ],

    "Cloud kitchens run by homemakers": [
        "cloud kitchen",
        "home kitchen",
        "home food",
        "homemade food",
        "home bakery",
        "home chef",
        "tiffin",
    ],

    "Freelance architects & small design firms": [
        "architect",
        "architecture",
        "architecture studio",
        "architectural design",
        "design studio",
        "design firm",
    ],

    "Event decorators": [
        "event decorator",
        "event decoration",
        "wedding decorator",
        "wedding decoration",
        "party decorator",
        "party decoration",
        "event management",
        "mandap",
        "balloon decoration",
    ],

    "Independent doctors/dentists/clinics": [
        "doctor",
        "clinic",
        "dentist",
        "dental clinic",
        "physician",
        "medical clinic",
        "health clinic",
    ],

    "Real estate agents/brokers": [
        "real estate",
        "realty",
        "property agent",
        "property broker",
        "realtor",
        "estate agent",
    ],

    "Driving schools": [
        "driving school",
        "driving classes",
        "driving academy",
        "motor driving school",
        "driving instructor",
    ],

    "CA firms & small legal practices": [
        "chartered accountant",
        "ca firm",
        "accounting firm",
        "tax consultant",
        "law firm",
        "legal firm",
        "lawyer",
        "advocate",
    ],
}


# =========================================================
# INDUSTRY RELEVANCE KEYWORDS
# =========================================================

INDUSTRY_KEYWORDS = {

    "Interior designers": [
        "interior",
        "interiors",
        "interior design",
        "interior designer",
        "design studio",
        "designs",
        "architecture",
        "architect",
        "decor",
        "decorator",
        "furniture",
        "home decor",
        "home décor",
        "modular kitchen",
        "modular",
        "wardrobe",
        "carpenter",
        "carpentry",
        "woodwork",
    ],

    "Wedding & event photographers": [
        "photography",
        "photographer",
        "photo",
        "studio",
        "wedding",
        "weddings",
        "cinema",
        "cinematography",
        "films",
        "film",
        "pre wedding",
        "pre-wedding",
        "videographer",
        "videography",
    ],

    "Boutique/women salon owners": [
        "salon",
        "beauty",
        "hair",
        "hairdresser",
        "makeup",
        "make-up",
        "boutique",
        "fashion",
        "women",
        "ladies",
    ],

    "Cloud kitchens run by homemakers": [
        "kitchen",
        "home kitchen",
        "cloud kitchen",
        "homemade",
        "home food",
        "home foods",
        "tiffin",
        "bakery",
        "cakes",
        "catering",
        "foods",
        "food",
    ],

    "Freelance architects & small design firms": [
        "architect",
        "architecture",
        "architects",
        "design",
        "design studio",
        "designers",
        "studio",
    ],

    "Event decorators": [
        "decorator",
        "decoration",
        "decor",
        "event",
        "events",
        "party",
        "wedding",
        "weddings",
        "mandap",
        "tent",
        "balloon",
    ],

    "Independent doctors/dentists/clinics": [
        "doctor",
        "doctors",
        "clinic",
        "dental",
        "dentist",
        "hospital",
        "medical",
        "health",
        "physician",
        "dr.",
        "dr ",
    ],

    "Real estate agents/brokers": [
        "real estate",
        "estate",
        "property",
        "properties",
        "realtor",
        "broker",
        "brokers",
        "realty",
        "developers",
        "developer",
    ],

    "Driving schools": [
        "driving",
        "driving school",
        "motor training",
        "motor driving",
        "driving classes",
    ],

    "CA firms & small legal practices": [
        "ca ",
        "chartered accountant",
        "chartered accountants",
        "accountant",
        "accounting",
        "accounts",
        "tax",
        "taxation",
        "law",
        "lawyer",
        "legal",
        "advocate",
        "advocates",
        "attorney",
    ],
}


# =========================================================
# INDUSTRY EXCLUSION KEYWORDS
# =========================================================

INDUSTRY_EXCLUSIONS = {

    "Interior designers": [
        "handicraft",
        "handicrafts",
        "moorti",
        "murti",
        "idol",
        "temple",
        "statue",
        "gift shop",
        "gift",
        "hardware",
        "tiles",
        "sanitary",
        "plumbing",
        "electrical",
        "paint shop",
    ],

    "Wedding & event photographers": [
        "camera repair",
        "camera store",
        "camera shop",
        "electronics",
        "photo frame",
        "printing press",
    ],

    "Boutique/women salon owners": [
        "hardware",
        "automobile",
        "car service",
        "garage",
        "electrical",
        "plumbing",
    ],

    "Cloud kitchens run by homemakers": [
        "bar",
        "pub",
        "hotel",
        "nightclub",
    ],

    "Freelance architects & small design firms": [
        "hardware",
        "plumbing",
        "electrical",
        "tiles",
        "sanitary",
    ],

    "Event decorators": [
        "hardware",
        "electrical",
        "plumbing",
        "automobile",
        "car",
    ],

    "Independent doctors/dentists/clinics": [
        "veterinary",
        "vet clinic",
        "pet clinic",
        "animal hospital",
    ],

    "Real estate agents/brokers": [
        "hotel",
        "restaurant",
        "furniture",
        "hardware",
        "construction material",
    ],

    "Driving schools": [
        "car repair",
        "garage",
        "car wash",
        "automobile parts",
        "spare parts",
    ],

    "CA firms & small legal practices": [
        "school",
        "college",
        "hospital",
        "restaurant",
        "hotel",
    ],
}


# =========================================================
# BASIC HELPERS
# =========================================================

def normalize(value):
    return str(value).strip().lower()


def split_locations(value):

    if not value:
        return []

    value = str(value)

    for separator in ["\n", ";"]:
        value = value.replace(separator, ",")

    return [
        location.strip()
        for location in value.split(",")
        if location.strip()
    ]


def find_industry_tags(industry):

    if not industry:
        return []

    target = normalize(industry)

    for name, tags in INDUSTRY_TAGS.items():

        if normalize(name) == target:
            return tags

    return []


def chunk_list(items, size):

    if size <= 0:
        return [items]

    return [
        items[index:index + size]
        for index in range(
            0,
            len(items),
            size
        )
    ]


# =========================================================
# LOCATION
# =========================================================

def geocode_location(location):

    print(
        f"Finding geographic area for {location}..."
    )

    params = {
        "q": f"{location}, India",
        "format": "json",
        "limit": 1,
        "countrycodes": "in",
    }

    response = requests.get(
        NOMINATIM_ENDPOINT,
        params=params,
        headers=HEADERS,
        timeout=30,
    )

    print(
        f"Nominatim HTTP status: "
        f"{response.status_code}"
    )

    response.raise_for_status()

    results = response.json()

    if not results:
        raise RuntimeError(
            f"Location not found: {location}"
        )

    result = results[0]

    bounding_box = result.get(
        "boundingbox"
    )

    if not bounding_box:
        raise RuntimeError(
            f"No geographic boundary found "
            f"for {location}"
        )

    print(
        f"Location found: "
        f"{result.get('display_name', location)}"
    )

    return {
        "south": float(bounding_box[0]),
        "north": float(bounding_box[1]),
        "west": float(bounding_box[2]),
        "east": float(bounding_box[3]),
    }


# =========================================================
# GEOGRAPHIC GRID
# =========================================================

def split_bounding_box(
    bounding_box,
    rows=GRID_ROWS,
    columns=GRID_COLUMNS,
):

    south = bounding_box["south"]
    north = bounding_box["north"]
    west = bounding_box["west"]
    east = bounding_box["east"]

    latitude_step = (
        north - south
    ) / rows

    longitude_step = (
        east - west
    ) / columns

    cells = []

    for row in range(rows):

        cell_south = (
            south +
            row * latitude_step
        )

        cell_north = (
            south +
            (row + 1) * latitude_step
        )

        for column in range(columns):

            cell_west = (
                west +
                column * longitude_step
            )

            cell_east = (
                west +
                (column + 1) *
                longitude_step
            )

            cells.append({
                "south": cell_south,
                "north": cell_north,
                "west": cell_west,
                "east": cell_east,
            })

    return cells


# =========================================================
# OVERPASS QUERY
# =========================================================

def build_overpass_query(
    bounding_box,
    tag_queries,
):

    south = bounding_box["south"]
    north = bounding_box["north"]
    west = bounding_box["west"]
    east = bounding_box["east"]

    area = (
        f"{south},{west},{north},{east}"
    )

    blocks = []

    for tag_query in tag_queries:

        blocks.append(
            f"nwr{tag_query}({area});"
        )

    query = f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];

(
    {"".join(blocks)}
);

out center tags;
"""

    return query


def build_fallback_name_query(
    bounding_box,
    industry,
    patterns=None,
):

    south = bounding_box["south"]
    north = bounding_box["north"]
    west = bounding_box["west"]
    east = bounding_box["east"]

    area = (
        f"{south},{west},{north},{east}"
    )

    if patterns is None:
        patterns = INDUSTRY_FALLBACK_PATTERNS.get(
            industry,
            []
        )

    if not patterns:
        return None

    escaped_patterns = []

    for pattern in patterns:

        escaped_patterns.append(
            re.escape(pattern)
        )

    regex = "|".join(
        escaped_patterns
    )

    return f"""
[out:json][timeout:{OVERPASS_TIMEOUT}];

(
    nwr["name"~"{regex}",i]({area});
    nwr["name:en"~"{regex}",i]({area});
    nwr["description"~"{regex}",i]({area});
    nwr["brand"~"{regex}",i]({area});
    nwr["operator"~"{regex}",i]({area});
);

out center tags;
"""


def query_overpass_query(
    query,
):

    for endpoint in OVERPASS_ENDPOINTS:

        print(
            f"Trying Overpass endpoint: "
            f"{endpoint}"
        )

        for attempt in range(
            1,
            OVERPASS_RETRIES + 1
        ):

            try:

                response = requests.post(
                    endpoint,
                    data={
                        "data": query,
                    },
                    headers=HEADERS,
                    timeout=OVERPASS_REQUEST_TIMEOUT,
                )

                print(
                    f"Overpass HTTP status: "
                    f"{response.status_code}"
                )

                response.raise_for_status()

                data = response.json()

                print(
                    "Overpass response received."
                )

                return data.get(
                    "elements",
                    []
                )

            except requests.Timeout as error:

                print(
                    f"Overpass timeout "
                    f"(attempt {attempt}/"
                    f"{OVERPASS_RETRIES}): "
                    f"{error}"
                )

            except requests.RequestException as error:

                print(
                    f"Overpass request failed "
                    f"(attempt {attempt}/"
                    f"{OVERPASS_RETRIES}): "
                    f"{error}"
                )

            except ValueError as error:

                print(
                    f"Invalid Overpass JSON "
                    f"(attempt {attempt}/"
                    f"{OVERPASS_RETRIES}): "
                    f"{error}"
                )

            if attempt < OVERPASS_RETRIES:
                time.sleep(2)

        print(
            "Switching to next Overpass endpoint..."
        )

    print(
        "All Overpass endpoints failed."
    )

    return []


def query_overpass(
    bounding_box,
    tag_queries,
):

    if not tag_queries:
        return []

    all_elements = []

    batches = chunk_list(
        tag_queries,
        TAG_BATCH_SIZE
    )

    for batch_number, batch in enumerate(
        batches,
        start=1
    ):

        print(
            f"Running tag batch "
            f"{batch_number}/{len(batches)}..."
        )

        query = build_overpass_query(
            bounding_box,
            batch
        )

        elements = query_overpass_query(
            query
        )

        all_elements.extend(
            elements
        )

        time.sleep(1)

    return deduplicate_raw_elements(
        all_elements
    )


def query_overpass_fallback(
    bounding_box,
    industry,
):

    patterns = INDUSTRY_FALLBACK_PATTERNS.get(
        industry,
        []
    )

    if not patterns:
        return []

    print(
        "Trying controlled name/description "
        "fallback search..."
    )

    all_elements = []

    pattern_batches = chunk_list(
        patterns,
        FALLBACK_PATTERN_BATCH_SIZE
    )

    for batch_number, pattern_batch in enumerate(
        pattern_batches,
        start=1
    ):

        print(
            f"Fallback pattern batch "
            f"{batch_number}/"
            f"{len(pattern_batches)}..."
        )

        query = build_fallback_name_query(
            bounding_box,
            industry,
            pattern_batch
        )

        if not query:
            continue

        elements = query_overpass_query(
            query
        )

        all_elements.extend(
            elements
        )

        time.sleep(1)

    return deduplicate_raw_elements(
        all_elements
    )


# =========================================================
# RAW OSM DEDUPLICATION
# =========================================================

def deduplicate_raw_elements(
    elements
):

    unique = {}

    for element in elements:

        element_type = str(
            element.get("type", "")
        )

        element_id = str(
            element.get("id", "")
        )

        if element_type and element_id:

            key = (
                element_type,
                element_id,
            )

        else:

            tags = element.get(
                "tags",
                {}
            )

            key = (
                normalize(
                    tags.get("name", "")
                ),
                normalize(
                    tags.get("name:en", "")
                ),
            )

        if key not in unique:

            unique[key] = element

    return list(
        unique.values()
    )


# =========================================================
# BUSINESS EXTRACTION
# =========================================================

def extract_business(
    element,
    industry,
    location,
):

    tags = element.get(
        "tags",
        {}
    )

    if not isinstance(tags, dict):
        tags = {}

    name = (
        tags.get("name")
        or tags.get("name:en")
        or tags.get("brand")
        or tags.get("operator")
        or ""
    )

    name = str(name).strip()

    if not name:
        return None

    latitude = element.get("lat")
    longitude = element.get("lon")

    if latitude is None or longitude is None:

        center = element.get(
            "center",
            {}
        )

        latitude = center.get("lat")
        longitude = center.get("lon")

    website = (
        tags.get("website")
        or tags.get("contact:website")
        or ""
    )

    phone = (
        tags.get("phone")
        or tags.get("contact:phone")
        or ""
    )

    instagram = (
        tags.get("contact:instagram")
        or tags.get("instagram")
        or ""
    )

    email = (
        tags.get("email")
        or tags.get("contact:email")
        or ""
    )

    address_parts = [
        tags.get("addr:housenumber", ""),
        tags.get("addr:street", ""),
        tags.get("addr:place", ""),
        tags.get("addr:suburb", ""),
    ]

    address = ", ".join(
        str(part).strip()
        for part in address_parts
        if part and str(part).strip()
    )

    return {
        "Business Name": name,
        "Industry": industry,
        "Location": location,
        "Phone": str(phone).strip(),
        "Instagram ID": str(instagram).strip(),
        "Website": str(website).strip(),
        "Email": str(email).strip(),
        "Address": address,
        "City": str(
            tags.get("addr:city")
            or location
        ).strip(),
        "Latitude": latitude,
        "Longitude": longitude,
        "OSM ID": str(
            element.get("id", "")
        ),
        "OSM Type": element.get(
            "type",
            ""
        ),
        "OSM Tags": tags,
        "Lead Source": "OpenStreetMap",
    }


# =========================================================
# INDUSTRY RELEVANCE
# =========================================================

def business_text(business):

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
        tags.get(
            "name",
            ""
        ),
        tags.get(
            "name:en",
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


def check_industry_relevance(
    business,
    industry,
):

    text = business_text(
        business
    )

    exclusions = INDUSTRY_EXCLUSIONS.get(
        industry,
        []
    )

    for keyword in exclusions:

        if normalize(keyword) in text:

            return False, (
                f"Industry mismatch: "
                f"contains '{keyword}'"
            )

    keywords = INDUSTRY_KEYWORDS.get(
        industry,
        []
    )

    tags = business.get(
        "OSM Tags",
        {}
    )

    strong_tag_values = " ".join([
        str(tags.get("craft", "")),
        str(tags.get("office", "")),
        str(tags.get("amenity", "")),
        str(tags.get("healthcare", "")),
        str(tags.get("shop", "")),
    ]).lower()

    strong_industry_tags = {

        "Interior designers": [
            "interior_decoration",
            "interior_designer",
        ],

        "Wedding & event photographers": [
            "photographer",
            "photography",
            "photo",
        ],

        "Boutique/women salon owners": [
            "beauty",
            "hairdresser",
        ],

        "Cloud kitchens run by homemakers": [
            "restaurant",
            "fast_food",
            "cafe",
            "caterer",
        ],

        "Freelance architects & small design firms": [
            "architect",
        ],

        "Event decorators": [
            "event_decorator",
            "event_management",
        ],

        "Independent doctors/dentists/clinics": [
            "clinic",
            "doctors",
            "dentist",
            "doctor",
        ],

        "Real estate agents/brokers": [
            "estate_agent",
        ],

        "Driving schools": [
            "driving_school",
        ],

        "CA firms & small legal practices": [
            "accountant",
            "lawyer",
            "tax_advisor",
        ],
    }

    for tag in strong_industry_tags.get(
        industry,
        []
    ):

        if tag in strong_tag_values:

            return True, (
                "Strong OSM industry tag"
            )

    for keyword in keywords:

        if normalize(keyword) in text:

            return True, (
                f"Relevant keyword: "
                f"'{keyword}'"
            )

    return False, (
        "No sufficient industry relevance"
    )


# =========================================================
# WEBSITE FILTER
# =========================================================

def has_existing_website(
    business
):

    website = normalize(
        business.get(
            "Website",
            ""
        )
    )

    return bool(website)


# =========================================================
# CONTACTABILITY FILTER
# =========================================================

def is_contactable(
    business
):

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
# QUALITY FILTER
# =========================================================

def filter_business(
    business,
    industry,
):

    if has_existing_website(
        business
    ):

        return False, (
            "Existing website"
        )

    relevant, reason = (
        check_industry_relevance(
            business,
            industry
        )
    )

    if not relevant:

        return False, reason

    if not is_contactable(
        business
    ):

        return False, (
            "No phone or Instagram"
        )

    return True, (
        "Passed discovery filters"
    )


# =========================================================
# BUSINESS DEDUPLICATION
# =========================================================

def deduplicate_businesses(
    businesses
):

    unique = {}

    for business in businesses:

        osm_id = business.get(
            "OSM ID",
            ""
        )

        osm_type = business.get(
            "OSM Type",
            ""
        )

        if osm_id:

            key = (
                "osm",
                osm_type,
                osm_id,
            )

        else:

            key = (
                "name_location",

                normalize(
                    business.get(
                        "Business Name",
                        ""
                    )
                ),

                normalize(
                    business.get(
                        "Location",
                        ""
                    )
                ),
            )

        if key not in unique:

            unique[key] = business

    return list(
        unique.values()
    )


# =========================================================
# RAW CANDIDATE INSPECTION
# =========================================================

def inspect_raw_elements(
    elements,
    industry,
    location,
):

    businesses = []

    extraction_failures = 0

    for index, element in enumerate(
        elements,
        start=1
    ):

        business = extract_business(
            element,
            industry,
            location
        )

        if business:

            businesses.append(
                business
            )

            continue

        extraction_failures += 1

        tags = element.get(
            "tags",
            {}
        )

        print(
            f"\nRAW CANDIDATE #{index}"
        )

        print(
            "Extraction result: FAILED"
        )

        print(
            f"OSM Type: "
            f"{element.get('type', '')}"
        )

        print(
            f"OSM ID: "
            f"{element.get('id', '')}"
        )

        print(
            f"OSM Tags: {tags}"
        )

        print(
            "Reason: no usable business name"
        )

        print(
            "-" * 70
        )

    return businesses, extraction_failures


# =========================================================
# LARGE-SCALE DISCOVERY PASS
# =========================================================

def discover_raw_elements(
    bounding_box,
    industry,
):

    tag_queries = find_industry_tags(
        industry
    )

    all_elements = []

    cells = split_bounding_box(
        bounding_box
    )

    print(
        f"Geographic discovery grid: "
        f"{len(cells)} cells"
    )

    for cell_number, cell in enumerate(
        cells,
        start=1
    ):

        print(
            f"\n========== AREA CELL "
            f"{cell_number}/{len(cells)} =========="
        )

        # -------------------------------------------------
        # TAG DISCOVERY
        # -------------------------------------------------

        elements = query_overpass(
            cell,
            tag_queries
        )

        print(
            f"Tag discovery returned "
            f"{len(elements)} candidates."
        )

        all_elements.extend(
            elements
        )

        # -------------------------------------------------
        # NAME / DESCRIPTION DISCOVERY
        # -------------------------------------------------

        fallback_elements = (
            query_overpass_fallback(
                cell,
                industry
            )
        )

        print(
            f"Name/description discovery "
            f"returned "
            f"{len(fallback_elements)} "
            f"candidates."
        )

        all_elements.extend(
            fallback_elements
        )

        time.sleep(1)

    return deduplicate_raw_elements(
        all_elements
    )


# =========================================================
# MAIN DISCOVERY
# =========================================================

def discover_businesses(
    industry,
    locations,
):

    if isinstance(
        locations,
        str
    ):

        locations = split_locations(
            locations
        )

    if not locations:

        raise ValueError(
            "No discovery locations provided."
        )

    all_businesses = []

    total_raw = 0
    total_filtered = 0
    total_extraction_failures = 0

    filter_reasons = {}

    for location in locations:

        print(
            f"\nDiscovering "
            f"{industry} in {location}..."
        )

        try:

            bounding_box = geocode_location(
                location
            )

            # -------------------------------------------------
            # LARGE-SCALE RAW DISCOVERY
            # -------------------------------------------------

            elements = discover_raw_elements(
                bounding_box,
                industry
            )

            print(
                f"\nTotal unique raw OSM "
                f"candidates for {location}: "
                f"{len(elements)}"
            )

            total_raw += len(elements)

            # -------------------------------------------------
            # EXTRACTION
            # -------------------------------------------------

            extracted_businesses, failures = (
                inspect_raw_elements(
                    elements,
                    industry,
                    location
                )
            )

            total_extraction_failures += (
                failures
            )

            # -------------------------------------------------
            # FILTERING
            # -------------------------------------------------

            for business in extracted_businesses:

                passed, reason = filter_business(
                    business,
                    industry
                )

                if passed:

                    all_businesses.append(
                        business
                    )

                else:

                    total_filtered += 1

                    filter_reasons[reason] = (
                        filter_reasons.get(
                            reason,
                            0
                        ) + 1
                    )

        except Exception as error:

            print(
                f"Discovery failed for "
                f"{location}: {error}"
            )

        time.sleep(2)

    businesses = deduplicate_businesses(
        all_businesses
    )

    print(
        "\n========== DISCOVERY SUMMARY =========="
    )

    print(
        f"Raw OSM candidates: {total_raw}"
    )

    print(
        f"Extraction failures: "
        f"{total_extraction_failures}"
    )

    print(
        f"Filtered candidates: "
        f"{total_filtered}"
    )

    print(
        f"Qualified candidates: "
        f"{len(businesses)}"
    )

    if filter_reasons:

        print(
            "\nFILTER REASONS:"
        )

        for reason, count in sorted(
            filter_reasons.items(),
            key=lambda item: item[1],
            reverse=True,
        ):

            print(
                f"- {reason}: {count}"
            )

    print(
        "\nUnique businesses discovered: "
        f"{len(businesses)}"
    )

    return businesses


# =========================================================
# SETTINGS INTEGRATION
# =========================================================

def discover_from_settings(
    settings
):

    industry = (
        settings.get(
            "Industries"
        )
        or settings.get(
            "Industry"
        )
        or ""
    ).strip()

    locations_value = (
        settings.get(
            "Cities / Locations"
        )
        or settings.get(
            "Locations"
        )
        or ""
    )

    locations = split_locations(
        locations_value
    )

    if not industry:

        raise ValueError(
            "Settings is missing Industries."
        )

    if not locations:

        raise ValueError(
            "Settings is missing "
            "Cities / Locations."
        )

    return discover_businesses(
        industry,
        locations
    )