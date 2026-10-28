"""The payer's address on a receipt.

Revision ID: 20261028_0107
Revises: 20261027_0106

receipts.payer_address: typed on the Receipt Entry form (filled from the member when one is picked). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261028_0107"
down_revision = "20261027_0106"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "payer_address" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")}:
        op.add_column("receipts", sa.Column("payer_address", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("receipts", "payer_address")
