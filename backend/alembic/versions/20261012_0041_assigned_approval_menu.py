"""Menu: "Assigned for Approval" page under Membership.

Revision ID: 20261012_0041
Revises: 20261012_0040
Create Date: 2026-10-12

seed_menu_pages inserts the missing page row; rows an admin edited are kept.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261012_0041"
down_revision = "20261012_0040"
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
    pass
