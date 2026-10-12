"""Codes / numbers are unique among live rows only.

Revision ID: 20261012_0035
Revises: 20261009_0034
Create Date: 2026-10-12

Deleting is a soft delete, but the plain UNIQUE constraints on codes and numbers
still counted the deleted rows, so re-creating a bank / membership type /
document type / role / receipt with a code that was deleted failed with
"Database integrity error". Each plain unique constraint (or unique index) on
these columns is replaced by a partial unique index (WHERE is_deleted = false).
Idempotent.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261012_0035"
down_revision = "20261009_0034"
branch_labels = None
depends_on = None

TARGETS = [
    ("associates", "associate_number"),
    ("membership_types", "code"),
    ("document_types", "code"),
    ("particulars", "code"),
    ("service_types", "code"),
    ("banks", "code"),
    ("members", "member_code"),
    ("member_memberships", "membership_number"),
    ("receipts", "receipt_number"),
    ("notification_templates", "template_name"),
    ("users", "username"),
    ("modules", "code"),
    ("roles", "code"),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":  # SQLite (tests) builds the schema from the models
        return
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table, column in TARGETS:
        if table not in tables:
            continue
        new_name = f"uq_{table}_{column}_active"
        for uc in inspector.get_unique_constraints(table):
            if uc["column_names"] == [column]:
                op.drop_constraint(uc["name"], table, type_="unique")
        had_plain_index = False
        inspector = sa.inspect(bind)  # fresh view: dropping a constraint drops its backing index
        for ix in inspector.get_indexes(table):
            if (ix["column_names"] == [column] and ix.get("unique") and ix["name"] != new_name
                    and not ix.get("duplicates_constraint")):
                op.drop_index(ix["name"], table_name=table)
                had_plain_index = ix["name"] == f"ix_{table}_{column}"
        if had_plain_index:  # keep the lookup index the model declares (index=True)
            op.create_index(f"ix_{table}_{column}", table, [column])
        if new_name not in {ix["name"] for ix in inspector.get_indexes(table)}:
            op.create_index(
                new_name, table, [column], unique=True,
                postgresql_where=sa.text("is_deleted = false"),
                sqlite_where=sa.text("is_deleted = false"),
            )


def downgrade() -> None:
    for table, column in TARGETS:
        try:
            op.drop_index(f"uq_{table}_{column}_active", table_name=table)
        except Exception:
            pass
