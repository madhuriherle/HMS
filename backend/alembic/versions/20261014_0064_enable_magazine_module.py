"""Turn the Magazine module back on now that its screen is built.

Revision ID: 20261014_0064
Revises: 20261014_0063
Create Date: 2026-10-14

The Magazine module (subscriptions / delivery pauses / returns / label batches)
was switched off by migration 0032 because it had no screen. That tabbed screen
now exists at /dashboard/magazine, so:

* seed the Magazine sidebar page (parent = the existing ``magazines`` module,
  privilege ``magazines.read``),
* switch the ``magazines`` module (and any sub-modules) back on (status = true).

Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261014_0064"
down_revision = "20261014_0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages
        from models.users import Module

        seed_menu_pages(session)

        rows = session.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
        for row in rows:
            if row.code == "magazines" or row.code.startswith("magazines."):
                row.status = True
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        rows = session.query(Module).filter(Module.is_deleted == False).all()  # noqa: E712
        for row in rows:
            if row.code == "magazines" or row.code.startswith("magazines."):
                row.status = False
        session.commit()
    finally:
        session.close()
