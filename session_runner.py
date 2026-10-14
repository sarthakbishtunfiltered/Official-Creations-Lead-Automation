import hashlib
import re
from collections import Counter
from datetime import datetime, timezone

from google_sheets import (
    read_settings,
    get_all_leads,
    get_blacklisted_sheet,
    get_called_rejected_sheet,
    get_learning_records,
    upsert_learning_record,
    upsert_learning_records,
)
from discovery import discover_from_settings
from qualification import qualify_businesses

DRY_RUN = True
WRITE_LEARNING_DATA = True

# Free, no-API discovery loop: keep trying fresh, never-before-used
# search queries (tracked via Learning Data) round by round until
# either TARGET_QUALIFIED_LEADS is reached or MAX_DISCOVERY_ROUNDS
# is used up, whichever comes first.
TARGET_QUALIFIED_LEADS = 5
MAX_DISCOVERY_ROUNDS = 3


def _normalise(value):
    return re.sub(
        r"\s+",
        " ",
        str(value or "").strip().lower(),
    )


def _phone(value):
    return "".join(
        character
        for character in str(value or "")
        if character.isdigit()
    )


def _truthy(value):
    return _normalise(value) in {
        "true", "yes", "y", "1", "checked", "approved",
    }


def _identity_keys(lead):
    keys = set()

    name = _normalise(lead.get("Business Name"))
    phone = _phone(lead.get("Phone"))
    instagram = _normalise(
        lead.get("Instagram ID")
    ).lstrip("@")

    if name:
        keys.add("name:" + name)

    if phone:
        keys.add("phone:" + phone)

    if instagram:
        keys.add("instagram:" + instagram)

    return keys


def _records(sheet_getter):
    try:
        return sheet_getter().get_all_records()
    except Exception as exc:
        print(f"WARNING: Could not read a reference sheet: {exc}")
        return []


def _automation_is_running(settings):
    for key, value in settings.items():
        if _normalise(key).replace("_", " ") == "automation status":
            return _normalise(value) in {
                "running", "run", "start", "started",
            }

    return False


def _run_until_valid(settings):
    run_until = ""

    for key, value in settings.items():
        if _normalise(key).replace("_", " ") == "run until":
            run_until = str(value or "").strip()
            break

    if not run_until:
        return True

    try:
        timestamp = run_until.replace("Z", "+00:00")
        deadline = datetime.fromisoformat(timestamp)

        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=timezone.utc)

        return (
            datetime.now(timezone.utc)
            < deadline.astimezone(timezone.utc)
        )

    except (ValueError, TypeError):
        print("WARNING: Run Until is invalid. Refusing to run.")
        return False


def _build_blocked_keys(records):
    keys = set()

    for record in records:
        keys.update(_identity_keys(record))

    return keys


def _is_blocked(lead, blocked_keys):
    return bool(_identity_keys(lead) & blocked_keys)


def _stable_id(prefix, *parts):
    content = "|".join(
        _normalise(part)
        for part in parts
    )

    digest = hashlib.sha256(
        content.encode("utf-8")
    ).hexdigest()[:24]

    return f"{prefix}:{digest}"


def _candidate_record(lead):
    name = str(lead.get("Business Name", "")).strip()
    location = str(lead.get("Location", "")).strip()
    industry = str(lead.get("Industry", "")).strip()
    query = str(lead.get("Search Query", "")).strip()
    source = str(lead.get("Lead Source", "")).strip()

    source_url = str(lead.get("Source URL", "")).strip()
    osm_tags = lead.get("OSM Tags", {}) or {}

    if isinstance(osm_tags, dict):
        osm_category = (
            osm_tags.get("shop")
            or osm_tags.get("office")
            or osm_tags.get("craft")
            or osm_tags.get("amenity")
            or osm_tags.get("healthcare")
            or ""
        )
    else:
        osm_category = str(osm_tags)

    website = str(lead.get("Website", "")).strip()

    if website:
        website_status = "Website found - verify"
    else:
        website_status = "Unknown - verify manually"

    if lead.get("Industry Verified", False):
        industry_match = "Verified by source tags"
    else:
        industry_match = "Unverified - manual review"

    record_id = _stable_id(
        "DISCOVERY",
        name,
        location,
        industry,
        query,
        source_url or source,
    )

    return {
        "Record ID": record_id,
        "Date": datetime.now(timezone.utc).isoformat(),
        "Industry": industry,
        "Location": location,
        "Search Query": query,
        "Source": source,
        "Business Name": name,
        "Business Type": str(
            lead.get("Business Type", "")
        ),
        "OSM Category": str(osm_category),
        "Contact Available": (
            "Yes"
            if (
                str(lead.get("Phone", "")).strip()
                or str(lead.get("Instagram ID", "")).strip()
            )
            else "No"
        ),
        "Industry Match": industry_match,
        "Website Status": website_status,
        "Review Outcome": "DISCOVERED",
        "Rejection Reason": "",
        "Outcome Quality": "UNREVIEWED",
    }


