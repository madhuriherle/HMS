"""Callers' answers on members that look alike.

Revision ID: 20261027_0105
Revises: 20261027_0104

member_duplicate_reviews: one row per pair (lower member id first), decision SAME or DIFFERENT. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261027_0105"
down_revision = "20261027_0104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "member_duplicate_reviews" in insp.get_table_names():
        return
    op.create_table(
        "member_duplicate_reviews",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), sa.ForeignKey("members.id"), nullable=False),
        sa.Column("other_member_id", sa.BigInteger(), sa.ForeignKey("members.id"), nullable=False),
        sa.Column("decision", sa.String(12), nullable=False),
        sa.Column("reviewed_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_member_duplicate_reviews_member_id", "member_duplicate_reviews", ["member_id"])
    op.create_index("ix_member_duplicate_reviews_other_member_id", "member_duplicate_reviews", ["other_member_id"])
    op.create_index("uq_member_duplicate_reviews_pair", "member_duplicate_reviews", ["member_id", "other_member_id"], unique=True,
                    postgresql_where=sa.text("is_deleted = false"), sqlite_where=sa.text("is_deleted = false"))


def downgrade() -> None:
    op.drop_table("member_duplicate_reviews")
