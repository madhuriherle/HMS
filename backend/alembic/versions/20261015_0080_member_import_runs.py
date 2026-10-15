"""History of the bulk member imports: who imported which file, when, and the result.

Revision ID: 20261015_0080
Revises: 20261015_0079
"""
import sqlalchemy as sa
from alembic import op

revision = "20261015_0080"
down_revision = "20261015_0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "member_import_runs" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "member_import_runs",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("run_id", sa.String(40), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=True),
        sa.Column("total_rows", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("processed_rows", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("success_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("skip_duplicates", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("skipped", sa.JSON, nullable=True),
        sa.Column("warning_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("warnings", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.BigInteger, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger, nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger, nullable=True),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_member_import_runs_id", "member_import_runs", ["id"])
    op.create_index("uq_member_import_runs_run_id", "member_import_runs", ["run_id"], unique=True)


def downgrade() -> None:
    op.drop_table("member_import_runs")
