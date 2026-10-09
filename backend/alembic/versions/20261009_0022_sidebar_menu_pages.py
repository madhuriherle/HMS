"""Sidebar pages live in the modules table.

Revision ID: 20261009_0022
Revises: 20261009_0021
Create Date: 2026-10-09

Adds modules.permission_code (the privilege that shows a menu page) and
inserts one module row per sidebar page, so the left menu is read from the
database (GET /users/modules/menu) instead of being hardcoded in the front-end.
Idempotent: a fresh database built from current ORM metadata already has the
column.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261009_0022"
down_revision = "20261009_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "permission_code" not in {c["name"] for c in insp.get_columns("modules")}:
        op.add_column("modules", sa.Column("permission_code", sa.String(120), nullable=True))

    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_menu_pages

        seed_menu_pages(session)
    finally:
        session.close()


def downgrade() -> None:
    # Keeps the page rows; only the gate column is removed.
    insp = sa.inspect(op.get_bind())
    if "permission_code" in {c["name"] for c in insp.get_columns("modules")}:
        op.drop_column("modules", "permission_code")
