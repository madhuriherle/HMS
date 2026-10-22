"""Old (dummy) receipts.

Revision ID: 20261022_0094
Revises: 20261022_0093

receipts.is_old_receipt marks an old receipt that was never entered and is added afterwards. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261022_0094"
down_revision = "20261022_0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("receipts")}
    if "is_old_receipt" not in cols:
        op.add_column("receipts", sa.Column("is_old_receipt", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("receipts", "is_old_receipt")
