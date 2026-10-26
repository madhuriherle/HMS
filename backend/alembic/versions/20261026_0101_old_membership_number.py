"""The old register's numbers on a member.

Revision ID: 20261026_0101
Revises: 20261026_0100

members.old_membership_number (the old CusNo, indexed) and members.legacy_ref_number (CusNoOld). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261026_0101"
down_revision = "20261026_0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    have = {c["name"] for c in insp.get_columns("members")}
    if "old_membership_number" not in have:
        op.add_column("members", sa.Column("old_membership_number", sa.String(30), nullable=True))
    if "legacy_ref_number" not in have:
        op.add_column("members", sa.Column("legacy_ref_number", sa.String(30), nullable=True))
    if "ix_members_old_membership_number" not in {i["name"] for i in insp.get_indexes("members")}:
        op.create_index("ix_members_old_membership_number", "members", ["old_membership_number"])


def downgrade() -> None:
    op.drop_index("ix_members_old_membership_number", table_name="members")
    op.drop_column("members", "legacy_ref_number")
    op.drop_column("members", "old_membership_number")
