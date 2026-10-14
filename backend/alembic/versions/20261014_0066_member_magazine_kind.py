"""How a member wants the magazine: a posted copy, an e-copy by email, or both.

Revision ID: 20261014_0066
Revises: 20261014_0065
"""
from alembic import op
import sqlalchemy as sa

revision = "20261014_0066"
down_revision = "20261014_0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("members")}
    if "magazine_kind" not in existing:
        op.add_column("members", sa.Column("magazine_kind", sa.String(10), nullable=True))
    if "magazine_email" not in existing:
        op.add_column("members", sa.Column("magazine_email", sa.String(191), nullable=True))
    # everyone who already takes the magazine gets the posted copy, as before
    op.execute("UPDATE members SET magazine_kind = 'PHYSICAL' WHERE magazine_needed = true AND magazine_kind IS NULL")


def downgrade() -> None:
    # Additive; dropping the columns in production could destroy delivery data.
    pass