def _record_discoveries(discovered, learning_records):
    if not WRITE_LEARNING_DATA:
        return

    existing_ids = {
        str(record.get("Record ID", "")).strip()
        for record in learning_records
    }

    new_records = []

    for lead in discovered:
        if not str(lead.get("Business Name", "")).strip():
            continue

        record = _candidate_record(lead)
        record_id = record["Record ID"]

        if record_id in existing_ids:
            continue

        new_records.append(record)
        existing_ids.add(record_id)

    if not new_records:
        print("New discovery records saved: 0")
        return

    # One batched call (one sheet read, one or two batched writes) for
    # the whole round, instead of one Sheets API round trip per
    # candidate -- that per-candidate pattern is what caused the 429
    # "Quota exceeded" errors on larger discovery runs.
    try:
        results = upsert_learning_records(new_records)
        print(f"New discovery records saved: {len(results)}")

    except Exception as exc:
        print(f"WARNING: Could not save discovery batch: {exc}")


def _feedback_outcome(lead):
    """
    Infer only explicit decisions.
    Unchecked and pending leads remain unreviewed.
    """
    status = _normalise(lead.get("Status"))
    approval_reason = str(
        lead.get("Approval Reason", "")
    ).strip()
    rejection_reason = str(
        lead.get("Rejection Reason", "")
    ).strip()

    if _truthy(lead.get("Approve")):
        return (
            "APPROVED",
            "",
            "GOOD",
        )

    if _truthy(lead.get("Reject After Call")):
        return (
            "REJECTED",
            rejection_reason or approval_reason,
            "BAD",
        )

    rejected_statuses = {
        "rejected",
        "rejected after call",
        "called rejected",
        "not a fit",
        "blacklisted",
        "rejected after review",
    }

    approved_statuses = {
        "approved",
        "accepted",
        "qualified",
    }

    if status in approved_statuses:
        return ("APPROVED", "", "GOOD")

    if status in rejected_statuses:
        return (
            "REJECTED",
            rejection_reason or approval_reason,
            "BAD",
        )

    return None


def _sync_dashboard_feedback(leads, learning_records):
    """
    Record explicit dashboard decisions in Learning Data only.

    The Leads tab is read-only in this process.
    """
    if not WRITE_LEARNING_DATA:
        return

    learning_by_name = {}

    for record in learning_records:
        name = _normalise(record.get("Business Name"))

        if name:
            learning_by_name.setdefault(name, []).append(record)

    processed = 0

    for lead in leads:
        outcome = _feedback_outcome(lead)

        if outcome is None:
            continue

        outcome_name, rejection_reason, quality = outcome

        business_name = str(
            lead.get("Business Name", "")
        ).strip()

        if not business_name:
            continue

        matching_records = learning_by_name.get(
            _normalise(business_name),
            [],
        )

        if matching_records:
            # Update discovery records for this business so that
            # the outcome can inform future searches.
            for old_record in matching_records:
                updated = dict(old_record)
                updated["Review Outcome"] = outcome_name
                updated["Rejection Reason"] = rejection_reason
                updated["Outcome Quality"] = quality

                try:
                    upsert_learning_record(updated)
                    processed += 1
                except Exception as exc:
                    print(
                        "WARNING: Could not sync feedback for "
                        f"{business_name}: {exc}"
                    )

        else:
            # The lead may have been added to the dashboard before
            # discovery learning was enabled.
            lead_id = str(lead.get("Lead ID", "")).strip()

            feedback_id = _stable_id(
                "FEEDBACK",
                lead_id or business_name,
            )

            feedback_record = {
                "Record ID": feedback_id,
                "Date": datetime.now(timezone.utc).isoformat(),
                "Industry": lead.get("Industry", ""),
                "Location": lead.get("Location", ""),
                "Search Query": "",
                "Source": lead.get("Lead Source", ""),
                "Business Name": business_name,
                "Business Type": "",
                "OSM Category": "",
                "Contact Available": (
                    "Yes"
                    if (
                        str(lead.get("Phone", "")).strip()
                        or str(lead.get("Instagram ID", "")).strip()
                    )
                    else "No"
                ),
                "Industry Match": "Dashboard reviewed",
                "Website Status": "Not assessed",
                "Review Outcome": outcome_name,
                "Rejection Reason": rejection_reason,
                "Outcome Quality": quality,
            }

            try:
                upsert_learning_record(feedback_record)
                processed += 1
            except Exception as exc:
                print(
                    "WARNING: Could not save dashboard feedback "
                    f"for {business_name}: {exc}"
                )

    print(f"Dashboard feedback records processed: {processed}")


