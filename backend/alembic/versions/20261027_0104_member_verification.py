"""Phone verification of members.

Revision ID: 20261027_0104
Revises: 20261026_0103

members.verification_status / verified_at / verified_by / verification_remark and the member_verification_logs
table (one row per call). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261027_0104"
down_revision = "20261026_0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    have = {c["name"] for c in insp.get_columns("members")}
    if "verification_status" not in have:
        op.add_column("members", sa.Column("verification_status", sa.String(20), nullable=False, server_default="NOT_VERIFIED"))
    if "verified_at" not in have:
        op.add_column("members", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
    if "verified_by" not in have:
        op.add_column("members", sa.Column("verified_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True))
    if "verification_remark" not in have:
        op.add_column("members", sa.Column("verification_remark", sa.Text(), nullable=True))
    if "member_verification_logs" not in insp.get_table_names():
        op.create_table(
            "member_verification_logs",
            sa.Column("id", sa.BigInteger(), primary_key=True),
            sa.Column("member_id", sa.BigInteger(), sa.ForeignKey("members.id"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("remark", sa.Text(), nullable=True),
            sa.Column("called_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("called_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index("ix_member_verification_logs_member_id", "member_verification_logs", ["member_id"])


def downgrade() -> None:
    op.drop_table("member_verification_logs")
    for c in ("verification_remark", "verified_by", "verified_at", "verification_status"):
        op.drop_column("members", c)
