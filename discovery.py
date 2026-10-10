"""Official Creations Lead Automation: multi-query business discovery.

Uses OpenStreetMap/Overpass plus public Bing RSS search.
Search queries are prioritized using historical review outcomes.
No paid AI API is required.
"""
import html
import re
import time
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import urlparse

import requests

HEADERS = {
    "User-Agent": "OfficialCreationsLeadAutomation/1.0 (business discovery)"
}
REQUEST_TIMEOUT = 20
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
BING_RSS_URL = "https://www.bing.com/search"

INDUSTRY_ALIASES = {
    "interior designer": "Interior designers",
    "interior designers": "Interior designers",
    "interior design": "Interior designers",
    "wedding photographer": "Wedding & event photographers",
    "wedding photographers": "Wedding & event photographers",
    "event photographer": "Wedding & event photographers",
    "event photographers": "Wedding & event photographers",
    "photography studio": "Wedding & event photographers",
    "salon": "Boutique/women salon owners",
    "beauty salon": "Boutique/women salon owners",
    "boutique": "Boutique/women salon owners",
    "cloud kitchen": "Cloud kitchens run by homemakers",
    "cloud kitchens": "Cloud kitchens run by homemakers",
    "home bakery": "Cloud kitchens run by homemakers",
    "architect": "Freelance architects & small design firms",
    "architects": "Freelance architects & small design firms",
    "architecture": "Freelance architects & small design firms",
    "event decorator": "Event decorators",
    "event decorators": "Event decorators",
    "doctor": "Independent doctors/dentists/clinics",
    "dentist": "Independent doctors/dentists/clinics",
    "clinic": "Independent doctors/dentists/clinics",
    "real estate agent": "Real estate agents/brokers",
    "real estate broker": "Real estate agents/brokers",
    "driving school": "Driving schools",
    "ca firm": "CA firms & small legal practices",
    "chartered accountant": "CA firms & small legal practices",
    "law firm": "CA firms & small legal practices",
}

INDUSTRY_SEARCH_TERMS = {
    "Interior designers": [
        "interior designer", "interior design studio", "interior decorator",
        "home interior design", "residential interior designer",
        "commercial interior design", "modular kitchen designer",
        "interior design consultancy",
    ],
    "Wedding & event photographers": [
        "wedding photographer", "event photographer", "photography studio",
        "wedding photography studio", "pre wedding photographer",
        "candid wedding photographer", "event photography company",
    ],
    "Boutique/women salon owners": [
        "women salon", "beauty salon", "boutique", "ladies salon",
        "hair and beauty studio", "beauty parlour",
        "women's clothing boutique",
    ],
    "Cloud kitchens run by homemakers": [
        "cloud kitchen", "home bakery", "home food business", "home chef",
        "tiffin service", "cake studio", "home-based catering",
    ],
    "Freelance architects & small design firms": [
        "architect", "architecture studio", "design firm",
        "residential architect", "architectural consultancy",
        "independent architect", "small architecture firm",
    ],
    "Event decorators": [
        "event decorator", "wedding decorator", "event planner",
        "wedding stage decorator", "party decorator", "event design studio",
    ],
    "Independent doctors/dentists/clinics": [
        "independent clinic", "dentist", "doctor clinic", "dental clinic",
        "family clinic", "skin clinic", "physiotherapy clinic",
    ],
    "Real estate agents/brokers": [
        "real estate agent", "property broker", "real estate consultant",
        "independent property consultant", "real estate agency",
        "property dealer",
    ],
    "Driving schools": [
        "driving school", "driving institute", "motor driving school",
        "car driving classes", "driving training centre",
    ],
    "CA firms & small legal practices": [
        "chartered accountant", "CA firm", "law firm",
        "independent chartered accountant", "tax consultant",
        "small legal practice", "accounting firm",
    ],
}

BUYING_SIGNAL_TERMS = [
    "need a website", "website required", "looking for a website",
    "website developer", "website development", "recommend a web developer",
    "recommend a website designer", "website redesign", "redesign our website",
    "improve our website", "website not working", "poor website",
    "outdated website", "digital marketing", "social media management",
    "branding agency", "online presence",
]

