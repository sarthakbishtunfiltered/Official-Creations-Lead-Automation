import os
import re
import json
import time
import hashlib
import logging
import requests
import xml.etree.ElementTree as ET

from urllib.parse import (
    urlparse,
    quote_plus,
    unquote,
)

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 15
MAX_QUERIES_PER_INDUSTRY_LOCATION = 8
MAX_RESULTS_PER_QUERY = 20

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
    )
}

# OSM/Nominatim ask for a real, descriptive User-Agent rather than a
# browser impersonation, so these use their own headers.
OSM_HEADERS = {
    "User-Agent": "OfficialCreationsLeadAutomation/1.0 (business discovery)"
}

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Keyword-matched rather than an exact-name table, so a Settings value
# like "Interior Designer" still matches without needing a canonical
# industry name to be configured first.
INDUSTRY_OSM_KEYWORDS = [
    (
        ("interior",),
        [
            '["craft"="interior_decorator"]',
            '["office"="interior_design"]',
            '["shop"="interior_decoration"]',
        ],
    ),
    (
        ("photograph",),
        [
            '["craft"="photographer"]',
            '["shop"="photo"]',
            '["office"="photographer"]',
        ],
    ),
    (
        ("salon", "boutique", "beauty"),
        [
            '["shop"="beauty"]',
            '["shop"="hairdresser"]',
            '["shop"="clothes"]',
        ],
    ),
    (
        ("cloud kitchen", "bakery", "home chef", "tiffin"),
        [
            '["amenity"="fast_food"]',
            '["amenity"="restaurant"]',
            '["shop"="bakery"]',
        ],
    ),
    (
        ("architect",),
        ['["office"="architect"]', '["craft"="architect"]'],
    ),
    (
        ("decorator", "event"),
        [
            '["office"="event_management"]',
            '["craft"="event_decorator"]',
        ],
    ),
    (
        ("doctor", "dentist", "clinic"),
        [
            '["amenity"="doctors"]',
            '["amenity"="dentist"]',
            '["healthcare"="clinic"]',
        ],
    ),
    (
        ("real estate", "broker", "property"),
        ['["office"="estate_agent"]'],
    ),
    (
        ("driving school",),
        ['["amenity"="driving_school"]'],
    ),
    (
        ("chartered accountant", "ca firm", "law firm", "legal"),
        ['["office"="accountant"]', '["office"="lawyer"]'],
    ),
]

SOCIAL_HOSTS = {
    "instagram.com",
    "www.instagram.com",
    "facebook.com",
    "www.facebook.com",
    "linkedin.com",
    "www.linkedin.com",
    "youtube.com",
    "www.youtube.com",
    "tiktok.com",
    "www.tiktok.com",
    "x.com",
    "www.x.com",
    "twitter.com",
    "www.twitter.com",
}

DIRECTORY_HOSTS = {
    "justdial.com",
    "www.justdial.com",
    "sulekha.com",
    "www.sulekha.com",
    "indiamart.com",
    "www.indiamart.com",
    "tradeindia.com",
    "www.tradeindia.com",
    "magicbricks.com",
    "www.magicbricks.com",
    "99acres.com",
    "www.99acres.com",
    "yelp.com",
    "www.yelp.com",
    "google.com",
    "www.google.com",
    "bing.com",
    "www.bing.com",
    "mapquest.com",
    "www.mapquest.com",
    # Large aggregator/marketplace platforms. These are real companies
    # with real websites, so qualification correctly rejects them as
    # "has a website" -- but they dominate Bing's organic results for
    # "<industry> <location>"-style queries and crowd out the small
    # independent businesses this project is actually looking for, so
    # they are excluded at discovery time rather than relying on
    # qualification to filter every one of them out individually.
    "livspace.com",
    "www.livspace.com",
    "homelane.com",
    "www.homelane.com",
    "designcafe.com",
    "www.designcafe.com",
    "bonitodesigns.in",
    "www.bonitodesigns.in",
    "houzz.com",
    "www.houzz.com",
    "houzz.in",
    "www.houzz.in",
    "urbancompany.com",
    "www.urbancompany.com",
    "urbanclap.com",
    "www.urbanclap.com",
    "weddingwire.in",
    "www.weddingwire.in",
    "weddingwire.com",
    "www.weddingwire.com",
    "wedmegood.com",
    "www.wedmegood.com",
    "weddingz.in",
    "www.weddingz.in",
    "shaadisaga.com",
    "www.shaadisaga.com",
    "hometriangle.com",
    "www.hometriangle.com",
    "urbanpro.com",
    "www.urbanpro.com",
    "practo.com",
    "www.practo.com",
    "nobroker.in",
    "www.nobroker.in",
    "housejoy.in",
    "www.housejoy.in",
    # Generic reference/informational sites -- never a business listing.
    "wikipedia.org",
    "quora.com",
    "www.quora.com",
    "reddit.com",
    "www.reddit.com",
    "pinterest.com",
    "www.pinterest.com",
    "weddingbazaar.com",
    "www.weddingbazaar.com",
}

