"""Receipts: bank account the payment went into.

Revision ID: 20261009_0028
Revises: 20261009_0027
Create Date: 2026-10-09

Receipt Entry lets the office pick the bank account for an online / cheque
payment; until now that choice was not stored. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0028"
down_revision = "20261009_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")}
    if "bank_account" not in cols:
        op.add_column("receipts", sa.Column("bank_account", sa.String(150), nullable=True))


def downgrade() -> None:
    pass
