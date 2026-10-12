"""Real foreign keys for member location / personal-master ids and users.member_id.

Revision ID: 20261012_0042
Revises: 20261012_0041
Create Date: 2026-10-12

members.state_id / district_id / taluk_id / pincode_id / gotra_id / qualification_id /
native_place_id and users.member_id were plain integers. Any value that points at nothing is
copied into fk_orphan_backup (table, row id, column, old value) and then set to NULL, so the
constraint can be added; nothing is lost. Run scripts/check_fk_orphans.py first to preview.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0042"
down_revision = "20261012_0041"
branch_labels = None
depends_on = None

# (table, column, referenced table)
LINKS = [
    ("members", "state_id", "states"),
    ("members", "district_id", "districts"),
    ("members", "taluk_id", "taluks"),
    ("members", "pincode_id", "postal_codes"),
    ("members", "gotra_id", "gotras"),
    ("members", "qualification_id", "qualifications"),
    ("members", "native_place_id", "native_places"),
    ("users", "member_id", "members"),
]


def _fk_name(table, column):
    return f"fk_{table}_{column}"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    op.execute("""
        CREATE TABLE IF NOT EXISTS fk_orphan_backup (
            id BIGSERIAL PRIMARY KEY,
            table_name VARCHAR(60) NOT NULL,
            row_id BIGINT NOT NULL,
            column_name VARCHAR(60) NOT NULL,
            old_value BIGINT,
            cleared_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    existing = {
        fk["name"]
        for t in {l[0] for l in LINKS}
        for fk in sa.inspect(bind).get_foreign_keys(t)
    }
    for table, column, ref in LINKS:
        name = _fk_name(table, column)
        if name in existing:
            continue
        orphan = f"{column} IS NOT NULL AND {column} NOT IN (SELECT id FROM {ref})"
        op.execute(f"""
            INSERT INTO fk_orphan_backup (table_name, row_id, column_name, old_value)
            SELECT '{table}', id, '{column}', {column} FROM {table} WHERE {orphan}
        """)
        op.execute(f"UPDATE {table} SET {column} = NULL WHERE {orphan}")
        op.create_foreign_key(name, table, ref, [column], ["id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table, column, _ref in LINKS:
        op.drop_constraint(_fk_name(table, column), table, type_="foreignkey")