INDUSTRY_OSM_FILTERS = {
    "Interior designers": [
        '["craft"="interior_decorator"]',
        '["office"="interior_design"]',
        '["shop"="interior_decoration"]',
    ],
    "Wedding & event photographers": [
        '["craft"="photographer"]',
        '["shop"="photo"]',
        '["office"="photographer"]',
    ],
    "Boutique/women salon owners": [
        '["shop"="beauty"]',
        '["shop"="hairdresser"]',
        '["shop"="clothes"]',
    ],
    "Cloud kitchens run by homemakers": [
        '["amenity"="fast_food"]',
        '["amenity"="restaurant"]',
        '["shop"="bakery"]',
    ],
    "Freelance architects & small design firms": [
        '["office"="architect"]',
        '["craft"="architect"]',
    ],
    "Event decorators": [
        '["office"="event_management"]',
        '["craft"="event_decorator"]',
    ],
    "Independent doctors/dentists/clinics": [
        '["amenity"="doctors"]',
        '["amenity"="dentist"]',
        '["healthcare"="clinic"]',
    ],
    "Real estate agents/brokers": [
        '["office"="estate_agent"]',
    ],
    "Driving schools": [
        '["amenity"="driving_school"]',
    ],
    "CA firms & small legal practices": [
        '["office"="accountant"]',
        '["office"="lawyer"]',
    ],
}

NON_BUSINESS_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com", "youtube.com",
    "wikipedia.org", "reddit.com", "pinterest.com", "x.com",
    "twitter.com", "justdial.com", "sulekha.com", "indiamart.com",
    "tradeindia.com", "yelp.com", "tripadvisor.com",
}

GENERIC_TITLE_TERMS = (
    "top 10", "best of", "list of", "directory", "near me",
    "how to", "what is", "ideas for", "examples of", "guide to",
    "jobs in", "salary of", "course for", "meaning of",
)


def _text(value: Any) -> str:
    return html.unescape(str(value or "")).strip()


def _normalise(value: Any) -> str:
    return re.sub(r"\s+", " ", _text(value)).strip().lower()


def _as_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    if not _text(value):
        return []
    return [
        item.strip()
        for item in re.split(r"[,;\n]+", _text(value))
        if item.strip()
    ]


def _normalise_key(value: Any) -> str:
    """Normalise a Settings label for comparison.

    Lowercases and strips every non-alphanumeric character (spaces,
    slashes, underscores, hyphens, punctuation) so that label variants
    such as "Cities / Locations", "Cities/Locations", "cities_locations"
    and "CITIES-LOCATIONS" all compare equal. This matches the same
    approach already used in qualification.py's _setting().
    """
    return re.sub(r"[^a-z0-9]", "", _normalise(value))


def _setting(settings: dict, *names: str, default=None):
    settings = settings or {}
    normalised = {
        _normalise_key(key): value
        for key, value in settings.items()
    }
    for name in names:
        key = _normalise_key(name)
        if key in normalised and _text(normalised[key]):
            return normalised[key]
    return default


def _locations_from_settings(settings: dict) -> list[str]:
    value = _setting(
        settings, "Cities/Locations", "Locations", "Cities",
        "Target Locations", default=""
    )
    return _as_list(value)


def _industries_from_settings(settings: dict) -> list[str]:
    value = _setting(
        settings, "Industries", "Target Industries",
        "Industry", default=""
    )
    return [canonical_industry(item) for item in _as_list(value)]


def _phone(value: Any) -> str:
    digits = re.sub(r"\D", "", _text(value))
    if len(digits) < 7:
        return ""
    return digits


def canonical_industry(industry: str) -> str:
    original = _text(industry)
    key = _normalise(original)
    if key in INDUSTRY_ALIASES:
        return INDUSTRY_ALIASES[key]

    for known in INDUSTRY_SEARCH_TERMS:
        if key == _normalise(known):
            return known

    return original


