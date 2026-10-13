"""Organisation Settings gets its own Read / Write privileges.

Revision ID: 20261013_0057
Revises: 20261013_0056
Create Date: 2026-10-13

Adds masters.organisation.read / .write, points the menu page at the Read one (only while it still holds
system.read) and grants both to every role that holds system.read / system.write today, with the same "needs
approval" flag, so nothing stops working. Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0057"
down_revision = "20261013_0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages, seed_modules, seed_permissions
        from models.users import Permission, RolePermission

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)

        perms = {p.code: p for p in session.query(Permission).filter(Permission.is_deleted == False).all()}  # noqa: E712
        for action in ("read", "write"):
            base, new = perms.get(f"system.{action}"), perms.get(f"masters.organisation.{action}")
            if not base or not new:
                continue
            for grant in session.query(RolePermission).filter(
                RolePermission.permission_id == base.id, RolePermission.is_deleted == False  # noqa: E712
            ).all():
                has = session.query(RolePermission).filter(
                    RolePermission.role_id == grant.role_id, RolePermission.permission_id == new.id,
                    RolePermission.is_deleted == False,  # noqa: E712
                ).first()
                if not has:
                    session.add(RolePermission(role_id=grant.role_id, permission_id=new.id,
                                               requires_approval=grant.requires_approval))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
