"""Receipt numbers per financial year (2026-27/0001).

Revision ID: 20261012_0036
Revises: 20261012_0035
Create Date: 2026-10-12

Adds receipts.financial_year (April-March, from receipt_date), back-fills it, and
makes the receipt number unique within a financial year instead of globally.
Existing receipt numbers are not changed. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0036"
down_revision = "20261012_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("receipts")}
    if "financial_year" not in cols:
        op.add_column("receipts", sa.Column("financial_year", sa.String(7), nullable=True))
    op.execute("""
        UPDATE receipts SET financial_year =
          CASE WHEN EXTRACT(MONTH FROM receipt_date) >= 4
               THEN EXTRACT(YEAR FROM receipt_date)::int || '-' || LPAD(((EXTRACT(YEAR FROM receipt_date)::int + 1) % 100)::text, 2, '0')
               ELSE (EXTRACT(YEAR FROM receipt_date)::int - 1) || '-' || LPAD((EXTRACT(YEAR FROM receipt_date)::int % 100)::text, 2, '0')
          END
        WHERE financial_year IS NULL
    """)
    op.alter_column("receipts", "financial_year", nullable=False)
    existing = {ix["name"] for ix in sa.inspect(bind).get_indexes("receipts")}
    if "uq_receipts_receipt_number_active" in existing:
        op.drop_index("uq_receipts_receipt_number_active", table_name="receipts")
    if "uq_receipts_fy_number_active" not in existing:
        op.create_index(
            "uq_receipts_fy_number_active", "receipts", ["financial_year", "receipt_number"], unique=True,
            postgresql_where=sa.text("is_deleted = false"),
        )


def downgrade() -> None:
    pass
