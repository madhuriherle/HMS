"""Native address and designation on a member.

Revision ID: 20261026_0103
Revises: 20261026_0102

members.designation, members.native_address (one free-text box) and members.native_same_as_current. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261026_0103"
down_revision = "20261026_0102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("members")}
    if "designation" not in have:
        op.add_column("members", sa.Column("designation", sa.String(150), nullable=True))
    if "native_address" not in have:
        op.add_column("members", sa.Column("native_address", sa.Text(), nullable=True))
    if "native_same_as_current" not in have:
        op.add_column("members", sa.Column("native_same_as_current", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("members", "native_same_as_current")
    op.drop_column("members", "native_address")
    op.drop_column("members", "designation")
