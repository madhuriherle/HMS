"""receipts: payer_pan / payer_mobile / payer_membership_no as real columns.

Revision ID: 20261012_0044
Revises: 20261012_0043
Create Date: 2026-10-12

Receipt Entry collects PAN, mobile and membership number; they used to be dropped (member linked)
or squeezed into the notes text (not linked). Old receipts keep their notes; new ones fill these columns.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0044"
down_revision = "20261012_0043"
branch_labels = None
depends_on = None

COLUMNS = [("payer_pan", 10), ("payer_mobile", 20), ("payer_membership_no", 30)]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    have = {c["name"] for c in sa.inspect(bind).get_columns("receipts")}
    for name, size in COLUMNS:
        if name not in have:
            op.add_column("receipts", sa.Column(name, sa.String(size), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for name, _ in COLUMNS:
            op.drop_column("receipts", name)
