"""receipts.receipt_status: UNASSIGNED | ASSIGNED | APPROVED | CANCELLED.

Revision ID: 20261012_0040
Revises: 20261012_0039
Create Date: 2026-10-12

One visible status per receipt, stored as words. Back-filled from the existing data:
cancelled receipts (payment_status CANCELLED) -> CANCELLED; mapped to an approved member -> APPROVED;
mapped otherwise -> ASSIGNED; the rest -> UNASSIGNED. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0040"
down_revision = "20261012_0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    have = {c["name"] for c in sa.inspect(bind).get_columns("receipts")}
    if "receipt_status" not in have:
        op.add_column("receipts", sa.Column("receipt_status", sa.String(20), nullable=False, server_default="UNASSIGNED"))
    op.execute("""
        UPDATE receipts r SET receipt_status = CASE
          WHEN r.payment_status = 'CANCELLED' THEN 'CANCELLED'
          WHEN EXISTS (
            SELECT 1 FROM receipt_allocations a JOIN members m ON m.id = a.member_id
            WHERE a.receipt_id = r.id AND a.is_deleted = false AND m.is_deleted = false AND m.approval_status = 'APPROVED'
          ) THEN 'APPROVED'
          WHEN EXISTS (
            SELECT 1 FROM receipt_allocations a WHERE a.receipt_id = r.id AND a.is_deleted = false
          ) THEN 'ASSIGNED'
          ELSE 'UNASSIGNED' END
    """)
    op.create_index("ix_receipts_receipt_status", "receipts", ["receipt_status"], if_not_exists=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.drop_index("ix_receipts_receipt_status", table_name="receipts", if_exists=True)
    op.drop_column("receipts", "receipt_status")
