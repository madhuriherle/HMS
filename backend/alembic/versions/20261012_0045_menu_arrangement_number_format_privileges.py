"""Sidebar arrangement + Number Formats get their own privileges.

Revision ID: 20261012_0045
Revises: 20261012_0044
Create Date: 2026-10-12

* Organisation Settings moves under Settings (next to Number Formats); Assigned for Approval moves under Approvals.
  Only rows still in their old group are moved, so a move an admin made by hand is kept.
* New privileges system.number_formats.read / .write; every role holding system.read / system.write is given the
  matching one (same "needs approval" flag), so nobody who could use the screen loses it.
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261012_0045"
down_revision = "20261012_0044"
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
            base, new = perms.get(f"system.{action}"), perms.get(f"system.number_formats.{action}")
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
                    session.add(RolePermission(role_id=grant.role_id, permission_id=new.id, requires_approval=grant.requires_approval))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
