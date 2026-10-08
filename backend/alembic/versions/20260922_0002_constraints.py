"""Add unique active-row indexes and the user_type check constraint.

Revision ID: 20260922_0002
Revises: 20260921_0001
Create Date: 2026-09-22

The baseline revision runs ``Base.metadata.create_all``, which already creates
everything below on a fresh database — each step is guarded with an inspector
check so this revision only has to work on databases created before these
constraints existed.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260922_0002"
down_revision = "20260921_0001"
branch_labels = None
depends_on = None

INDEXES = [
    # (index_name, table_name, [columns])
    ("uq_role_permissions_active", "role_permissions", ["role_id", "permission_id"]),
    ("uq_user_roles_active", "user_roles", ["user_id", "role_id"]),
    ("uq_members_mobile_active", "members", ["mobile"]),
]

CHECK_CONSTRAINT = ("ck_users_user_type", "users")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for name, table, columns in INDEXES:
        if table not in inspector.get_table_names():
            continue
        existing = {ix["name"] for ix in inspector.get_indexes(table)}
        if name in existing:
            continue
        op.create_index(
            name,
            table,
            columns,
            unique=True,
            postgresql_where=sa.text("is_deleted = false"),
            sqlite_where=sa.text("is_deleted = false"),
        )

    cname, ctable = CHECK_CONSTRAINT
    if ctable not in inspector.get_table_names():
        return
    try:
        existing = {c["name"] for c in inspector.get_check_constraints(ctable)}
    except NotImplementedError:  # pragma: no cover - dialect without support
        existing = set()
    if cname not in existing:
        op.create_check_constraint(
            cname,
            ctable,
            "user_type IN ('SUPERADMIN', 'ADMIN', 'STAFF', 'MEMBER')",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    cname, ctable = CHECK_CONSTRAINT
    if ctable in inspector.get_table_names():
        try:
            op.drop_constraint(cname, ctable, type_="check")
        except Exception:  # SQLite cannot drop CHECK constraints
            pass

    for name, table, _ in reversed(INDEXES):
        if table not in inspector.get_table_names():
            continue
        existing = {ix["name"] for ix in inspector.get_indexes(table)}
        if name in existing:
            op.drop_index(name, table_name=table)