GENERIC_NAMES = {
    "",
    "home",
    "homepage",
    "search",
    "results",
    "instagram",
    "facebook",
    "business",
    "website",
    "click here",
    "read more",
    "official website",
}

GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]


def _text(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def _normalise(value):
    return _text(value).lower()


def _as_list(value):
    if value is None:
        return []

    if isinstance(value, (list, tuple, set)):
        return [_text(item) for item in value if _text(item)]

    return [
        item.strip()
        for item in re.split(r"[,;\n]", str(value))
        if item.strip()
    ]


def _setting(settings, *names, default=""):
    if not isinstance(settings, dict):
        return default

    normalised = {
        _normalise(key): value
        for key, value in settings.items()
    }

    for name in names:
        key = _normalise(name)
        if key in normalised:
            return normalised[key]

    return default


def _industries_from_settings(settings):
    return _as_list(
        _setting(
            settings,
            "Industries",
            "Selected Industries",
            "Industry",
            default="",
        )
    )


def _locations_from_settings(settings):
    return _as_list(
        _setting(
            settings,
            "Cities / Locations",
            "Locations",
            "Selected Locations",
            "Cities",
            default="",
        )
    )


def _phone(value):
    digits = re.sub(r"\D", "", _text(value))

    if len(digits) < 10:
        return ""

    if len(digits) > 13:
        return ""

    return digits


def _extract_phones(text):
    if not text:
        return []

    patterns = [
        r"(?:\+?91[\s.-]?)?[6-9]\d{9}",
        r"\+?\d[\d\s().-]{8,16}\d",
    ]

    found = []
    seen = set()

    for pattern in patterns:
        for match in re.findall(pattern, text):
            number = _phone(match)

            if number and number not in seen:
                seen.add(number)
                found.append(number)

    return found


def _canonical_url(url):
    url = unquote(_text(url))

    if not url:
        return ""

    if url.startswith("//"):
        url = "https:" + url

    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url

    try:
        parsed = urlparse(url)

        if not parsed.hostname:
            return ""

        if parsed.scheme not in {"http", "https"}:
            return ""

        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")

    except Exception:
        return ""


def _host(url):
    try:
        return (urlparse(_canonical_url(url)).hostname or "").lower()
    except Exception:
        return ""


def _is_social_url(url):
    hostname = _host(url)

    return (
        hostname in SOCIAL_HOSTS
        or any(
            hostname.endswith("." + host)
            for host in SOCIAL_HOSTS
        )
    )


def _is_directory_url(url):
    hostname = _host(url)

    return (
        hostname in DIRECTORY_HOSTS
        or any(
            hostname.endswith("." + host)
            for host in DIRECTORY_HOSTS
        )
    )


def _is_official_website_url(url):
    if not url:
        return False

    hostname = _host(url)

    if not hostname:
        return False

    if _is_social_url(url) or _is_directory_url(url):
        return False

    if hostname.endswith(".gov.in") or hostname.endswith(".nic.in"):
        return True

    return "." in hostname


def _stable_id(*parts):
    raw = "|".join(_normalise(part) for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _get(url, params=None):
    try:
        response = requests.get(
            url,
            params=params,
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )

        if response.status_code >= 400:
            return None

        return response

    except requests.RequestException as exc:
        logger.debug("Request failed for %s: %s", url, exc)
        return None


def _bing_search(query, limit=MAX_RESULTS_PER_QUERY):
    """
    Fetch public Bing RSS search results.

    This does not use the Google Maps API.
    Search results may be incomplete or rate-limited.
    """
    response = _get(
        "https://www.bing.com/search",
        params={
            "q": query,
            "format": "rss",
            "count": min(limit, 50),
        },
    )

    if response is None:
        response = _get(
            "https://www.bing.com/search",
            params={
                "q": query,
                "format": "rss",
            },
        )

    if response is None:
        return []

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError:
        return []

    results = []

    for item in root.findall(".//item"):
        title = _text(item.findtext("title"))
        link = _text(item.findtext("link"))
        description = _text(item.findtext("description"))
        pub_date = _text(item.findtext("pubDate"))

        if not title or not link:
            continue

        results.append({
            "title": title,
            "url": _canonical_url(link),
            "snippet": description,
            "date": pub_date,
            "query": query,
        })

    return results[:limit]


def _gemini_api_key(settings):
    return (
        _text(os.getenv("GEMINI_API_KEY"))
        or _text(_setting(settings, "Gemini API Key", default=""))
    )


def _extract_json_array(text):
    text = _text(text)

    text = re.sub(
        r"^```(?:json)?\s*|\s*```$",
        "",
        text,
        flags=re.I,
    )

    try:
        parsed = json.loads(text)

        if isinstance(parsed, list):
            return parsed

        if isinstance(parsed, dict):
            for key in ("queries", "search_queries", "results"):
                value = parsed.get(key)

                if isinstance(value, list):
                    return value

    except json.JSONDecodeError:
        pass

    match = re.search(r"\[[\s\S]*\]", text)

    if match:
        try:
            parsed = json.loads(match.group(0))

            if isinstance(parsed, list):
                return parsed

        except json.JSONDecodeError:
            pass

    return []


def _generate_gemini_queries(
    industry,
    location,
    learning_records=None,
    api_key="",
):
    """
    Use Gemini only for search-query generation.

    Gemini does not decide whether an individual business qualifies.
    """
    learning_records = learning_records or []

    positive_queries = []
    negative_queries = []

    for record in learning_records:
        if not isinstance(record, dict):
            continue

        query = _text(record.get("Search Query", ""))
        outcome = _normalise(record.get("Review Outcome", ""))
        quality = _normalise(record.get("Outcome Quality", ""))

        if not query:
            continue

        if (
            outcome in {"approved", "qualified", "positive"}
            or quality in {"good", "positive", "high"}
        ):
            positive_queries.append(query)

        elif (
            outcome in {"rejected", "negative"}
            or quality in {"bad", "negative", "low"}
        ):
            negative_queries.append(query)

    positive_queries = list(dict.fromkeys(positive_queries))[-12:]
    negative_queries = list(dict.fromkeys(negative_queries))[-8:]

    prompt = {
        "task": (
            "Generate useful public web search queries to discover real "
            "small, independent businesses matching the supplied industry "
            "and location. Return only a JSON array of query strings. "
            "Do not classify businesses, infer facts, or invent businesses."
        ),
        "industry": industry,
        "location": location,
        "positive_historical_queries": positive_queries,
        "negative_historical_queries": negative_queries,
        "requirements": [
            "Use the exact supplied industry and location.",
            "Explore different natural search formulations.",
            "Include queries that may reveal Instagram business profiles.",
            "Do not assume the business has or lacks a website.",
            "Avoid repeating historical queries unnecessarily.",
            "Return no more than 8 concise queries.",
        ],
    }

    for model in GEMINI_MODELS:
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )

        try:
            response = requests.post(
                endpoint,
                params={"key": api_key},
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": HEADERS["User-Agent"],
                },
                json={
                    "contents": [{
                        "parts": [{
                            "text": json.dumps(prompt, ensure_ascii=False)
                        }]
                    }],
                    "generationConfig": {
                        "temperature": 0.4,
                        "responseMimeType": "application/json",
                    },
                },
                timeout=REQUEST_TIMEOUT,
            )

            if response.status_code in {400, 404}:
                continue

            response.raise_for_status()

            payload = response.json()

            candidates = payload.get("candidates", [])

            if not candidates:
                continue

            parts = (
                candidates[0]
                .get("content", {})
                .get("parts", [])
            )

            generated_text = "\n".join(
                _text(part.get("text", ""))
                for part in parts
                if isinstance(part, dict)
            )

            queries = _extract_json_array(generated_text)

            cleaned = []

            for item in queries:
                if isinstance(item, dict):
                    item = item.get("query", "")

                query = _text(item)

                if query and query not in cleaned:
                    cleaned.append(query)

            if cleaned:
                return cleaned[:MAX_QUERIES_PER_INDUSTRY_LOCATION]

        except (
            requests.RequestException,
            ValueError,
            KeyError,
            TypeError,
        ) as exc:
            logger.warning(
                "Gemini query generation failed for %s: %s",
                model,
                exc,
            )

    return []


