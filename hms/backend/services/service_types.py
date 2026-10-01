"""Default service_types catalogue.

The spec names the services a member can opt into (Magazine, Temple,
Mangalya, Hall). service_types is a *catalogue* master — it used to be seeded
with nothing, so there was no row to opt anyone into. These defaults give the
opt-in list something to render on a fresh install; admins can add more
through POST /masters/service-types and delete the ones the sabha doesn't
offer.

Seeding is upsert-by-code and never overwrites an admin's edits: a live row
whose code already exists is left alone, and a soft-deleted one is *not*
revived — retiring a service must stay retired, and re-seeding it would
silently resurrect its optins.
"""

import logging
from typing import Optional

logger = logging.getLogger("hms.service_types")

# (code, name_en, name_kn, description)
DEFAULT_SERVICE_TYPES = [
    ("MAGAZINE", "Magazine", "ಮ್ಯಾಗಜಿನ್", "Monthly Havyaka magazine delivery"),
    ("TEMPLE", "Temple", "ದೇವಸ್ಥಾನ", "Temple / deity seva participation"),
    ("MANGALYA", "Mangalya", "ಮಂಗಲ್ಯ", "Mangalya (auspicious marriage) service"),
    ("HALL", "Hall", "ಸಭಾ", "Community hall booking / usage"),
]


def seed_service_types(db) -> int:
    """Insert any missing default service_types. Returns the number created."""
    from models.masters import ServiceType

    try:
        existing = {
            s.code: s
            for s in db.query(ServiceType).filter(
                ServiceType.is_deleted == False  # noqa: E712
            ).all()
        }
        # Codes soft-deleted earlier are left deleted: re-seeding must not
        # undo an admin's decision to retire a service the sabha no longer
        # offers, and reviving the row would silently resurrect its optins.
        deleted_codes = {
            s.code
            for s in db.query(ServiceType).filter(
                ServiceType.is_deleted == True  # noqa: E712
            ).all()
        }
    except Exception:
        logger.exception("Cannot read service_types (table missing?) — skipping seed")
        db.rollback()
        return 0

    created = 0
    for code, name_en, name_kn, description in DEFAULT_SERVICE_TYPES:
        if code in existing:
            continue
        if code in deleted_codes:
            continue  # leave an admin's deletion in place; don't resurrect it
        db.add(ServiceType(
            code=code, name_en=name_en, name_kn=name_kn,
            description=description, status=True,
        ))
        created += 1
    if created:
        db.commit()
        logger.info("Seeded %d default service type(s).", created)
    return created


def get_service_type_by_code(db, code: str) -> Optional[object]:
    """Look up a live service_types row by its code (case-insensitive)."""
    from models.masters import ServiceType

    if not code:
        return None
    return db.query(ServiceType).filter(
        ServiceType.code == code.upper(),
        ServiceType.is_deleted == False,  # noqa: E712
    ).first()


def sync_magazine_optin(db, *, member_id: int, linked_id: Optional[int], created_by: Optional[int] = None):
    """Mirror a magazine subscription into the member's service opt-in list.

    Without this, "Magazine" would be the one service a member has to opt into
    a second time by hand, purely so it shows up on the profile — the
    subscription table is already the source of truth for magazine, so this
    only writes the index row (and cancels it if the subscription is removed).
    Returns the optin row, or None if the MAGAZINE service_type is retired.
    """
    from datetime import datetime, timezone

    from models.members import MemberServiceOptin

    service_type = get_service_type_by_code(db, "MAGAZINE")
    if not service_type:
        return None

    existing = db.query(MemberServiceOptin).filter(
        MemberServiceOptin.member_id == member_id,
        MemberServiceOptin.service_type_id == service_type.id,
        MemberServiceOptin.is_deleted == False,  # noqa: E712
    ).first()

    if linked_id is None:
        if existing and existing.status == "ACTIVE":
            existing.status = "CANCELLED"
            db.add(existing)
        return existing

    if existing:
        existing.status = "ACTIVE"
        existing.linked_type = "MAGAZINE_SUBSCRIPTION"
        existing.linked_id = linked_id
        db.add(existing)
        return existing

    optin = MemberServiceOptin(
        member_id=member_id,
        service_type_id=service_type.id,
        status="ACTIVE",
        opted_at=datetime.now(timezone.utc),
        opted_via="ADMIN",
        linked_type="MAGAZINE_SUBSCRIPTION",
        linked_id=linked_id,
        created_by=created_by,
    )
    db.add(optin)
    return optin
