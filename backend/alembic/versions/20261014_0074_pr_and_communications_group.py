"""The group holding Events, Affiliations, Associates, Press & Media and Committee is named PR & Communications.

Revision ID: 20261014_0074
Revises: 20261014_0073
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0074"
down_revision = "20261014_0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)  # applies the rename (only while the group still has an older default name)
    finally:
        session.close()


def downgrade() -> None:
    pass
