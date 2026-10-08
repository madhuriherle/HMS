"""First-run bootstrap (no catalog seeding — modules, privileges and roles
live in their tables; see db/seed_defaults.py for the starting rows)."""

import logging

from core.config import settings

logger = logging.getLogger("hms.permissions")


def get_role_by_code(db, code: str):
    from models.users import Role
    return db.query(Role).filter(Role.code == code, Role.is_deleted == False).first()  # noqa: E712


def create_bootstrap_superuser(db):
    """Create the initial Super Admin when the users table is empty."""
    from core.security import get_password_hash, validate_password_strength
    from models.users import User

    has_users = db.query(User).filter(User.is_deleted == False).first()  # noqa: E712
    if has_users:
        return None
    if not settings.BOOTSTRAP_ADMIN_PASSWORD:
        logger.warning(
            "The users table is empty and BOOTSTRAP_ADMIN_PASSWORD is not set — "
            "no admin account was created. Set it and restart to bootstrap one."
        )
        return None
    validate_password_strength(settings.BOOTSTRAP_ADMIN_PASSWORD)

    role = get_role_by_code(db, "SUPERADMIN")
    if role is None:
        logger.error(
            "No SUPERADMIN role found — run `alembic upgrade head` (or "
            "`python scripts/seed_defaults.py`) before bootstrapping the admin."
        )
        return None
    user = User(
        name="Administrator",
        username=settings.BOOTSTRAP_ADMIN_USERNAME,
        email=settings.BOOTSTRAP_ADMIN_EMAIL,
        password_hash=get_password_hash(settings.BOOTSTRAP_ADMIN_PASSWORD),
        user_type="SUPERADMIN",
        role_id=role.id,
        status=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.warning("Bootstrapped Super Admin account '%s' (id=%s).", user.username, user.id)
    return user


def run_bootstrap(db) -> None:
    """Startup hook: bootstrap the first Super Admin when the users table is
    empty. Never raises — a broken/absent schema must not prevent the API
    from booting."""
    try:
        create_bootstrap_superuser(db)
    except Exception:
        logger.exception("Startup bootstrap failed (database not migrated yet?)")
        db.rollback()
