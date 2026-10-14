"""Add magazine_delivery_address to members table.

Revision ID: 20261014_0065
Revises: 20261014_0064
Create Date: 2026-10-14

Stores the member's distinct magazine delivery address when different from
their communication address. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261014_0065"
down_revision = "20261014_0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("members")}
    if "magazine_delivery_address" not in existing:
        op.add_column("members", sa.Column("magazine_delivery_address", sa.Text(), nullable=True))


def downgrade() -> None:
    # Additive; dropping the column in production could destroy delivery data.
    pass
