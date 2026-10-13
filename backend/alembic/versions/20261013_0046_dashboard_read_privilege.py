"""The dashboard needs its own read privilege.

Revision ID: 20261013_0046
Revises: 20261012_0045
Create Date: 2026-10-13

* New privilege dashboard.read (the GET /api/v1/dashboard endpoint is gated on it).
* The Dashboard menu page switches from "no privilege" to dashboard.read — but only
  while the row still has none, so an admin-edited value is kept.
* Nothing is granted automatically by the seeds; this migration does grandfather
  dashboard.read onto every active role (see below), so nobody loses the dashboard
  they already had. The office can untick roles afterwards.

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0046"
down_revision = "20261012_0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages, seed_modules, seed_permissions

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)

        from models.users import Permission, Role, RolePermission
        dash_read = (
            session.query(Permission.id)
            .filter(Permission.code == "dashboard.read", Permission.is_deleted == False)  # noqa: E712
            .first()
        )
        if dash_read:
            granted = {
                row[0] for row in session.query(RolePermission.role_id).filter(
                    RolePermission.permission_id == dash_read[0],
                    RolePermission.is_deleted == False,  # noqa: E712
                ).all()
            }
            for role_id, in (
                session.query(Role.id).filter(Role.is_deleted == False, Role.status == True).all()  # noqa: E712
            ):
                if role_id not in granted:
                    session.add(RolePermission(role_id=role_id, permission_id=dash_read[0], requires_approval=False))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