def find_industry_tags(industry: str) -> list[str]:
    canonical = canonical_industry(industry)
    return INDUSTRY_SEARCH_TERMS.get(
        canonical, [canonical] if canonical else []
    )


def generate_search_queries(
    industry: str,
    location: str,
    settings: dict | None = None,
    max_queries: int | None = None,
    learning_records: list[dict] | None = None,
) -> list[str]:
    """Generate location-specific queries and rank using review history."""
    settings = settings or {}
    canonical = canonical_industry(industry)
    terms = INDUSTRY_SEARCH_TERMS.get(
        canonical, [canonical] if canonical else []
    )

    if not terms or not _text(location):
        return []

    configured_limit = _setting(
        settings, "Max Search Queries", "Search Query Limit",
        "Queries Per Industry Location", default=8
    )

    try:
        configured_limit = int(configured_limit)
    except (TypeError, ValueError):
        configured_limit = 8

    limit = max(
        1,
        min(
            int(max_queries if max_queries is not None else configured_limit),
            30,
        ),
    )

    patterns = [
        lambda term: f'"{term}" "{location}"',
        lambda term: f"{term} in {location} India contact",
        lambda term: f"{term} studio {location}",
        lambda term: f"independent {term} {location}",
        lambda term: f"small {term} firm {location}",
        lambda term: f"{term} near {location} phone",
        lambda term: f"{term} {location} official website",
        lambda term: f"{term} {location} Instagram",
        lambda term: f"{term} projects portfolio {location}",
        lambda term: f"{term} {location} owner contact",
        lambda term: f"{term} {location} recently opened",
        lambda term: f"{term} {location} business profile",
    ]

    queries = []
    seen = set()

    for pattern in patterns:
        for term in terms:
            query = _text(pattern(term))
            if query.lower() not in seen:
                seen.add(query.lower())
                queries.append(query)
            if len(queries) >= limit:
                break
        if len(queries) >= limit:
            break

    # Only explicit approved/rejected outcomes influence query ordering.
    outcomes = {}

    for record in learning_records or []:
        query = _normalise(record.get("Search Query"))
        outcome = _normalise(record.get("Review Outcome"))

        if not query:
            continue

        if outcome in {"approved", "approve", "accepted"}:
            outcomes.setdefault(query, [0, 0])[0] += 1
        elif outcome in {
            "rejected", "rejected after call", "not a fit", "irrelevant"
        }:
            outcomes.setdefault(query, [0, 0])[1] += 1

    original_order = {
        query: index for index, query in enumerate(queries)
    }

    def query_rank(query):
        approved, rejected = outcomes.get(
            _normalise(query), [0, 0]
        )
        # Smoothing prevents one decision from dominating the system.
        rate = (approved + 1) / (approved + rejected + 2)
        evidence_bonus = min(approved + rejected, 5) * 0.001
        return rate + evidence_bonus, -original_order[query]

    queries.sort(key=query_rank, reverse=True)
    return queries