def _fallback_queries(industry, location, learning_records=None):
    """
    Free fallback used when Gemini is not configured or unavailable.
    No industry-specific or location-specific dictionary is required.

    A broad, varied pool (not just a handful of templates) so repeated
    discovery rounds for the same industry/location see genuinely
    different search text instead of exhausting a tiny pool after one
    round and silently falling back to re-searching the same queries
    (see the "if not fresh" guard in generate_search_queries).
    """
    industry = _text(industry)
    location = _text(location)

    queries = [
        f'"{industry}" "{location}" business',
        f'"{industry}" "{location}" contact',
        f'"{industry}" "{location}" phone number',
        f'"{industry}" "{location}" Instagram',
        f'site:instagram.com "{industry}" "{location}"',
        f'"{industry}" "{location}" portfolio',
        f'"{industry}" "{location}" owner',
        f'independent "{industry}" "{location}"',
        f'small "{industry}" firm "{location}"',
        f'"{industry}" near "{location}"',
        f'"{industry}" "{location}" WhatsApp',
        f'"{industry}" "{location}" reviews',
        f'"{industry}" "{location}" recently started',
        f'"{industry}" "{location}" home based',
        f'"{industry}" "{location}" studio',
        f'freelance "{industry}" "{location}"',
        f'"{industry}" "{location}" new business',
        f'"{industry}" "{location}" booking',
        f'"{industry}" "{location}" address',
        f'best "{industry}" "{location}"',
        f'affordable "{industry}" "{location}"',
        f'experienced "{industry}" "{location}"',
        f'"{industry}" "{location}" testimonials',
        f'"{industry}" "{location}" price',
    ]

    for record in learning_records or []:
        if not isinstance(record, dict):
            continue

        if (
            _normalise(record.get("Industry", "")) == _normalise(industry)
            and _normalise(record.get("Location", "")) == _normalise(location)
        ):
            historical_query = _text(record.get("Search Query", ""))

            if historical_query:
                queries.append(historical_query)

    unique = []
    seen = set()

    for query in queries:
        key = _normalise(query)

        if key and key not in seen:
            seen.add(key)
            unique.append(query)

    return unique[:MAX_QUERIES_PER_INDUSTRY_LOCATION]


