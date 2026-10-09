"""Remove the per-CRUD `<code>.approve` privileges added by 0029.

Revision ID: 20261009_0030
Revises: 20261009_0029
Create Date: 2026-10-09

Approval authority is one permission, approvals.write: whoever holds it can finalize every
request that reaches the queue. Soft-deletes the .approve permissions and any role grants.
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0030"
down_revision = "20261009_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Permission, RolePermission

        perms = session.query(Permission).filter(Permission.code.like("%.approve")).all()
        ids = [p.id for p in perms]
        if ids:
            for rp in session.query(RolePermission).filter(RolePermission.permission_id.in_(ids)).all():
                rp.is_deleted = True
            for p in perms:
                p.is_deleted = True
            session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
