"""Bulk Receipt Mapping gets its own Read / Write privileges.

Revision ID: 20261014_0061
Revises: 20261013_0060
Create Date: 2026-10-14

The page used to open with the Receipt Tracking privilege. It now has receipts.bulk_mapping.read / .write, and its
sidebar page points at the new read privilege. So nobody loses the page at once, every role that held Receipt
Tracking read / write is given the matching new privilege (with the same "needs approval" flag), except the
front-desk Receptionist role, which is meant for Receipt Entry and Receipt Tracking only. Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0061"
down_revision = "20261013_0060"
branch_labels = None
depends_on = None

NOT_CARRIED = ("RECEPTIONIST",)


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_modules, seed_permissions
        from models.users import Module, Permission, Role, RolePermission

        seed_modules(session)
        seed_permissions(session)
        session.flush()
        page = session.query(Module).filter(Module.code == "receipts.bulk_mapping", Module.is_deleted == False).first()  # noqa: E712
        if page is not None and page.permission_code in (None, "receipts.tracking.read"):
            page.permission_code = "receipts.bulk_mapping.read"

        by_code = {p.code: p for p in session.query(Permission).filter(Permission.is_deleted == False).all()}  # noqa: E712
        for old, new in (("receipts.tracking.read", "receipts.bulk_mapping.read"), ("receipts.tracking.write", "receipts.bulk_mapping.write")):
            if old not in by_code or new not in by_code:
                continue
            grants = session.query(RolePermission).filter(
                RolePermission.permission_id == by_code[old].id, RolePermission.is_deleted == False  # noqa: E712
            ).all()
            for g in grants:
                role = session.query(Role).filter(Role.id == g.role_id, Role.is_deleted == False).first()  # noqa: E712
                if role is None or role.code in NOT_CARRIED:
                    continue
                if not session.query(RolePermission.id).filter(
                    RolePermission.role_id == g.role_id, RolePermission.permission_id == by_code[new].id,
                    RolePermission.is_deleted == False,  # noqa: E712
                ).first():
                    session.add(RolePermission(role_id=g.role_id, permission_id=by_code[new].id,
                                               requires_approval=g.requires_approval))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