def generate_search_queries(
    industry,
    location,
    settings=None,
    learning_records=None,
    used_queries=None,
):
    settings = settings or {}
    learning_records = learning_records or []
    used_queries = used_queries or set()

    api_key = _gemini_api_key(settings)

    queries = []

    if api_key:
        queries = _generate_gemini_queries(
            industry=industry,
            location=location,
            learning_records=learning_records,
            api_key=api_key,
        )

    if not queries:
        queries = _fallback_queries(
            industry=industry,
            location=location,
            learning_records=learning_records,
        )

    used_normalised = {
        _normalise(query)
        for query in used_queries
    }

    fresh = [
        query
        for query in queries
        if _normalise(query) not in used_normalised
    ]

    # If historical queries exhaust the set, reuse them rather than
    # stopping discovery completely.
    if not fresh:
        fresh = queries

    return fresh[:MAX_QUERIES_PER_INDUSTRY_LOCATION]


def _parse_instagram_handle(url):
    try:
        parsed = urlparse(url)
    except Exception:
        return ""

    hostname = (parsed.hostname or "").lower()

    if hostname not in {"instagram.com", "www.instagram.com"}:
        return ""

    parts = [
        part for part in parsed.path.strip("/").split("/")
        if part
    ]

    if not parts:
        return ""

    reserved = {
        "p",
        "reel",
        "reels",
        "stories",
        "explore",
        "accounts",
        "direct",
        "about",
        "developer",
    }

    if parts[0].lower() in reserved:
        return ""

    handle = parts[0].lstrip("@")

    if not re.fullmatch(r"[A-Za-z0-9._]{1,30}", handle):
        return ""

    return handle


