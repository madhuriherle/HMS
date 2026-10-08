"""Enforce permissions.module_id as a real FK into modules.

Revision ID: 20260925_0009
Revises: 20260925_0008
Create Date: 2026-09-25

Adds permissions.module_id (nullable, FK -> modules.id) and backfills it by
matching the existing permissions.module string against modules.code. New
rows populate module_id going forward (services/permissions.seed_permissions
refuses to insert a permission for a module that isn't in the modules
master), so this migration only needs to catch up pre-existing rows.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260925_0009"
down_revision = "20260925_0008"
branch_labels = None
depends_on = None


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _columns(inspector, table: str) -> set:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _table_exists(inspector, "permissions") or not _table_exists(inspector, "modules"):
        return

    if "module_id" not in _columns(inspector, "permissions"):
        op.add_column("permissions", sa.Column("module_id", sa.BigInteger(), nullable=True))

    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("permissions")}
    if "fk_permissions_module" not in existing_fks:
        try:
            op.create_foreign_key(
                "fk_permissions_module", "permissions", "modules", ["module_id"], ["id"],
            )
        except Exception:
            pass  # constraint may already exist by another name

    # Backfill: match each permission's module string to a modules.code row.
    code_to_id = {
        row[1]: row[0]
        for row in bind.execute(sa.text("SELECT id, code FROM modules")).fetchall()
    }
    pending = bind.execute(
        sa.text("SELECT id, module FROM permissions WHERE module_id IS NULL")
    ).fetchall()
    for perm_id, module_code in pending:
        module_id = code_to_id.get(module_code)
        if module_id:
            bind.execute(
                sa.text("UPDATE permissions SET module_id = :module_id WHERE id = :id"),
                {"module_id": module_id, "id": perm_id},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not _table_exists(inspector, "permissions"):
        return
    try:
        op.drop_constraint("fk_permissions_module", "permissions", type_="foreignkey")
    except Exception:
        pass
    if "module_id" in _columns(inspector, "permissions"):
        op.drop_column("permissions", "module_id")
