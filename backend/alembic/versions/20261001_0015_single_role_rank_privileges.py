"""One role per user, role ranks, module tree, read/write/delete privileges.

Revision ID: 20261001_0015
Revises: 20260929_0014
Create Date: 2026-10-01

Brings users / roles / privileges in line with the Anegudde inventory system:

* users.role_id (exactly one role per user) + users.security_stamp;
  user_roles is migrated into role_id and dropped;
* roles.rank_level / is_all_access / module_id;
* modules become a tree (parent_id, opens_module_id, route, icon,
  display_order, min_rank_level);
* permissions.status; privilege codes move from <module>.create|update|delete
  to <module>.read|write|delete (users.* split into users.management.*,
  roles.*, users.privileges.*). Existing role grants are carried over:
  create/update -> write, and any role that could write/delete a module
  keeps list access via <module>.read.

The default modules / privileges / roles come from db/seed_defaults.py and,
once seeded, live in their tables (managed by Rank 1 through the API).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261001_0015"
down_revision = "20260929_0014"
branch_labels = None
depends_on = None

WRITE_MODULES = (
    "masters", "members", "receipts", "magazines", "events",
    "engagements", "notifications", "reports", "imports",
)
# old code -> new code(s) (first = the straight rename target)
USERS_MAP = {
    "users.create": "users.management.write",
    "users.update": "users.management.write",
    "users.delete": "users.management.delete",
}
# roles that managed users used to manage roles + privileges through users.*
USERS_ALSO = {
    "users.create": ["roles.write", "users.privileges.write"],
    "users.update": ["roles.write", "users.privileges.write"],
    "users.delete": ["roles.delete"],
}
TYPE_TO_ROLE = {"SUPERADMIN": "SUPERADMIN", "ADMIN": "ADMIN", "STAFF": "STAFF", "MEMBER": "MEMBER"}


def upgrade() -> None:
    bind = op.get_bind()

    # ── schema ────────────────────────────────────────────────
    # 0001 builds fresh databases from the CURRENT ORM metadata, so on a new
    # install these columns already exist; only upgrade older databases.
    insp = sa.inspect(bind)

    def has_col(table, col):
        return col in {c["name"] for c in insp.get_columns(table)}

    def add_col(table, column):
        if not has_col(table, column.name):
            op.add_column(table, column)

    def add_fk(name, source, target, local, remote):
        existing = {fk["name"] for fk in insp.get_foreign_keys(source)}
        if name not in existing and not any(
            fk["constrained_columns"] == [local[0]] and fk["referred_table"] == target
            for fk in insp.get_foreign_keys(source)
        ):
            op.create_foreign_key(name, source, target, local, remote)

    add_col("modules", sa.Column("icon", sa.String(50), nullable=True))
    add_col("modules", sa.Column("parent_id", sa.BigInteger(), nullable=True))
    add_col("modules", sa.Column("opens_module_id", sa.BigInteger(), nullable=True))
    add_col("modules", sa.Column("route", sa.String(255), nullable=True))
    add_col("modules", sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"))
    add_col("modules", sa.Column("min_rank_level", sa.Integer(), nullable=True))
    add_fk("fk_modules_parent_id", "modules", "modules", ["parent_id"], ["id"])

    add_col("roles", sa.Column("rank_level", sa.Integer(), nullable=False, server_default="99"))
    add_col("roles", sa.Column("is_all_access", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    add_col("roles", sa.Column("module_id", sa.BigInteger(), nullable=True))
    add_fk("fk_roles_module_id", "roles", "modules", ["module_id"], ["id"])

    add_col("permissions", sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.text("true")))

    add_col("users", sa.Column("role_id", sa.BigInteger(), nullable=True))
    add_col("users", sa.Column("security_stamp", sa.String(100), nullable=True))
    if "ix_users_role_id" not in {i["name"] for i in insp.get_indexes("users")}:
        op.create_index("ix_users_role_id", "users", ["role_id"])
    add_fk("fk_users_role_id", "users", "roles", ["role_id"], ["id"])

    # ── seed default modules / privileges / roles (db/seed_defaults.py) ──
    # Existing custom roles default to a mid rank; the base roles are then
    # set to their catalogue ranks by seed_roles/the update below.
    bind.execute(sa.text("UPDATE roles SET rank_level = 50"))
    from db.seed_defaults import seed_modules, seed_permissions, seed_roles
    session = Session(bind=bind)
    seed_modules(session)
    seed_permissions(session)
    seed_roles(session)
    session.flush()
    for code, rank, all_access in (("SUPERADMIN", 1, True), ("ADMIN", 2, False), ("STAFF", 4, False), ("MEMBER", 99, False)):
        bind.execute(
            sa.text("UPDATE roles SET rank_level=:r, is_all_access=:a WHERE code=:c"),
            {"r": rank, "a": all_access, "c": code},
        )

    # ── users: user_roles -> users.role_id ────────────────────
    insp = sa.inspect(bind)
    if "user_roles" in insp.get_table_names():
        bind.execute(sa.text("""
            UPDATE users SET role_id = (
                SELECT ur.role_id FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id AND r.is_deleted = false
                WHERE ur.user_id = users.id AND ur.is_deleted = false
                ORDER BY r.rank_level, ur.id LIMIT 1)
            WHERE role_id IS NULL
        """))
        op.drop_table("user_roles")
    for user_type, role_code in TYPE_TO_ROLE.items():
        bind.execute(
            sa.text("""
                UPDATE users SET role_id = (SELECT id FROM roles WHERE code = :rc AND is_deleted = false LIMIT 1)
                WHERE role_id IS NULL AND user_type = :ut
            """),
            {"rc": role_code, "ut": user_type},
        )

    # ── privileges: create/update -> write, users.* split ─────
    perm_id = {r[1]: r[0] for r in bind.execute(sa.text("SELECT id, code FROM permissions"))}

    def grants(role_id):
        return {
            r[1]: (r[0], r[2])
            for r in bind.execute(
                sa.text("SELECT id, permission_id, requires_approval FROM role_permissions "
                        "WHERE role_id = :r AND is_deleted = false"),
                {"r": role_id},
            )
        }

    def ensure_grant(role_id, code, requires_approval):
        pid = perm_id.get(code)
        if pid is None:
            return
        have = grants(role_id)
        if pid in have:
            gid, ra = have[pid]
            if ra and not requires_approval:
                return  # keep the stricter flag
            if bool(ra) != bool(requires_approval):
                bind.execute(sa.text("UPDATE role_permissions SET requires_approval=:v WHERE id=:i"),
                             {"v": requires_approval, "i": gid})
            return
        bind.execute(
            sa.text("INSERT INTO role_permissions (role_id, permission_id, requires_approval, is_deleted, created_at) "
                    "VALUES (:r, :p, :ra, false, now())"),
            {"r": role_id, "p": pid, "ra": requires_approval},
        )

    rename = {}
    for m in WRITE_MODULES:
        rename[f"{m}.create"] = f"{m}.write"
        rename[f"{m}.update"] = f"{m}.write"
    rename.update(USERS_MAP)

    old_grants = bind.execute(sa.text("""
        SELECT rp.id, rp.role_id, p.code, rp.requires_approval, rp.is_deleted
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    """)).fetchall()
    for gid, role_id, old_code, ra, deleted in old_grants:
        if deleted or old_code not in rename:
            continue
        ensure_grant(role_id, rename[old_code], bool(ra))
        for extra in USERS_ALSO.get(old_code, []):
            ensure_grant(role_id, extra, bool(ra))

    # every role that could change a module keeps list access
    read_for = {}
    for gid, role_id, old_code, ra, deleted in old_grants:
        if deleted or old_code not in rename:
            continue
        new_code = rename[old_code]
        read_for.setdefault(role_id, set()).add(new_code.rsplit(".", 1)[0])
        for extra in USERS_ALSO.get(old_code, []):
            read_for[role_id].add(extra.rsplit(".", 1)[0])
    for gid, role_id, old_code, ra, deleted in old_grants:
        if not deleted and old_code == "approvals.write":
            read_for.setdefault(role_id, set()).add("approvals")
    for role_id, mods in read_for.items():
        for mod in mods:
            ensure_grant(role_id, f"{mod}.read", False)

    # retire the old privilege rows (grants on them are removed first)
    for old_code in rename:
        pid = perm_id.get(old_code)
        if pid is None:
            continue
        bind.execute(sa.text("DELETE FROM role_permissions WHERE permission_id = :p"), {"p": pid})
        bind.execute(sa.text("DELETE FROM permissions WHERE id = :p"), {"p": pid})
    bind.execute(sa.text("DELETE FROM role_permissions WHERE permission_id IN "
                         "(SELECT id FROM permissions WHERE code = 'users.delete')"))
    bind.execute(sa.text("DELETE FROM permissions WHERE code = 'users.delete'"))


def downgrade() -> None:
    raise NotImplementedError(
        "0015 merges create/update privileges and drops user_roles; restore from a backup instead."
    )
