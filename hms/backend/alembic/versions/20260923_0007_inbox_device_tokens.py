"""In-app inbox + push device tokens.

Revision ID: 20260923_0007
Revises: 20260923_0006
Create Date: 2026-09-23

Adds app_notifications (personal rows with user_id, broadcasts with NULL),
app_notification_reads (per-user read tracking, no broadcast fan-out) and
user_device_tokens (FCM/APNS push tokens per user). All new tables, so the
migration is safe on existing data.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0007"
down_revision = "20260923_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    def _audit_columns():
        # Mirrors models.base.AuditMixin exactly.
        return [
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        ]

    op.create_table(
        "app_notifications",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True, index=True),
        sa.Column("member_id", sa.BigInteger(), sa.ForeignKey("members.id"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("source", sa.String(50), nullable=False, server_default="MANUAL"),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        *_audit_columns(),
    )
    op.create_table(
        "app_notification_reads",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("notification_id", sa.BigInteger(), sa.ForeignKey("app_notifications.id"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        *_audit_columns(),
    )
    op.create_index(
        "uq_app_notification_reads_active",
        "app_notification_reads",
        ["notification_id", "user_id"],
        unique=True,
        postgresql_where=sa.text("is_deleted = false"),
        sqlite_where=sa.text("is_deleted = false"),
    )
    op.create_table(
        "user_device_tokens",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("device_token", sa.Text(), nullable=False),
        sa.Column("platform", sa.String(10), nullable=False, server_default="FCM"),
        sa.Column("device_name", sa.String(150), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        *_audit_columns(),
    )
    op.create_index(
        "uq_user_device_tokens_active",
        "user_device_tokens",
        ["user_id", "device_token"],
        unique=True,
        postgresql_where=sa.text("is_deleted = false"),
        sqlite_where=sa.text("is_deleted = false"),
    )


def downgrade() -> None:
    op.drop_index("uq_user_device_tokens_active", table_name="user_device_tokens")
    op.drop_table("user_device_tokens")
    op.drop_index("uq_app_notification_reads_active", table_name="app_notification_reads")
    op.drop_table("app_notification_reads")
    op.drop_table("app_notifications")
