"""Permission catalog, seeding and first-run bootstrap.

Every mutating endpoint declares the permission it requires via
``api.deps.require_permission("<module>.write")``. The catalog below is the
single source of truth for which permissions exist; ``seed_permissions`` upserts
it on startup so the permissions table is never empty.
"""

import logging
from typing import Optional

from core.config import settings

logger = logging.getLogger("hms.permissions")

# (code, module, name, description)
PERMISSION_CATALOG = [
    ("masters.write", "masters", "Manage masters", "Create/update states, districts, taluks, pincodes, membership types"),
    ("users.write", "users", "Manage users", "Create/update users, roles and role permissions"),
    ("members.write", "members", "Manage members", "Register, edit, approve and delete members"),
    ("receipts.write", "receipts", "Manage receipts", "Create, allocate, cancel and refund receipts"),
    ("magazines.write", "magazines", "Manage magazine", "Subscriptions, pauses, returns, labels and KYC links"),
    ("events.write", "events", "Manage events", "Create/update events, participants and attachments"),
    ("engagements.write", "engagements", "Manage engagements", "Affiliates, associates, press/media and committee"),
    ("notifications.write", "notifications", "Send notifications", "Templates, campaigns and WhatsApp sends"),
    ("approvals.write", "approvals", "Approve requests", "Approve/reject profile, type-change and deletion requests"),
    ("imports.write", "imports", "Bulk imports", "CSV imports such as postal codes"),
    ("reports.write", "reports", "Manage reports", "Create, update and delete saved reports"),
]


def seed_permissions(db) -> int:
    """Insert any missing permission rows. Returns the number created."""
    from models.users import Permission

    existing = {
        p.code
        for p in db.query(Permission).filter(Permission.is_deleted == False).all()
    }
    created = 0
    for code, module, name, description in PERMISSION_CATALOG:
        if code in existing:
            continue
        db.add(
            Permission(module=module, name=name, code=code, description=description)
        )
        created += 1
    if created:
        db.commit()
    return created


def create_bootstrap_superuser(db):
    """Create the initial SUPERADMIN when the users table is empty."""
    from core.security import get_password_hash, validate_password_strength
    from models.users import User

    has_users = db.query(User).filter(User.is_deleted == False).first()
    if has_users:
        return None
    if not settings.BOOTSTRAP_ADMIN_PASSWORD:
        logger.warning(
            "The users table is empty and BOOTSTRAP_ADMIN_PASSWORD is not set — "
            "no admin account was created. Set it and restart to bootstrap one."
        )
        return None
    validate_password_strength(settings.BOOTSTRAP_ADMIN_PASSWORD)

    user = User(
        name="Administrator",
        username=settings.BOOTSTRAP_ADMIN_USERNAME,
        email=settings.BOOTSTRAP_ADMIN_EMAIL,
        password_hash=get_password_hash(settings.BOOTSTRAP_ADMIN_PASSWORD),
        user_type="SUPERADMIN",
        status=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.warning(
        "Bootstrapped superadmin account '%s' (id=%s).",
        user.username,
        user.id,
    )
    return user


def run_bootstrap(db) -> None:
    """Startup hook: seed the permission catalog and bootstrap the first admin.

    Never raises — a broken/absent schema must not prevent the API from booting.
    """
    try:
        created = seed_permissions(db)
        if created:
            logger.info("Seeded %s new permission(s).", created)
        create_bootstrap_superuser(db)
    except Exception:
        logger.exception("Startup bootstrap failed (database not migrated yet?)")
        db.rollback()
