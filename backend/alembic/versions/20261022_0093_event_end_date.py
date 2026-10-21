"""Optional end date on events (multi-day events).

Revision ID: 20261022_0093
Revises: 20261021_0092

events.end_date is empty for a one-day event. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261022_0093"
down_revision = "20261021_0092"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("events")}
    if "end_date" not in cols:
        op.add_column("events", sa.Column("end_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "end_date")
