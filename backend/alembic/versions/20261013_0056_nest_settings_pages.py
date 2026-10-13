"""Nest Organisation Settings and Number Formats under the System Settings page in the sidebar.

Revision ID: 20261013_0056
Revises: 20261013_0055
Create Date: 2026-10-13

Moves the two pages only while they still sit directly under Settings, so a layout an admin arranged by hand
is kept. Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0056"
down_revision = "20261013_0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
