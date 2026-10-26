"""Gotra, Name Title and Qualification as one sidebar page each; the single Personal Masters page is switched off.

Revision ID: 20261026_0099
Revises: 20261026_0098

seed_menu_pages inserts the three new page rows (and keeps anything an admin edited). The Personal Masters row is only
disabled, never deleted. Idempotent.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261026_0099"
down_revision = "20261026_0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)
        session.execute(sa.text("UPDATE modules SET status = false WHERE code = 'masters.personal'"))
        session.execute(sa.text(
            "UPDATE modules SET status = true WHERE code IN ('masters.gotra', 'masters.name_title', 'masters.qualification') AND is_deleted = false"))
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
