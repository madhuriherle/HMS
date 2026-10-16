"""Notification campaigns keep the channel they were made for (WhatsApp, SMS, Email ...).

Revision ID: 20261016_0084
Revises: 20261015_0083

Existing campaigns are WhatsApp, which is what they were sent through until now.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261016_0084"
down_revision = "20261015_0083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("notification_campaigns")}
    if "channel" not in cols:
        op.add_column("notification_campaigns", sa.Column("channel", sa.String(30), nullable=True, server_default="WHATSAPP"))
    op.execute(sa.text("UPDATE notification_campaigns SET channel = 'WHATSAPP' WHERE channel IS NULL"))


def downgrade() -> None:
    op.drop_column("notification_campaigns", "channel")
