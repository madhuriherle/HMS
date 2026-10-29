"""A guardian's name is kept apart from father / husband.

Revision ID: 20261029_0110
Revises: 20261028_0109

members.guardian_name (nullable). Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261029_0110"
down_revision = "20261028_0109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "guardian_name" not in {c["name"] for c in insp.get_columns("members")}:
        op.add_column("members", sa.Column("guardian_name", sa.String(length=150), nullable=True))


def downgrade() -> None:
    op.drop_column("members", "guardian_name")