def geocode_location(location: str) -> tuple[float, float] | None:
    if not _text(location):
        return None

    try:
        response = requests.get(
            NOMINATIM_URL,
            params={
                "q": _text(location),
                "format": "jsonv2",
                "limit": 1,
                "countrycodes": "in",
            },
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()

        if not data:
            return None

        return float(data[0]["lat"]), float(data[0]["lon"])

    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        print(f"[Discovery] Geocoding failed for {location}: {exc}")
        return None


def query_overpass(query: str) -> dict:
    response = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers=HEADERS,
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def query_overpass_fallback(query: str) -> dict:
    last_error = None

    for endpoint in [OVERPASS_URL, *OVERPASS_FALLBACK_URLS]:
        try:
            response = requests.post(
                endpoint,
                data={"data": query},
                headers=HEADERS,
                timeout=60,
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_error = exc
            time.sleep(0.5)

    raise RuntimeError(f"All Overpass endpoints failed: {last_error}")


def _get_tag(tags: dict, *keys: str) -> str:
    for key in keys:
        value = _text(tags.get(key))
        if value:
            return value
    return ""


def _industry_overpass_filters(industry: str) -> str:
    filters = INDUSTRY_OSM_FILTERS.get(canonical_industry(industry), [])
    return "\n".join(filters)


def _industry_evidence(tags: dict, industry: str) -> tuple[bool, str]:
    canonical = canonical_industry(industry)
    terms = INDUSTRY_SEARCH_TERMS.get(canonical, [])
    values = " ".join(
        _text(value).lower()
        for key, value in tags.items()
        if key not in {"name", "brand", "operator", "addr:street"}
    )

    if not terms:
        return False, "No configured industry vocabulary"

    matched = [
        term for term in terms
        if term.lower() in values
    ]

    if matched:
        return True, "Matched OSM tags: " + ", ".join(matched[:3])

    # OSM category matching is not sufficient to prove a business is a fit.
    return False, "Industry needs manual verification"


def extract_business(
    element: dict,
    industry: str,
    location: str,
) -> dict | None:
    tags = element.get("tags", {}) or {}
    name = _get_tag(tags, "name", "brand", "operator")

    if not name or len(name) < 2:
        return None

    phone = _phone(_get_tag(tags, "contact:phone", "phone", "mobile"))
    instagram = _get_tag(
        tags, "contact:instagram", "instagram"
    ).lstrip("@")
    website = _get_tag(tags, "contact:website", "website", "url")
    email = _get_tag(tags, "contact:email", "email")

    osm_type = _text(element.get("type"))
    osm_id = _text(element.get("id"))
    osm_tags = {
        str(key): str(value)
        for key, value in tags.items()
    }

    verified, evidence = _industry_evidence(tags, industry)

    business_type = _get_tag(
        tags, "shop", "office", "craft", "amenity",
        "healthcare", "tourism", "leisure"
    )

    lat = element.get("lat")
    lon = element.get("lon")

    if not lat or not lon:
        center = element.get("center", {}) or {}
        lat = center.get("lat", "")
        lon = center.get("lon", "")

    address_parts = [
        _get_tag(tags, "addr:housenumber"),
        _get_tag(tags, "addr:street"),
        _get_tag(tags, "addr:suburb"),
        _get_tag(tags, "addr:city"),
    ]
    address = ", ".join(part for part in address_parts if part)

    return {
        "Business Name": name,
        "Industry": canonical_industry(industry),
        "Location": location,
        "Phone": phone,
        "Instagram ID": instagram,
        "Website": website,
        "Email": email,
        "Address": address or location,
        "Lead Source": "OpenStreetMap",
        "Search Query": "",
        "Business Type": business_type,
        "Opportunity": "",
        "Buying Signal": "",
        "Evidence": evidence,
        "Source URL": (
            f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
            if osm_type and osm_id else ""
        ),
        "OSM Type": osm_type,
        "OSM ID": osm_id,
        "OSM Tags": osm_tags,
        "Industry Verified": verified,
        "Needs Manual Review": not verified,
        "Latitude": lat or "",
        "Longitude": lon or "",
    }


def discover_osm_businesses(
    industry: str,
    location: str,
    radius_m: int = 20000,
) -> list[dict]:
    coordinates = geocode_location(location)

    if not coordinates:
        print(f"[Discovery] Could not geocode location: {location}")
        return []

    lat, lon = coordinates
    radius_m = max(1000, min(int(radius_m), 50000))
    filters = INDUSTRY_OSM_FILTERS.get(
        canonical_industry(industry), []
    )

    if not filters:
        return []

    selector_blocks = []

    for tag_filter in filters:
        selector_blocks.extend([
            f'node(around:{radius_m},{lat},{lon}){tag_filter};',
            f'way(around:{radius_m},{lat},{lon}){tag_filter};',
            f'relation(around:{radius_m},{lat},{lon}){tag_filter};',
        ])

    query = (
        "[out:json][timeout:45];\n("
        + "\n".join(selector_blocks)
        + "\n);\nout center tags;"
    )

    try:
        data = query_overpass_fallback(query)
    except Exception as exc:
        print(
            f"[Discovery] Overpass query failed for "
            f"{industry} in {location}: {exc}"
        )
        return []

    output = []

    for element in data.get("elements", []):
        candidate = extract_business(element, industry, location)
        if candidate:
            output.append(candidate)

    return output


def _domain(url: str) -> str:
    try:
        host = (urlparse(url).hostname or "").lower()
        return host.removeprefix("www.")
    except ValueError:
        return ""


def _search_web(query: str, limit: int = 8) -> list[dict]:
    try:
        response = requests.get(
            BING_RSS_URL,
            params={"q": query, "format": "rss"},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        root = ET.fromstring(response.text)

    except (requests.RequestException, ET.ParseError) as exc:
        print(f"[Discovery] Web search failed for {query}: {exc}")
        return []

    results = []

    for item in root.findall(".//item")[:max(1, min(limit, 10))]:
        title = _text(item.findtext("title"))
        url = _text(item.findtext("link"))
        description = _text(item.findtext("description"))

        if not title or not url:
            continue

        results.append({
            "title": title,
            "url": url,
            "description": description,
            "query": query,
        })

    return results


def _is_directory_or_generic(title: str, url: str) -> bool:
    domain = _domain(url)
    title_lower = _normalise(title)

    if not domain:
        return True

    if any(
        domain == blocked or domain.endswith("." + blocked)
        for blocked in NON_BUSINESS_DOMAINS
    ):
        return True

    if any(term in title_lower for term in GENERIC_TITLE_TERMS):
        return True

    return False


def _business_name_from_title(title: str) -> str:
    name = re.split(
        r"\s(?:\||–|—|-)\s|:\s",
        _text(title),
        maxsplit=1,
    )[0]
    return name.strip(" -|–—:·")


def _fetch_page_contacts(url: str) -> dict:
    data = {
        "Phone": "",
        "Instagram ID": "",
        "Email": "",
        "Website": url,
    }

    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )

        if response.status_code >= 400:
            return data

        page = response.text[:1_000_000]

    except requests.RequestException:
        return data

    emails = re.findall(
        r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}",
        page,
        flags=re.I,
    )

    if emails:
        data["Email"] = emails[0].strip()

    phones = re.findall(
        r"(?:tel:|telephone[\"']?\s*[:=]\s*[\"']?)"
        r"(\+?[\d][\d\s().-]{6,}\d)",
        page,
        flags=re.I,
    )

    for phone in phones:
        if _phone(phone):
            data["Phone"] = _phone(phone)
            break

    handles = re.findall(
        r"https?://(?:www\.)?instagram\.com/"
        r"([A-Za-z0-9._]+)/?",
        page,
        flags=re.I,
    )

    if handles and handles[0].lower() not in {
        "p", "reel", "reels", "stories", "explore"
    }:
        data["Instagram ID"] = handles[0].strip(".")

    return data


def _web_result_to_candidate(
    result: dict,
    industry: str,
    location: str,
    enrich: bool = True,
) -> dict | None:
    title = _text(result.get("title"))
    url = _text(result.get("url"))
    description = _text(result.get("description"))

    if _is_directory_or_generic(title, url):
        return None

    name = _business_name_from_title(title)

    if len(name) < 3 or len(name) > 100:
        return None

    if any(
        term in name.lower()
        for term in (
            "search results", "official website", "contact us",
            "business directory", "company profile", "services in",
        )
    ):
        return None

    if not _domain(url) or "." not in _domain(url):
        return None

    contact = (
        _fetch_page_contacts(url)
        if enrich
        else {
            "Phone": "",
            "Instagram ID": "",
            "Email": "",
            "Website": url,
        }
    )

    evidence = (
        f"Search title: {title}. Description: {description}. "
        f"URL: {url}. Query: {result.get('query', '')}"
    )[:2000]

    return {
        "Business Name": name,
        "Industry": canonical_industry(industry),
        "Location": _text(location),
        "Phone": contact["Phone"],
        "Instagram ID": contact["Instagram ID"],
        "Website": contact["Website"],
        "Email": contact["Email"],
        "Address": _text(location),
        "Lead Source": "Public web search",
        "Search Query": _text(result.get("query", "")),
        "Business Type": "",
        "Opportunity": "",
        "Buying Signal": "",
        "Evidence": evidence,
        "Source URL": url,
        "OSM Type": "",
        "OSM ID": "",
        "OSM Tags": {},
        "Industry Verified": False,
        "Needs Manual Review": True,
    }


def discover_buying_signals(
    industry: str,
    locations: list[str],
    settings: dict | None = None,
) -> list[dict]:
    """Return research-only signal snippets, not verified business leads."""
    settings = settings or {}
    canonical = canonical_industry(industry)

    days = _setting(
        settings, "Buying Signal Window",
        "Buying Signal Recency", "Signal Window Days", default=14
    )

    try:
        days = max(1, min(int(days), 365))
    except (TypeError, ValueError):
        days = 14

    max_queries = _setting(
        settings, "Max Buying Signal Queries", default=6
    )

    try:
        max_queries = max(1, min(int(max_queries), 20))
    except (TypeError, ValueError):
        max_queries = 6

    signals = [
        '"need a website"', '"website redesign"',
        '"website developer"', '"digital marketing"',
        '"social media management"',
    ]

    terms = INDUSTRY_SEARCH_TERMS.get(canonical, [canonical])
    queries = []

    for location in _as_list(locations):
        for term in terms[:3]:
            for signal in signals:
                queries.append(
                    f'{signal} "{term}" "{location}" India'
                )
                if len(queries) >= max_queries:
                    break
            if len(queries) >= max_queries:
                break
        if len(queries) >= max_queries:
            break

    output = []

    for query in queries:
        for result in _search_web(query, limit=8):
            evidence = (
                f"{result['title']} {result['description']}"
            ).strip()

            if not any(
                term in evidence.lower()
                for term in BUYING_SIGNAL_TERMS
            ):
                continue

            output.append({
                "Business Name": "",
                "Search Result Title": result["title"],
                "Industry": canonical,
                "Location": "",
                "Phone": "",
                "Instagram ID": "",
                "Website": "",
                "Email": "",
                "Address": "",
                "Lead Source": "Public web search",
                "Opportunity": (
                    "Potential buying signal; verify the business manually"
                ),
                "Buying Signal": evidence[:1500],
                "Evidence": (
                    f"{result['url']}\n{evidence}"
                )[:2000],
                "Source URL": result["url"],
                "Signal Window Days": days,
                "Needs Review": True,
                "Needs Manual Review": True,
                "Industry Verified": False,
                "OSM Type": "",
                "OSM ID": "",
                "OSM Tags": {},
            })

        time.sleep(0.25)

    return output


def _candidate_key(candidate: dict) -> str:
    phone = re.sub(r"\D", "", _text(candidate.get("Phone")))
    instagram = _normalise(
        candidate.get("Instagram ID")
    ).lstrip("@")
    name = _normalise(candidate.get("Business Name"))
    location = _normalise(candidate.get("Location"))
    website = _normalise(candidate.get("Website")).rstrip("/")

    if len(phone) >= 7:
        return f"phone:{phone}"
    if instagram:
        return f"instagram:{instagram}"
    if website:
        return f"website:{website}"

    return f"name:{name}|location:{location}"


def _merge_candidates(candidates: list[dict]) -> list[dict]:
    merged = {}

    for candidate in candidates:
        if (
            not isinstance(candidate, dict)
            or not _text(candidate.get("Business Name"))
        ):
            continue

        key = _candidate_key(candidate)

        if key not in merged:
            merged[key] = dict(candidate)
            source = _text(candidate.get("Lead Source"))
            merged[key]["Discovery Sources"] = (
                [source] if source else []
            )
            continue

        existing = merged[key]

        for field in (
            "Phone", "Instagram ID", "Industry", "Location",
            "Website", "Email", "Address", "OSM ID", "OSM Type",
            "OSM Tags", "Source URL", "Search Query", "Business Type",
        ):
            if not existing.get(field) and candidate.get(field):
                existing[field] = candidate[field]

        for field in ("Opportunity", "Buying Signal", "Evidence"):
            new_value = _text(candidate.get(field))
            old_value = _text(existing.get(field))

            if new_value and new_value not in old_value:
                existing[field] = (
                    f"{old_value} | {new_value}"
                    if old_value else new_value
                )

        source = _text(candidate.get("Lead Source"))

        if source and source not in existing["Discovery Sources"]:
            existing["Discovery Sources"].append(source)

        existing["Lead Source"] = ", ".join(
            existing["Discovery Sources"]
        )

        existing["Needs Manual Review"] = (
            bool(existing.get("Needs Manual Review"))
            or bool(candidate.get("Needs Manual Review"))
        )

        existing["Industry Verified"] = (
            bool(existing.get("Industry Verified"))
            or bool(candidate.get("Industry Verified"))
        )

    return list(merged.values())


def discover_businesses(
    industry: str,
    locations: list[str] | str,
    settings: dict | None = None,
    learning_records: list[dict] | None = None,
) -> list[dict]:
    """Combine structured OSM results with ranked web searches."""
    settings = settings or {}
    canonical = canonical_industry(industry)
    location_list = _as_list(locations)
    candidates = []

    try:
        radius = max(
            1000,
            min(
                int(
                    _setting(
                        settings, "Discovery Radius",
                        "Search Radius Metres", "Radius Metres",
                        default=20000,
                    )
                ),
                50000,
            ),
        )
    except (TypeError, ValueError):
        radius = 20000

    for location in location_list:
        try:
            candidates.extend(
                discover_osm_businesses(canonical, location, radius)
            )
        except Exception as exc:
            print(
                f"[Discovery] OSM error for "
                f"{canonical} in {location}: {exc}"
            )

    query_limit = _setting(
        settings, "Max Search Queries", "Search Query Limit",
        "Queries Per Industry Location", default=8
    )

    try:
        query_limit = max(1, min(int(query_limit), 30))
    except (TypeError, ValueError):
        query_limit = 8

    results_limit = _setting(
        settings, "Results Per Search Query", default=8
    )

    try:
        results_limit = max(1, min(int(results_limit), 10))
    except (TypeError, ValueError):
        results_limit = 8

    enrich = _setting(
        settings, "Enrich Web Results", default=True
    )

    if isinstance(enrich, str):
        enrich = enrich.strip().lower() not in {
            "false", "no", "0", "off"
        }

    for location in location_list:
        queries = generate_search_queries(
            canonical,
            location,
            settings,
            max_queries=query_limit,
            learning_records=learning_records,
        )

        print(
            f"[Discovery] Planned {len(queries)} dynamic web queries "
            f"for {canonical} in {location}"
        )

        seen_urls = set()

        for query in queries:
            for result in _search_web(query, limit=results_limit):
                url_key = _normalise(
                    result.get("url")
                ).rstrip("/")

                if not url_key or url_key in seen_urls:
                    continue

                seen_urls.add(url_key)

                candidate = _web_result_to_candidate(
                    result,
                    canonical,
                    location,
                    enrich=bool(enrich),
                )

                if candidate:
                    candidates.append(candidate)

            time.sleep(0.25)

    merged = _merge_candidates(candidates)

    print(
        f"[Discovery] Total unique named candidates for {canonical}: "
        f"{len(merged)} (OSM + web; manual verification required)"
    )

    return merged


def discover_from_settings(
    settings: dict,
    learning_records: list[dict] | None = None,
) -> list[dict]:
    industries = _industries_from_settings(settings)
    locations = _locations_from_settings(settings)

    if not industries or not locations:
        print(
            "[Discovery] Settings must include industries and locations."
        )
        return []

    candidates = []

    for industry in industries:
        try:
            candidates.extend(
                discover_businesses(
                    industry,
                    locations,
                    settings,
                    learning_records=learning_records,
                )
            )
        except Exception as exc:
            print(f"[Discovery] Failed for {industry}: {exc}")

    return _merge_candidates(candidates)