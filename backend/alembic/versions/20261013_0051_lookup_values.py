"""Fixed lists the screens used to keep in their own code, as a table.

Revision ID: 20261013_0051
Revises: 20261013_0050
Create Date: 2026-10-13

lookup_values holds child relations, YES/NO, receipt statuses, organisation types, the Activity Logs filters and
the country calling codes. GET /meta/lists serves them. A list is filled only while it has no rows. Idempotent.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261013_0051"
down_revision = "20261013_0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "lookup_values" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "lookup_values",
            sa.Column("id", sa.BigInteger, primary_key=True),
            sa.Column("list_code", sa.String(40), nullable=False),
            sa.Column("code", sa.String(60), nullable=False),
            sa.Column("label", sa.String(150), nullable=False),
            sa.Column("extra", sa.String(60), nullable=True),
            sa.Column("sort_order", sa.BigInteger, nullable=False, server_default="0"),
            sa.Column("status", sa.Boolean, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.BigInteger, nullable=True),
            sa.Column("updated_by", sa.BigInteger, nullable=True),
            sa.Column("is_deleted", sa.Boolean, server_default=sa.false(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger, nullable=True),
        )
        op.create_index("ix_lookup_values_id", "lookup_values", ["id"])
        op.create_index("ix_lookup_values_list_code", "lookup_values", ["list_code"])
        op.create_index(
            "uq_lookup_values_list_code_active", "lookup_values", ["list_code", "code"], unique=True,
            postgresql_where=sa.text("is_deleted = false"),
        )
    session = Session(bind=bind)
    try:
        from db.seed_defaults import seed_lookup_values

        seed_lookup_values(session)
    finally:
        session.close()


def downgrade() -> None:
    op.drop_table("lookup_values")
