"""Meeting PDF export log for applicants (member_meeting_exports).

Revision ID: 20261021_0092
Revises: 20261017_0091

Each row is one applicant on one exported meeting PDF (the day, and a reference shared by the rows of that PDF). A
member's approval_status may now also be REJECTED (Disagree in the meeting); no schema change is needed for it.
Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261021_0092"
down_revision = "20261017_0091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "member_meeting_exports" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "member_meeting_exports",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), sa.ForeignKey("members.id"), nullable=False),
        sa.Column("exported_on", sa.Date(), nullable=False),
        sa.Column("export_ref", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_member_meeting_exports_id", "member_meeting_exports", ["id"])
    op.create_index("ix_member_meeting_exports_member_id", "member_meeting_exports", ["member_id"])
    op.create_index("ix_member_meeting_exports_exported_on", "member_meeting_exports", ["exported_on"])


def downgrade() -> None:
    op.drop_table("member_meeting_exports")
