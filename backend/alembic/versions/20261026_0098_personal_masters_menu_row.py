"""Create the Personal Masters menu row (it was only ever commented out of the menu seed).

Revision ID: 20261026_0098
Revises: 20261026_0097

seed_menu_pages inserts the page rows that are missing and keeps anything an admin edited; the row is then made
active in case an older database had it switched off. Idempotent.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261026_0098"
down_revision = "20261026_0097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)
        session.execute(sa.text("UPDATE modules SET status = true WHERE code = 'masters.personal' AND is_deleted = false"))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
