"""Per-grant approval gate on role_permissions.

Revision ID: 20260925_0010
Revises: 20260925_0009
Create Date: 2026-09-25

Adds role_permissions.requires_approval (bool, default false). A role's
grant of a permission can be flagged so that holders don't act directly —
the action auto-files an approval request instead (see
api.deps.permission_requires_approval). The same permission code can be
free for one role and gated for another; no global rank/hierarchy needed.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260925_0010"
down_revision = "20260925_0009"
branch_labels = None
depends_on = None


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _columns(inspector, table: str) -> set:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _table_exists(inspector, "role_permissions"):
        return
    if "requires_approval" not in _columns(inspector, "role_permissions"):
        op.add_column(
            "role_permissions",
            sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
        op.alter_column("role_permissions", "requires_approval", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _table_exists(inspector, "role_permissions") and "requires_approval" in _columns(inspector, "role_permissions"):
        op.drop_column("role_permissions", "requires_approval")
