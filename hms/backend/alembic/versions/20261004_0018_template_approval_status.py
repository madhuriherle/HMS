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
    op.add_column("notification_templates", sa.Column("provider_approval_status", sa.String(20), nullable=True))
    op.add_column("notification_templates", sa.Column("provider_approval_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notification_templates", sa.Column("provider_approval_note", sa.Text(), nullable=True))
    op.create_index(
        "ix_notification_templates_provider_approval_status",
        "notification_templates",
        ["provider_approval_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_notification_templates_provider_approval_status",
        table_name="notification_templates",
    )
    op.drop_column("notification_templates", "provider_approval_note")
    op.drop_column("notification_templates", "provider_approval_synced_at")
    op.drop_column("notification_templates", "provider_approval_status")
