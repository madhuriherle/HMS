"""Bank master for receipt-entry payment dropdown.

Revision ID: 20261005_0020
Revises: 20261005_0019
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261005_0020"
down_revision = "20261005_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "banks" not in insp.get_table_names():
        op.create_table(
            "banks",
            sa.Column("id", sa.BigInteger(), primary_key=True),
            sa.Column("code", sa.String(50), nullable=False),
            sa.Column("name_en", sa.String(100), nullable=False),
            sa.Column("name_kn", sa.String(150), nullable=True),
            sa.Column("account_number", sa.String(50), nullable=True),
            sa.Column("branch_name", sa.String(100), nullable=True),
            sa.Column("ifsc_code", sa.String(20), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.UniqueConstraint("code"),
        )
        op.create_index("ix_banks_id", "banks", ["id"])

    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_banks

        seed_banks(session)
    finally:
        session.close()


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "banks" not in insp.get_table_names():
        return
    op.drop_index("ix_banks_id", table_name="banks")
    op.drop_table("banks")
