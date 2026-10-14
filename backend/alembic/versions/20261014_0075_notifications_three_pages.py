"""Notifications has three sidebar pages: Send Messages (Campaigns, with Quick Send as a popup), Templates, System Inbox.

The separate Quick Send page is retired; its address redirects to Send Messages. Same privilege as before.

Revision ID: 20261014_0075
Revises: 20261014_0074
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0075"
down_revision = "20261014_0074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        seed_menu_pages(session)  # renames Campaigns -> Send Messages and fixes the order
        for row in session.query(Module).filter(Module.code == "notifications.quick_send", Module.is_deleted == False).all():  # noqa: E712
            row.is_deleted = True
            row.status = False
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
