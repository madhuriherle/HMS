"""Sync live schema with the ORM: member/associate/receipt columns, payment_modes.

Revision ID: 20261009_0021
Revises: 20261005_0020
Create Date: 2026-10-09

Databases created before these model changes never got the columns (the code
added them without a migration; tests build tables from metadata so they did
not notice). Every step checks the live schema first, so a fresh database
created by migration 0001 (current ORM metadata) is a no-op.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261009_0021"
down_revision = "20261005_0020"
branch_labels = None
depends_on = None

# table -> [(column name, type, server_default)]
NEW_COLUMNS = {
    "members": [
        ("category", sa.String(50), None),
        ("company", sa.String(150), None),
        ("website", sa.String(255), None),
        ("remarks", sa.Text(), None),
        ("father_name", sa.String(150), None),
        ("father_membership_number", sa.String(30), None),
        ("mother_name", sa.String(150), None),
        ("mother_membership_number", sa.String(30), None),
        ("is_married", sa.Boolean(), None),
        ("spouse_name", sa.String(150), None),
        ("spouse_membership_number", sa.String(30), None),
        ("has_children", sa.Boolean(), None),
        ("children_details", sa.JSON(), None),
        ("country", sa.String(100), "India"),
        ("city", sa.String(150), None),
        ("post", sa.String(150), None),
    ],
    "associates": [
        ("associate_number", sa.String(50), None),
        ("pan_number", sa.String(20), None),
    ],
    "receipts": [
        ("transaction_date", sa.Date(), None),
    ],
}


def _columns(insp, table):
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    for table, cols in NEW_COLUMNS.items():
        if table not in insp.get_table_names():
            continue
        existing = _columns(insp, table)
        for name, type_, default in cols:
            if name not in existing:
                op.add_column(
                    table,
                    sa.Column(name, type_, nullable=True,
                              server_default=sa.text(f"'{default}'") if default else None),
                )

    insp = sa.inspect(bind)
    if "associates" in insp.get_table_names():
        idx = {i["name"] for i in insp.get_indexes("associates")}
        uniq = {u["name"] for u in insp.get_unique_constraints("associates")}
        if "uq_associates_associate_number" not in idx | uniq:
            op.create_index("uq_associates_associate_number", "associates", ["associate_number"], unique=True)

    # payment_modes was created with an older shape (text id, name, type,
    # is_active, no audit columns). Replace it only if it holds no rows.
    if "payment_modes" in insp.get_table_names() and "payment_mode" not in _columns(insp, "payment_modes"):
        rows = bind.execute(sa.text("SELECT COUNT(*) FROM payment_modes")).scalar()
        if rows:
            raise RuntimeError(
                f"payment_modes has {rows} rows in the old shape; migrate them by hand before upgrading"
            )
        op.drop_table("payment_modes")
        insp = sa.inspect(bind)

    if "payment_modes" not in insp.get_table_names():
        op.create_table(
            "payment_modes",
            sa.Column("id", sa.BigInteger(), primary_key=True),
            sa.Column("payment_mode", sa.String(50), nullable=False),
            sa.Column("payment_type", sa.String(50), nullable=False),
            sa.Column("bank_id", sa.BigInteger(), sa.ForeignKey("banks.id"), nullable=True),
            sa.Column("status", sa.Boolean(), nullable=True, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
        op.create_index("ix_payment_modes_id", "payment_modes", ["id"])


def downgrade() -> None:
    # Additive schema sync; dropping columns could destroy member data.
    pass
