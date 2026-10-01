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
#
# Each module gets up to three granular permissions — create/update/delete —
# instead of one coarse "<module>.write", so a role's grant of any one of
# them can independently be flagged requires_approval (see
# role_permissions.requires_approval, api.deps.permission_requires_approval)
# without gating the others. "approvals" is the meta-permission for
# reviewing requests and is deliberately NOT itself split/gated — approving
# an approval doesn't make sense. "imports" only has a create-shaped action
# (a bulk import IS a create).
_CRUD_MODULES = {
    "masters": "masters, membership types and personal-master lookups (qualification, native place, …)",
    "users": "users, roles, role-permission grants and the modules master",
    "members": "members — profile, memberships, documents",
    "receipts": "receipts and receipt allocations",
    "magazines": "magazine subscriptions, pauses, returns and delivery labels",
    "events": "events, participants and attachments",
    "engagements": "affiliations, associates, press/media and committee records",
    "notifications": "notification templates, campaigns and sends",
    "reports": "saved reports",
}

PERMISSION_CATALOG = []
for _module, _desc in _CRUD_MODULES.items():
    PERMISSION_CATALOG.append((f"{_module}.create", _module, f"Create {_module}", f"Create {_desc}"))
    PERMISSION_CATALOG.append((f"{_module}.update", _module, f"Update {_module}", f"Update {_desc}"))
    PERMISSION_CATALOG.append((f"{_module}.delete", _module, f"Delete {_module}", f"Delete {_desc}"))

PERMISSION_CATALOG += [
    ("approvals.write", "approvals", "Approve requests", "Approve/reject profile, type-change, deletion and generic approval requests"),
    ("imports.create", "imports", "Bulk imports", "CSV imports such as postal codes"),
]

# (code, display name) — the distinct modules referenced by PERMISSION_CATALOG,
# seeded into the `modules` master so they're a managed/listable table rather
# than bare strings on Permission.module.
MODULE_CATALOG = [
    ("masters", "Masters"),
    ("users", "Users"),
    ("members", "Membership"),
    ("receipts", "Receipts"),
    ("magazines", "Magazine"),
    ("events", "Events"),
    ("engagements", "Engagements"),
    ("notifications", "Notifications"),
    ("approvals", "Approvals"),
    ("imports", "Imports"),
    ("reports", "Reports"),
]


def seed_modules(db) -> int:
    """Insert any missing module rows. Returns the number created."""
    from models.users import Module

    existing = {
        m.code
        for m in db.query(Module).filter(Module.is_deleted == False).all()
    }
    created = 0
    for code, name_en in MODULE_CATALOG:
        if code in existing:
            continue
        db.add(Module(code=code, name_en=name_en))
        created += 1
    if created:
        db.commit()
    return created


def seed_permissions(db) -> int:
    """Insert any missing permission rows. Returns the number created.

    Requires seed_modules() to have already run: a permission whose module
    code has no matching modules row is skipped (with a logged error)
    rather than inserted with a dangling module_id.
    """
    from models.users import Permission, Module

    existing = {
        p.code
        for p in db.query(Permission).filter(Permission.is_deleted == False).all()
    }
    modules_by_code = {
        m.code: m for m in db.query(Module).filter(Module.is_deleted == False).all()
    }
    created = 0
    for code, module, name, description in PERMISSION_CATALOG:
        if code in existing:
            continue
        module_row = modules_by_code.get(module)
        if not module_row:
            logger.error(
                "Permission '%s' references unknown module '%s' — not seeded. "
                "Add it to MODULE_CATALOG first.", code, module,
            )
            continue
        db.add(
            Permission(
                module=module, module_id=module_row.id,
                name=name, code=code, description=description,
            )
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
        created_modules = seed_modules(db)
        if created_modules:
            logger.info("Seeded %s new module(s).", created_modules)
        created = seed_permissions(db)
        if created:
            logger.info("Seeded %s new permission(s).", created)
        create_bootstrap_superuser(db)
    except Exception:
        logger.exception("Startup bootstrap failed (database not migrated yet?)")
        db.rollback()
