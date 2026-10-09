"""Menu pages: Approvals, Bank Master, Personal Masters.

Revision ID: 20261009_0024
Revises: 20261009_0023
Create Date: 2026-10-09

Adds the sidebar page rows for the new Approvals, Bank Master and Personal
Masters screens. seed_menu_pages only inserts rows that are missing and never
overwrites values an admin has edited, so it is safe to re-run.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0024"
down_revision = "20261009_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)
    finally:
        session.close()


def downgrade() -> None:
    # The page rows are kept; they are plain data an admin may have edited.
    pass
