"""The magazine has two choices only (physical or e-copy): anyone saved as BOTH becomes PHYSICAL.

Revision ID: 20261015_0078
Revises: 20261015_0077
"""
from alembic import op
import sqlalchemy as sa

revision = "20261015_0078"
down_revision = "20261015_0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("UPDATE members SET magazine_kind = 'PHYSICAL' WHERE magazine_kind = 'BOTH'"))


def downgrade() -> None:
    pass
