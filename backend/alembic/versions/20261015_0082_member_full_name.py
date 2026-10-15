"""Members keep the Full Name as typed (members.full_name_en); first / middle / last stay in step with it.

Revision ID: 20261015_0082
Revises: 20261015_0081

Existing rows are filled from their first / middle / last name.
"""
import sqlalchemy as sa
from alembic import op

revision = "20261015_0082"
down_revision = "20261015_0081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("members")}
    if "full_name_en" not in cols:
        op.add_column("members", sa.Column("full_name_en", sa.String(250), nullable=True))
        op.create_index("ix_members_full_name_en", "members", ["full_name_en"])
    op.execute(sa.text(
        "UPDATE members SET full_name_en = TRIM(first_name_en || COALESCE(' ' || middle_name_en, '') || COALESCE(' ' || last_name_en, '')) "
        "WHERE full_name_en IS NULL"
    ))


def downgrade() -> None:
    op.drop_index("ix_members_full_name_en", table_name="members")
    op.drop_column("members", "full_name_en")
