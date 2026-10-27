"""Take out the same / different person answers (the office deletes a duplicate and fixes the kept record instead).

Revision ID: 20261027_0106
Revises: 20261027_0105

Drops member_duplicate_reviews, made in 0105. Idempotent.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261027_0106"
down_revision = "20261027_0105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "member_duplicate_reviews" in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table("member_duplicate_reviews")


def downgrade() -> None:
    pass
