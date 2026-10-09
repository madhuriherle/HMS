"""Menu: Register New Member page, "Unapproved Members" rename.

Revision ID: 20261009_0027
Revises: 20261009_0026
Create Date: 2026-10-09

seed_menu_pages inserts missing page rows and applies renames only while a row
still has its old name, so anything an admin edited is kept.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0027"
down_revision = "20261009_0026"
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
