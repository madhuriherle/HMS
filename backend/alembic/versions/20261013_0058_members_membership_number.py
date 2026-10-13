"""members.member_code is renamed membership_number (it is the member's one permanent membership number).

Revision ID: 20261013_0058
Revises: 20261013_0057
Create Date: 2026-10-13

Only the column and its unique index are renamed; every number stays as it is. Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261013_0058"
down_revision = "20261013_0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    insp = sa.inspect(bind)
    if "members" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("members")}
    if "member_code" in cols and "membership_number" not in cols:
        op.alter_column("members", "member_code", new_column_name="membership_number")
    names = {i["name"] for i in sa.inspect(bind).get_indexes("members")}
    if "uq_members_member_code_active" in names:
        op.execute("ALTER INDEX uq_members_member_code_active RENAME TO uq_members_membership_number_active")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.alter_column("members", "membership_number", new_column_name="member_code")
    op.execute("ALTER INDEX IF EXISTS uq_members_membership_number_active RENAME TO uq_members_member_code_active")
