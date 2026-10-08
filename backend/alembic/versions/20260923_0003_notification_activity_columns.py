"""Add notification and activity columns.

Revision ID: 20260923_0003
Revises: 20260922_0002
Create Date: 2026-09-23

Adds: notification_templates.purpose, notification_campaigns.source /
member_filters / total_recipients, notification_recipients.variables,
member_activity_logs.user_id. All columns are nullable or defaulted so the
migration is safe on existing data.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0003"
down_revision = "20260922_0002"
branch_labels = None
depends_on = None

COLUMNS = [
    # (table, column, server_default)
    ("notification_templates", "purpose", "'GENERAL'"),
    ("notification_campaigns", "source", "'MEMBERS'"),
    ("notification_campaigns", "total_recipients", "0"),
    ("notification_recipients", "variables", None),
    ("member_activity_logs", "user_id", None),
]

JSON_COLUMNS = {"variables"}
JSONB_TABLES = {"notification_recipients"}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table, column, default in COLUMNS:
        if table not in existing_tables:
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            continue
        col_type = (
            sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")
            if column in JSON_COLUMNS
            else sa.BigInteger() if column == "user_id" else sa.String(50)
        )
        op.add_column(table, sa.Column(column, col_type, nullable=True,
                                       server_default=sa.text(default) if default else None))
        if default:
            # Keep the ORM default as the single source of truth going forward.
            op.alter_column(table, column, server_default=None)

    if "member_activity_logs" in existing_tables:
        existing = {c["name"] for c in inspector.get_columns("member_activity_logs")}
        if "user_id" in existing:
            op.create_foreign_key(
                "fk_member_activity_logs_user_id",
                "member_activity_logs", "users",
                ["user_id"], ["id"],
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "member_activity_logs" in existing_tables:
        existing = {c["name"] for c in inspector.get_columns("member_activity_logs")}
        if "user_id" in existing:
            try:
                op.drop_constraint("fk_member_activity_logs_user_id", "member_activity_logs", type_="foreignkey")
            except Exception:
                pass
            op.drop_column("member_activity_logs", "user_id")

    for table, column, _ in reversed(COLUMNS):
        if table not in existing_tables:
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing and column != "user_id":
            op.drop_column(table, column)
