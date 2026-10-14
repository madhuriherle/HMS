"""Magazine has two sidebar pages: Subscriptions (with Pause, Resume and Return on each row) and Labels & Delivery.

The separate Pauses & Returns page is retired; its address redirects to Subscriptions. Same privilege as before.

Revision ID: 20261014_0076
Revises: 20261014_0075
"""
from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0076"
down_revision = "20261014_0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        seed_menu_pages(session)  # Labels & Delivery moves up to place 2
        for row in session.query(Module).filter(Module.code == "magazines.pauses_returns", Module.is_deleted == False).all():  # noqa: E712
            row.is_deleted = True
            row.status = False
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
