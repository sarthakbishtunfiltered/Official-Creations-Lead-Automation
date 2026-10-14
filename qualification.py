import re
from difflib import SequenceMatcher
from urllib.parse import urlparse


def _normalise(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _as_bool(value):
    if isinstance(value, bool):
        return value

    return _normalise(value) in {
        "true", "yes", "y", "1", "approved", "checked"
    }


def _has_contact(business):
    phone = str(business.get("Phone", "") or "").strip()
    instagram = str(business.get("Instagram ID", "") or "").strip()

    return bool(phone or instagram)


def _selected_industries(settings):
    for key, value in settings.items():
        if _normalise(key) in {
            "industries",
            "selected industries",
            "industry",
        }:
            if isinstance(value, list):
                return [str(item).strip() for item in value if str(item).strip()]

            return [
                item.strip()
                for item in re.split(r"[,;\n]", str(value or ""))
                if item.strip()
            ]

    return []


def _industry_match(business, settings):
    selected = _selected_industries(settings)

    if not selected:
        return False

    candidate_industry = _normalise(business.get("Industry", ""))
    candidate_type = _normalise(business.get("Business Type", ""))
    candidate_name = _normalise(business.get("Business Name", ""))

    evidence = " ".join([
        candidate_industry,
        candidate_type,
        candidate_name,
    ]).strip()

    for industry in selected:
        target = _normalise(industry)

        if not target:
            continue

        if candidate_industry == target or candidate_type == target:
            return True

        if target in evidence:
            return True

        if candidate_industry and SequenceMatcher(
            None, target, candidate_industry
        ).ratio() >= 0.90:
            return True

    return _as_bool(business.get("Industry Verified", False))


def _website_status(business):
    status = _normalise(business.get("Website Status", ""))
    website = str(business.get("Website", "") or "").strip()

    if website:
        parsed = urlparse(
            website if "://" in website else f"https://{website}"
        )

        if parsed.hostname:
            host = parsed.hostname.lower().removeprefix("www.")

            # Social media profiles are not treated as official websites.
            social_hosts = {
                "instagram.com",
                "facebook.com",
                "linkedin.com",
                "youtube.com",
                "tiktok.com",
                "x.com",
                "twitter.com",
            }

            if host not in social_hosts:
                return "HAS WEBSITE"

    if status in {
        "no website",
        "no official website",
        "website not found - verified",
    }:
        return "NO WEBSITE"

    if status in {
        "has website",
        "website found",
        "website verified",
    }:
        return "HAS WEBSITE"

    return "UNKNOWN"


def has_existing_website(business):
    return _website_status(business) == "HAS WEBSITE"


def qualify_business(business, settings=None):
    settings = settings or {}
    result = dict(business)

    website_status = _website_status(result)
    industry_match = _industry_match(result, settings)
    contact_available = _has_contact(result)

    reasons = []

    if website_status == "HAS WEBSITE":
        reasons.append("Business has an official website")

    elif website_status == "UNKNOWN":
        reasons.append("Website status requires manual verification")

    if not industry_match:
        reasons.append("Selected industry match not verified")

    if not contact_available:
        reasons.append("No usable phone number or Instagram contact")

    qualified = (
        website_status == "NO WEBSITE"
        and industry_match
        and contact_available
    )

    score = 0

    if industry_match:
        score += 40

    if contact_available:
        score += 25

    if website_status == "NO WEBSITE":
        score += 25

    if str(result.get("Buying Signal Evidence", "")).strip():
        score += 10

    result["Website Status"] = website_status
    result["Industry Match"] = industry_match
    result["Contact Available"] = contact_available
    result["Qualified"] = qualified
    result["Score"] = min(score, 100)
    result["Priority"] = (
        "P1" if score >= 80
        else "P2" if score >= 60
        else "P3"
    )
    result["Needs Manual Review"] = not qualified
    result["Qualification Reason"] = (
        "Qualified" if qualified else "; ".join(reasons)
    )

    return result


def qualify_businesses(businesses, settings=None):
    return [
        qualify_business(business, settings)
        for business in businesses
    ]