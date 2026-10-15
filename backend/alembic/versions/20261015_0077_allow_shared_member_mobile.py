"""Allow shared member mobile numbers (family members can share the same mobile).

Drops the unique index uq_members_mobile_active so family members can share mobile numbers.

Revision ID: 20261015_0077
Revises: 20261014_0076
"""
from alembic import op
import sqlalchemy as sa

revision = "20261015_0077"
down_revision = "20261014_0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "members" in inspector.get_table_names():
        indexes = {ix["name"] for ix in inspector.get_indexes("members")}
        if "uq_members_mobile_active" in indexes:
            op.drop_index("uq_members_mobile_active", table_name="members")
        if "ix_members_mobile_active" not in indexes:
            op.create_index(
                "ix_members_mobile_active",
                "members",
                ["mobile"],
                unique=False,
                postgresql_where=sa.text("is_deleted = false"),
                sqlite_where=sa.text("is_deleted = false"),
            )


def downgrade() -> None:
    pass
