"""Add event participant type.

Revision ID: 20260923_0004
Revises: 20260923_0003
Create Date: 2026-09-23

Adds event_participants.participant_type so guests and honoured persons are
distinguished (defaults to GUEST for existing rows).
"""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0004"
down_revision = "20260923_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "event_participants" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("event_participants")}
    if "participant_type" in existing:
        return
    op.add_column(
        "event_participants",
        sa.Column("participant_type", sa.String(20), nullable=False, server_default="GUEST"),
    )
    # Hand default ownership back to the ORM.
    op.alter_column("event_participants", "participant_type", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "event_participants" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("event_participants")}
    if "participant_type" in existing:
        op.drop_column("event_participants", "participant_type")