def _find_urls(text):
    if not text:
        return []

    matches = re.findall(
        r"https?://[^\s<>'\"),]+|"
        r"(?<![@\w])(?:www\.)?[A-Za-z0-9-]+"
        r"(?:\.[A-Za-z0-9-]+)+"
        r"(?:/[^\s<>'\"),]*)?",
        text,
        flags=re.I,
    )

    results = []

    for match in matches:
        url = _canonical_url(match)

        if url and url not in results:
            results.append(url)

    return results


def _website_evidence_from_text(text, source_url=""):
    """
    Return website evidence only when an official-looking domain
    is explicitly present in accessible text or a link.

    A missing domain is not proof that no website exists.
    """
    urls = _find_urls(text)

    if source_url:
        urls.insert(0, _canonical_url(source_url))

    seen = set()

    for url in urls:
        if not url:
            continue

        key = _normalise(url)

        if key in seen:
            continue

        seen.add(key)

        if _is_official_website_url(url):
            return {
                "status": "HAS WEBSITE",
                "website": url,
                "evidence_url": source_url or url,
                "evidence": (
                    "An official-looking website URL was found "
                    "in publicly accessible evidence."
                ),
            }

    return {
        "status": "UNKNOWN",
        "website": "",
        "evidence_url": source_url,
        "evidence": (
            "No official website URL was confirmed in the evidence "
            "checked. This does not prove the business has no website."
        ),
    }


def _fetch_page(url):
    """
    Fetch a publicly accessible page when allowed by the website.
    This does not bypass login, access controls, or anti-bot protections.
    """
    if not url:
        return ""

    response = _get(url)

    if response is None:
        return ""

    content_type = response.headers.get("Content-Type", "").lower()

    if content_type and "html" not in content_type:
        return ""

    return response.text[:1_000_000]


def _extract_html_links(html, base_url=""):
    if not html:
        return []

    links = re.findall(
        r"""href\s*=\s*["']([^"'#]+)["']""",
        html,
        flags=re.I,
    )

    output = []

    for link in links:
        link = _text(link)

        if link.startswith("//"):
            link = "https:" + link

        elif link.startswith("/"):
            if base_url:
                parsed = urlparse(base_url)
                link = f"{parsed.scheme}://{parsed.netloc}{link}"
            else:
                continue

        elif not re.match(r"^https?://", link, re.I):
            continue

        canonical = _canonical_url(link)

        if canonical and canonical not in output:
            output.append(canonical)

    return output


