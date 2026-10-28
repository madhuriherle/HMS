"""Villages of the government directory, each with its taluk.

Revision ID: 20261028_0108
Revises: 20261028_0107

villages: state, district, taluk, name (English / Kannada), the directory's code. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261028_0108"
down_revision = "20261028_0107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "villages" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "villages",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("state_id", sa.BigInteger(), sa.ForeignKey("states.id"), nullable=False),
        sa.Column("district_id", sa.BigInteger(), sa.ForeignKey("districts.id"), nullable=False),
        sa.Column("taluk_id", sa.BigInteger(), sa.ForeignKey("taluks.id"), nullable=False),
        sa.Column("name_en", sa.String(150), nullable=False),
        sa.Column("name_kn", sa.String(200), nullable=True),
        sa.Column("lgd_code", sa.String(20), nullable=True),
        sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_villages_taluk_id", "villages", ["taluk_id"])
    op.create_index("ix_villages_name_en", "villages", ["name_en"])
    op.create_index("ix_villages_lgd_code", "villages", ["lgd_code"])


def downgrade() -> None:
    op.drop_table("villages")
