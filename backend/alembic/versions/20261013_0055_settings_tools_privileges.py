"""Privileges for the Settings tools: Recycle Bin and Data Cleanup.

Revision ID: 20261013_0055
Revises: 20261013_0054
Create Date: 2026-10-13

Adds the modules system.recycle_bin / system.cleanup (Data Cleanup is limited to rank 1 roles), their
Read / Write privileges, and the "System Settings" sidebar page. Nothing is granted: only all-access roles
(the Super Admin) hold them until the Super Admin ticks them for another role. Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0055"
down_revision = "20261013_0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages, seed_modules, seed_permissions

        seed_modules(session)
        seed_menu_pages(session)
        seed_permissions(session)
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