def _instagram_profile_evidence(url):
    """
    Inspect publicly accessible Instagram profile HTML where available.
    If Instagram blocks access, the result remains UNKNOWN.
    """
    handle = _parse_instagram_handle(url)

    if not handle:
        return {
            "handle": "",
            "website": "",
            "website_status": "UNKNOWN",
            "phone": "",
            "evidence": "",
        }

    html = _fetch_page(f"https://www.instagram.com/{handle}/")

    if not html:
        return {
            "handle": handle,
            "website": "",
            "website_status": "UNKNOWN",
            "phone": "",
            "evidence": (
                "Instagram profile could not be inspected publicly."
            ),
        }

    # Instagram page metadata can include the profile's outbound website.
    metadata_values = re.findall(
        r"""(?:content|href)\s*=\s*["']([^"']+)["']""",
        html,
        flags=re.I,
    )

    combined = " ".join(metadata_values)
    urls = _find_urls(combined)

    website = ""

    for candidate in urls:
        if _is_official_website_url(candidate):
            website = candidate
            break

    phones = _extract_phones(
        re.sub(r"<[^>]+>", " ", html)
    )

    return {
        "handle": handle,
        "website": website,
        "website_status": "HAS WEBSITE" if website else "UNKNOWN",
        "phone": phones[0] if phones else "",
        "evidence": (
            "An outbound website link was found on the public profile."
            if website
            else
            "No outbound official website link was confirmed on the "
            "accessible Instagram profile. Website existence remains "
            "unknown."
        ),
    }


def _industry_osm_filters(industry):
    text = _normalise(industry)

    for keywords, filters in INDUSTRY_OSM_KEYWORDS:
        if any(keyword in text for keyword in keywords):
            return filters

    return []


def geocode_location(location):
    """Geocode a location to (lat, lon) via Nominatim, India-restricted."""
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
            headers=OSM_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        data = response.json()

        if not data:
            return None

        return float(data[0]["lat"]), float(data[0]["lon"])

    except (requests.RequestException, ValueError, KeyError, TypeError, IndexError) as exc:
        logger.warning("Geocoding failed for %s: %s", location, exc)
        return None


def query_overpass(query):
    """Query Overpass, falling back across mirrors on failure."""
    last_error = None

    for endpoint in [OVERPASS_URL, *OVERPASS_FALLBACK_URLS]:
        try:
            response = requests.post(
                endpoint,
                data={"data": query},
                headers=OSM_HEADERS,
                timeout=60,
            )
            response.raise_for_status()
            return response.json()

        except requests.RequestException as exc:
            last_error = exc
            time.sleep(0.5)

    raise RuntimeError(f"All Overpass endpoints failed: {last_error}")


def _osm_tag(tags, *keys):
    for key in keys:
        value = _text(tags.get(key))
        if value:
            return value
    return ""


def extract_osm_business(element, industry, location):
    tags = element.get("tags", {}) or {}
    name = _osm_tag(tags, "name", "brand", "operator")

    if not name or len(name) < 2:
        return None

    phone = _phone(_osm_tag(tags, "contact:phone", "phone", "mobile"))
    instagram = _osm_tag(tags, "contact:instagram", "instagram").lstrip("@")
    website_raw = _osm_tag(tags, "contact:website", "website", "url")
    website = _canonical_url(website_raw) if website_raw else ""
    has_real_website = bool(website) and _is_official_website_url(website)

    osm_type = _text(element.get("type"))
    osm_id = _text(element.get("id"))

    address_parts = [
        _osm_tag(tags, "addr:housenumber"),
        _osm_tag(tags, "addr:street"),
        _osm_tag(tags, "addr:suburb"),
        _osm_tag(tags, "addr:city"),
    ]
    address = ", ".join(part for part in address_parts if part) or _text(location)

    return {
        "Lead ID": _stable_id(name, location, osm_type, osm_id),
        "Business Name": name,
        "Industry": industry,
        "Business Type": industry,
        "Location": _text(location),
        "Address": address,
        "Phone": phone,
        "Instagram ID": instagram,
        "Lead Source": "OpenStreetMap",
        "Source URL": (
            f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
            if osm_type and osm_id else ""
        ),
        "Search Query": "",
        "Search Result Date": "",
        # Tag absence does not prove no website exists -- stays UNKNOWN
        # (manual review required) rather than being treated as NO WEBSITE.
        "Website": website if has_real_website else "",
        "Website Status": "HAS WEBSITE" if has_real_website else "UNKNOWN",
        "Website Evidence": (
            "An official-looking website URL was found in OpenStreetMap "
            "contact tags."
            if has_real_website else
            "No website tag found on OpenStreetMap. This does not prove "
            "the business has no website."
        ),
        "Website Evidence URL": website,
        "Buying Signal": "",
        "Buying Signal Evidence": "",
        "Buying Signal URL": "",
        "Buying Signal Date": "",
        # OSM tag filters are matched to the requested industry, so this
        # is genuine evidence, unlike a generic web search result.
        "Industry Verified": True,
        "Industry Match": True,
        "Needs Manual Review": True,
        "Discovery Evidence": f"OpenStreetMap tags: {dict(tags)}"[:2000],
    }


