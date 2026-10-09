"""Hide sidebar items that open no screen (System, Users > Privileges).

Revision ID: 20261009_0034
Revises: 20261009_0033
Create Date: 2026-10-09

Both rows had a route although there is no page behind it (migration 0033 even put the Privileges route
back), so the Super Admin saw dead links. Their routes are removed; the privileges themselves are untouched.
Idempotent.
"""

from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0034"
down_revision = "20261009_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    try:
        from models.users import Module

        for code in ("system", "users.privileges"):
            row = session.query(Module).filter(Module.code == code, Module.is_deleted == False).first()  # noqa: E712
            if row and row.route:
                row.route = None
        session.commit()
    finally:
        session.close()


def downgrade() -> None:
    pass
