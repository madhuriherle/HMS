"""Track WhatsApp provider template approval status.

Revision ID: 20261004_0018
Revises: 20261003_0017
Create Date: 2026-10-04

Adds three columns to notification_templates so the web panel can show (and
filter) which WhatsApp templates the provider has approved — the spec asks for
"sending bulk WhatsApp by selecting the approved template". Columns are NULL
for templates that were never submitted to the provider.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261004_0018"
down_revision = "20261003_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migration 0001 creates the schema from current ORM metadata, so on a
    # fresh database these columns may already exist — add only the missing
    # ones instead of failing on DuplicateColumn.
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("notification_templates")}
    if "provider_approval_status" not in existing:
        op.add_column("notification_templates", sa.Column("provider_approval_status", sa.String(20), nullable=True))
    if "provider_approval_synced_at" not in existing:
        op.add_column("notification_templates", sa.Column("provider_approval_synced_at", sa.DateTime(timezone=True), nullable=True))
    if "provider_approval_note" not in existing:
        op.add_column("notification_templates", sa.Column("provider_approval_note", sa.Text(), nullable=True))
    if "provider_approval_status" not in existing:
        op.create_index(
            "ix_notification_templates_provider_approval_status",
            "notification_templates",
            ["provider_approval_status"],
        )


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("notification_templates")}
    if "provider_approval_status" in existing:
        op.drop_index(
            "ix_notification_templates_provider_approval_status",
            table_name="notification_templates",
        )
        op.drop_column("notification_templates", "provider_approval_status")
    if "provider_approval_synced_at" in existing:
        op.drop_column("notification_templates", "provider_approval_synced_at")
    if "provider_approval_note" in existing:
        op.drop_column("notification_templates", "provider_approval_note")
