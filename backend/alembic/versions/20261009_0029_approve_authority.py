"""Per-CRUD approve authority: `<code>.approve` privileges.

Revision ID: 20261009_0029
Revises: 20261009_0028
Create Date: 2026-10-09

Seeds the new `<code>.approve` privileges and, so nothing stops working, grants all of
them to every role that can approve requests today (those holding approvals.write).
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0029"
down_revision = "20261009_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_permissions
        from models.users import Permission, RolePermission

        seed_permissions(session)

        approve_ids = [
            p.id for p in session.query(Permission).filter(
                Permission.code.like("%.approve"), Permission.is_deleted == False  # noqa: E712
            ).all()
        ]
        write = session.query(Permission).filter(Permission.code == "approvals.write").first()
        if write and approve_ids:
            role_ids = [
                r.role_id for r in session.query(RolePermission).filter(
                    RolePermission.permission_id == write.id, RolePermission.is_deleted == False  # noqa: E712
                ).all()
            ]
            for role_id in role_ids:
                held = {
                    r.permission_id for r in session.query(RolePermission).filter(
                        RolePermission.role_id == role_id, RolePermission.is_deleted == False  # noqa: E712
                    ).all()
                }
                for pid in approve_ids:
                    if pid not in held:
                        session.add(RolePermission(role_id=role_id, permission_id=pid, requires_approval=False))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
