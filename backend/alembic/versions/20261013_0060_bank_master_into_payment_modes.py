"""Banks are managed from Payment Mode Setup; the separate Bank Master screen is removed.

Revision ID: 20261013_0060
Revises: 20261013_0059
Create Date: 2026-10-13

The bank list is made and used on the Payment Mode Setup screen, so Bank Master has no page of its own. Roles
that held a Bank Master privilege (masters.banks.read / write / delete) are given the matching Payment Mode
Setup privilege first, then the Bank Master module, its privileges and their grants are removed. The bank rows
themselves are kept. Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0060"
down_revision = "20261013_0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module, Permission, RolePermission

        live = lambda model: model.is_deleted == False  # noqa: E731, E712
        old = {p.code: p for p in session.query(Permission).filter(Permission.code.like("masters.banks.%"), live(Permission)).all()}
        new = {p.code: p for p in session.query(Permission).filter(Permission.code.like("masters.payment_modes.%"), live(Permission)).all()}
        for code, perm in old.items():
            target = new.get(code.replace("masters.banks.", "masters.payment_modes."))
            for grant in session.query(RolePermission).filter(RolePermission.permission_id == perm.id, live(RolePermission)).all():
                if target is not None and not session.query(RolePermission.id).filter(
                    RolePermission.role_id == grant.role_id, RolePermission.permission_id == target.id, live(RolePermission)
                ).first():
                    session.add(RolePermission(role_id=grant.role_id, permission_id=target.id))
                grant.is_deleted = True
            perm.is_deleted = True
            perm.status = False
        for m in session.query(Module).filter(Module.code == "masters.banks", live(Module)).all():
            m.is_deleted = True
            m.status = False
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