def discover_osm_businesses(industry, location, radius_m=20000):
    coordinates = geocode_location(location)

    if not coordinates:
        logger.warning("Could not geocode location for OSM: %s", location)
        return []

    lat, lon = coordinates
    radius_m = max(1000, min(int(radius_m), 50000))
    filters = _industry_osm_filters(industry)

    if not filters:
        logger.info(
            "No OSM tag filters configured for industry: %s", industry
        )
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
        data = query_overpass(query)
    except Exception as exc:
        logger.warning(
            "OSM query failed for %s in %s: %s", industry, location, exc
        )
        return []

    output = []

    for element in data.get("elements", []):
        business = extract_osm_business(element, industry, location)

        if business:
            output.append(business)

    return output


def _candidate_from_result(result, industry, location):
    title = _text(result.get("title", ""))
    url = _canonical_url(result.get("url", ""))
    snippet = _text(result.get("snippet", ""))
    source_query = _text(result.get("query", ""))
    published_date = _text(result.get("date", ""))

    if not title or not url:
        return None

    if _normalise(title) in GENERIC_NAMES:
        return None

    if _is_directory_url(url):
        return None

    text = f"{title} {snippet}"

    instagram_handle = _parse_instagram_handle(url)

    instagram_id = ""
    website = ""
    website_status = "UNKNOWN"
    website_evidence = ""
    website_evidence_url = ""
    phone = ""
    business_name = title

    if instagram_handle:
        instagram_id = instagram_handle

        profile = _instagram_profile_evidence(url)

        if profile.get("website"):
            website = profile["website"]
            website_status = "HAS WEBSITE"
            website_evidence = profile.get("evidence", "")
            website_evidence_url = url

        if profile.get("phone"):
            phone = profile["phone"]

        # Instagram search snippets may contain a display name, bio,
        # contact details, and other publicly indexed information.
        if " | Instagram" in business_name:
            business_name = business_name.split(" | Instagram", 1)[0]

        if " - Instagram" in business_name:
            business_name = business_name.split(" - Instagram", 1)[0]

    else:
        evidence = _website_evidence_from_text(text, url)

        if evidence["status"] == "HAS WEBSITE":
            website = evidence["website"]
            website_status = "HAS WEBSITE"
            website_evidence = evidence["evidence"]
            website_evidence_url = evidence["evidence_url"]

    if not phone:
        phones = _extract_phones(text)

        if phones:
            phone = phones[0]

    if not business_name or _normalise(business_name) in GENERIC_NAMES:
        return None

    # Avoid treating search-result source URLs as proof of no website.
    return {
        "Lead ID": _stable_id(business_name, location, url),
        "Business Name": business_name,
        "Industry": industry,
        "Business Type": industry,
        "Location": location,
        "Phone": phone,
        "Instagram ID": instagram_id,
        "Lead Source": (
            "Public Instagram profile search"
            if instagram_id
            else "Public web search"
        ),
        "Source URL": url,
        "Search Query": source_query,
        "Search Result Date": published_date,
        "Website": website,
        "Website Status": website_status,
        "Website Evidence": website_evidence,
        "Website Evidence URL": website_evidence_url,
        "Buying Signal": "",
        "Buying Signal Evidence": "",
        "Buying Signal URL": "",
        "Buying Signal Date": "",
        "Industry Verified": False,
        "Industry Match": False,
        "Needs Manual Review": True,
        "Discovery Evidence": snippet,
    }


