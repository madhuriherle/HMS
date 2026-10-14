"""Magazine, Reports and Notifications get one sidebar page per section instead of one page with tab rows.

The old single pages are retired and the new ones are seeded. Every new page opens with the same privilege as
before (magazines.read / reports.read / notifications.read), so no role loses or gains access.

Revision ID: 20261014_0071
Revises: 20261014_0070
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0071"
down_revision = "20261014_0070"
branch_labels = None
depends_on = None

OLD_PAGES = ("magazines.management", "reports.management", "notifications.management")


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        seed_menu_pages(session)
        for row in session.query(Module).filter(Module.code.in_(OLD_PAGES), Module.is_deleted == False).all():  # noqa: E712
            row.is_deleted = True
            row.status = False
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
