"""Events joins the Community group (renamed from "Affiliation, Associates & Press") as its first page.

Only the sidebar placement changes: every page keeps its own privilege, the Events page and its data are untouched.

Revision ID: 20261014_0073
Revises: 20261014_0072
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0073"
down_revision = "20261014_0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)  # applies the move, the rename and the new order
    finally:
        session.close()


def downgrade() -> None:
    pass
