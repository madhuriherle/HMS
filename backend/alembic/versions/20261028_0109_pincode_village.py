"""A pincode points at the village it is named after.

Revision ID: 20261028_0109
Revises: 20261028_0108

postal_codes.village_id (nullable, to villages). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261028_0109"
down_revision = "20261028_0108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "village_id" not in {c["name"] for c in insp.get_columns("postal_codes")}:
        op.add_column("postal_codes", sa.Column("village_id", sa.BigInteger(), sa.ForeignKey("villages.id"), nullable=True))
        op.create_index("ix_postal_codes_village_id", "postal_codes", ["village_id"])


def downgrade() -> None:
    op.drop_index("ix_postal_codes_village_id", table_name="postal_codes")
    op.drop_column("postal_codes", "village_id")