def _dedupe_candidates(candidates):
    output = []
    seen = set()

    for candidate in candidates:
        if not candidate:
            continue

        phone = _phone(candidate.get("Phone", ""))
        instagram = _normalise(candidate.get("Instagram ID", ""))
        source_url = _normalise(candidate.get("Source URL", ""))

        name = _normalise(candidate.get("Business Name", ""))
        location = _normalise(candidate.get("Location", ""))

        keys = []

        if phone:
            keys.append(("phone", phone))

        if instagram:
            keys.append(("instagram", instagram))

        if source_url:
            keys.append(("url", source_url))

        if name:
            keys.append(("name_location", name, location))

        if any(key in seen for key in keys):
            continue

        for key in keys:
            seen.add(key)

        output.append(candidate)

    return output


def discover_businesses(
    industry,
    locations,
    settings=None,
    used_queries=None,
    learning_records=None,
    include_osm=False,
):
    """
    Discover candidate businesses from OpenStreetMap, public web search,
    and Instagram search.

    This function does not write to Google Sheets.
    It does not qualify businesses.

    include_osm: OSM results come from fixed tag filters for the
    industry, not search text, so they do not change between repeated
    calls for the same industry/location. The caller (session_runner)
    sets this True only on the first discovery round of a session and
    False on later rounds, to avoid redundant Overpass calls.
    """
    settings = settings or {}
    used_queries = used_queries or set()
    learning_records = learning_records or []

    candidates = []

    if include_osm:
        for location in locations:
            try:
                candidates.extend(
                    discover_osm_businesses(industry, location)
                )
            except Exception as exc:
                logger.warning(
                    "OSM discovery error for %s in %s: %s",
                    industry, location, exc,
                )

    for location in locations:
        queries = generate_search_queries(
            industry=industry,
            location=location,
            settings=settings,
            learning_records=learning_records,
            used_queries=used_queries,
        )

        for query in queries:
            logger.info(
                "Searching industry=%s location=%s query=%s",
                industry,
                location,
                query,
            )

            try:
                results = _bing_search(query)
            except Exception as exc:
                logger.warning("Search failed for %s: %s", query, exc)
                results = []

            for result in results:
                candidate = _candidate_from_result(
                    result=result,
                    industry=industry,
                    location=location,
                )

                if candidate:
                    candidates.append(candidate)

            # Keep requests at a moderate pace.
            time.sleep(0.4)

    return _dedupe_candidates(candidates)


def discover_from_settings(
    settings,
    learning_records=None,
    used_queries=None,
    include_osm=False,
):
    """
    Entry point expected by session_runner.py.

    Industries and locations are always read from Settings.
    OSM is intentionally not used as the primary discovery source.
    """
    settings = settings or {}
    learning_records = learning_records or []
    used_queries = used_queries or set()

    industries = _industries_from_settings(settings)
    locations = _locations_from_settings(settings)

    if not industries:
        logger.warning(
            "No industries configured in Settings. Discovery skipped."
        )
        return []

    if not locations:
        logger.warning(
            "No locations configured in Settings. Discovery skipped."
        )
        return []

    all_candidates = []

    for industry in industries:
        for location in locations:
            candidates = discover_businesses(
                industry=industry,
                locations=[location],
                settings=settings,
                used_queries=used_queries,
                learning_records=learning_records,
                include_osm=include_osm,
            )

            all_candidates.extend(candidates)

    return _dedupe_candidates(all_candidates)