def run_session():
    print("Official Creations Lead Automation")
    print(f"DRY_RUN = {DRY_RUN}")
    print(f"WRITE_LEARNING_DATA = {WRITE_LEARNING_DATA}")

    if not DRY_RUN:
        raise RuntimeError(
            "Live writes are disabled. Keep DRY_RUN=True."
        )

    try:
        settings = read_settings()
    except Exception as exc:
        print(f"Could not read Settings: {exc}")
        return

    if not _automation_is_running(settings):
        print("Automation Status is not RUNNING. No discovery performed.")
        return

    if not _run_until_valid(settings):
        print("Run Until has passed or is invalid. No discovery performed.")
        return

    try:
        existing_leads = get_all_leads()
        learning_records = get_learning_records()
    except Exception as exc:
        print(f"Could not read required Google Sheets data: {exc}")
        return

    # Capture decisions made in the dashboard before discovery.
    _sync_dashboard_feedback(
        existing_leads,
        learning_records,
    )

    # Refresh learning data so discovery uses the latest feedback.
    try:
        learning_records = get_learning_records()
    except Exception as exc:
        print(f"Could not refresh Learning Data: {exc}")
        return

    blacklisted_records = _records(get_blacklisted_sheet)
    rejected_records = _records(get_called_rejected_sheet)

    existing_keys = _build_blocked_keys(existing_leads)
    blacklist_keys = _build_blocked_keys(blacklisted_records)
    rejected_keys = _build_blocked_keys(rejected_records)

    print(f"Existing leads: {len(existing_leads)}")
    print(f"Blacklisted records: {len(blacklisted_records)}")
    print(f"Called Rejected records: {len(rejected_records)}")
    print(f"Learning records: {len(learning_records)}")

    # Seed "never repeat a query" memory from every search query we
    # have ever tried, per Learning Data -- this persists across
    # runs and days, not just within this session.
    used_queries = {
        _normalise(record.get("Search Query"))
        for record in learning_records
        if _normalise(record.get("Search Query"))
    }

    counts = {
        "qualified": 0,
        "explicit_signal": 0,
        "usable_contact": 0,
        "existing": 0,
        "blacklisted": 0,
        "called_rejected": 0,
        "not_qualified": 0,
    }

    # Diagnostic only: tally *why* each non-qualified candidate was
    # rejected, so a zero-qualified run is explainable instead of
    # silent. Does not change any qualification or filtering logic.
    rejection_reasons = Counter()
    rejection_examples = {}

    review_candidates = []
    seen_qualified_keys = set()
    total_discovered = 0

    for round_number in range(1, MAX_DISCOVERY_ROUNDS + 1):
        if counts["qualified"] >= TARGET_QUALIFIED_LEADS:
            break

        print(
            f"\n--- Discovery round {round_number}/"
            f"{MAX_DISCOVERY_ROUNDS} "
            f"(qualified so far: {counts['qualified']}/"
            f"{TARGET_QUALIFIED_LEADS}) ---"
        )

        try:
            discovered = discover_from_settings(
                settings,
                learning_records=learning_records,
                used_queries=used_queries,
                include_osm=(round_number == 1),
            )
        except Exception as exc:
            print(f"Discovery failed in round {round_number}: {exc}")
            break

        print(f"Discovered candidates this round: {len(discovered)}")
        total_discovered += len(discovered)

        # Record candidates separately; never append them to Leads.
        _record_discoveries(discovered, learning_records)

        # Refresh learning data so the next round's query ranking and
        # used-query memory reflect what was just saved.
        try:
            learning_records = get_learning_records()
        except Exception as exc:
            print(f"Could not refresh Learning Data: {exc}")

        if not discovered:
            print("No new candidates this round; stopping early.")
            break

        try:
            qualified = qualify_businesses(
                discovered,
                settings,
            )
        except Exception as exc:
            print(f"Qualification failed in round {round_number}: {exc}")
            break

        for lead in qualified:
            if _is_blocked(lead, blacklist_keys):
                counts["blacklisted"] += 1
                continue

            if _is_blocked(lead, rejected_keys):
                counts["called_rejected"] += 1
                continue

            if _is_blocked(lead, existing_keys):
                counts["existing"] += 1
                continue

            if not lead.get("Qualified", False):
                counts["not_qualified"] += 1

                reason = str(
                    lead.get("Qualification Reason", "")
                ).strip() or "Unknown reason"

                rejection_reasons[reason] += 1

                rejection_examples.setdefault(
                    reason,
                    str(lead.get("Business Name", "")).strip(),
                )

                continue

            # A qualified candidate may resurface in a later round
            # (e.g. found again via a different search query) --
            # don't double-count or double-list it.
            lead_keys = _identity_keys(lead)

            if lead_keys & seen_qualified_keys:
                continue

            seen_qualified_keys.update(lead_keys)
            counts["qualified"] += 1

            signal_text = _normalise(
                str(lead.get("Buying Signal Type", ""))
                + " "
                + str(lead.get("Buying Signal", ""))
            )

            if any(
                term in signal_text
                for term in (
                    "explicit_website_need",
                    "explicit website need",
                    "need a website",
                    "website required",
                    "looking for a website",
                )
            ):
                counts["explicit_signal"] += 1

            if lead.get("Has Contact", False):
                counts["usable_contact"] += 1

            review_candidates.append(lead)

    review_candidates.sort(
        key=lambda lead: (
            int(lead.get("Score", 0) or 0),
            _normalise(lead.get("Business Name")),
        ),
        reverse=True,
    )

    print("\nSESSION SUMMARY")
    print(f"Unique candidates discovered: {total_discovered}")
    print(f"Qualified new candidates: {counts['qualified']}")
    print(f"Explicit website signals: {counts['explicit_signal']}")
    print(
        "Qualified candidates with usable contact: "
        f"{counts['usable_contact']}"
    )
    print(f"Already in Leads: {counts['existing']}")
    print(f"Blacklisted: {counts['blacklisted']}")
    print(f"Previously rejected after call: {counts['called_rejected']}")
    print(f"Not qualified: {counts['not_qualified']}")

    if rejection_reasons:
        print("\nNOT QUALIFIED — WHY (diagnostic only)")
        for reason, count in rejection_reasons.most_common():
            example = rejection_examples.get(reason, "")
            example_note = f' (e.g. "{example}")' if example else ""
            print(f"- {reason}: {count}{example_note}")

    print("\nTOP CANDIDATES — PREVIEW ONLY")

    for index, lead in enumerate(review_candidates[:30], start=1):
        print(
            f"{index}. {lead.get('Business Name', '')} | "
            f"{lead.get('Industry', '')} | "
            f"{lead.get('Location', '')} | "
            f"Score: {lead.get('Score', 0)} | "
            f"Priority: {lead.get('Priority', '')} | "
            f"Phone: {lead.get('Phone', '')} | "
            f"Instagram: {lead.get('Instagram ID', '')}"
        )

    print(
        "\nDRY RUN COMPLETE. "
        "The Leads tab was not modified by this session."
    )


if __name__ == "__main__":
    run_session()