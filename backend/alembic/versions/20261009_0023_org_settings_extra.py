"""Organisation settings: JSON column for screen fields without a column.

Revision ID: 20261009_0023
Revises: 20261009_0022
Create Date: 2026-10-09

The Settings screen has more fields than organisation_settings has columns
(organisation type, extra contacts, working hours, notification toggles...).
They are stored in one JSON column so nothing lives in the browser.
Idempotent: a fresh database built from current ORM metadata already has it.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0023"
down_revision = "20261009_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("organisation_settings")}
    if "extra" not in cols:
        op.add_column("organisation_settings", sa.Column("extra", sa.JSON(), nullable=True))


def downgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("organisation_settings")}
    if "extra" in cols:
        op.drop_column("organisation_settings", "extra")
