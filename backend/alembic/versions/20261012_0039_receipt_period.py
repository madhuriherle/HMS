"""Optional period (from/to date, from/to time) on receipts.

Revision ID: 20261012_0039
Revises: 20261012_0038
Create Date: 2026-10-12

For donations / sevas that cover a date or time range. All columns nullable. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0039"
down_revision = "20261012_0038"
branch_labels = None
depends_on = None

COLUMNS = (
    ("period_from_date", sa.Date()),
    ("period_to_date", sa.Date()),
    ("period_from_time", sa.Time()),
    ("period_to_time", sa.Time()),
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    have = {c["name"] for c in sa.inspect(bind).get_columns("receipts")}
    for name, kind in COLUMNS:
        if name not in have:
            op.add_column("receipts", sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name, _ in COLUMNS:
        op.drop_column("receipts", name)
