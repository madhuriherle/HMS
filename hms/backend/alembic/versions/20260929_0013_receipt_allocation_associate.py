"""Associate payees on receipt allocations.

Revision ID: 20260929_0013
Revises: 20260926_0012
Create Date: 2026-09-29

Receipts can be paid by non-members (general donation, scholarship
contribution): receipt_allocations.associate_id maps those to the
engagements.associates master. Exactly one of member_id/associate_id is
set — enforced at the endpoint layer (SQLite cannot ADD COLUMN with a
CHECK constraint, so PostgreSQL parity would drift anyway).
"""

import sqlalchemy as sa
from alembic import op

revision = "20260929_0013"
down_revision = "20260926_0012"
branch_labels = None
depends_on = None


def _column_exists(inspector, table: str, column: str) -> bool:
    return column in {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "receipt_allocations" not in inspector.get_table_names():
        return
    if _column_exists(inspector, "receipt_allocations", "associate_id"):
        return
    op.add_column(
        "receipt_allocations",
        sa.Column("associate_id", sa.BigInteger(), sa.ForeignKey("associates.id"), nullable=True),
    )
    op.create_index("ix_receipt_allocations_associate_id", "receipt_allocations", ["associate_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "receipt_allocations" not in inspector.get_table_names():
        return
    if _column_exists(inspector, "receipt_allocations", "associate_id"):
        op.drop_index("ix_receipt_allocations_associate_id", table_name="receipt_allocations")
        op.drop_column("receipt_allocations", "associate_id")
