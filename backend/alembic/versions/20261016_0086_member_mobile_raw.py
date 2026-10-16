"""Members keep the unusable mobile number a legacy import could not use (members.mobile_raw).

Revision ID: 20261016_0086
Revises: 20261016_0085
"""
import sqlalchemy as sa
from alembic import op

revision = "20261016_0086"
down_revision = "20261016_0085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "mobile_raw" not in {c["name"] for c in sa.inspect(bind).get_columns("members")}:
        op.add_column("members", sa.Column("mobile_raw", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("members", "mobile_raw")
