"""Receipt lines: particular id / name and line number on receipt_items.

Revision ID: 20261012_0037
Revises: 20261012_0036
Create Date: 2026-10-12

One receipt can carry many particulars (hostel deposit + building donation + ...).
receipt_items already holds one row per line; it now also records which
particular the line is for, a name snapshot and the line order. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0037"
down_revision = "20261012_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("receipt_items")}
    if "particular_id" not in cols:
        op.add_column("receipt_items", sa.Column("particular_id", sa.BigInteger(), sa.ForeignKey("particulars.id"), nullable=True))
    if "particular_name" not in cols:
        op.add_column("receipt_items", sa.Column("particular_name", sa.String(150), nullable=True))
    if "line_no" not in cols:
        op.add_column("receipt_items", sa.Column("line_no", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE receipt_items i SET line_no = r.rn FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY receipt_id ORDER BY id) AS rn FROM receipt_items
        ) r WHERE i.id = r.id AND i.line_no IS NULL
    """)


def downgrade() -> None:
    pass
