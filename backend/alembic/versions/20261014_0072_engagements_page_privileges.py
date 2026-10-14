"""Each Engagements page (Affiliations, Associates, Press & Media, Committee) opens with its own page privilege.

Nobody held these privileges yet, so no role loses access.

Revision ID: 20261014_0072
Revises: 20261014_0071
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0072"
down_revision = "20261014_0071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)  # applies MENU_PERMISSION_FIXES
    finally:
        session.close()


def downgrade() -> None:
    pass
