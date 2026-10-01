"""Remove Mangalya/matrimony-only horoscope fields from the membership core.

Revision ID: 20260929_0014
Revises: 20260929_0013
Create Date: 2026-09-29

The HMS membership register never reads these — they were added in 0005 for
Mangalya-parity (the matrimonial sub-product). Mangalya will own its own
profile table when that app is built; until then the membership core stays
clean:

* members: drop gotra_id, nakshatra_id, rashi_id, masa_id, mithi_id,
  samvathsara_id (plain columns, no FK constraints were created on them)
* drop master tables: gothras, nakshatras, rashis, masas, mithis, samvathraras

Kept (still used by the sabha register + profile): father_husband_name,
blood_group, native_place_id/_text, qualification_id/_text, occupation,
aadhaar_number, and the qualifications/native_places master tables.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260929_0014"
down_revision = "20260929_0013"
branch_labels = None
depends_on = None

MEMBER_COLUMNS = [
    "gotra_id", "nakshatra_id", "rashi_id",
    "masa_id", "mithi_id", "samvathsara_id",
]

MASTER_TABLES = [
    "gothras", "nakshatras", "rashis",
    "masas", "mithis", "samvathraras",
]


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _columns(inspector, table: str) -> set:
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _table_exists(inspector, "members"):
        cols = _columns(inspector, "members")
        for column in MEMBER_COLUMNS:
            if column in cols:
                op.drop_column("members", column)

    for table in MASTER_TABLES:
        if _table_exists(inspector, table):
            op.drop_table(table)


def downgrade() -> None:
    """Recreate what 0005 created (0005's own downgrade reverses the rest)."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    def _make_master(table: str) -> None:
        op.create_table(
            table,
            sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
            sa.Column("name_en", sa.String(100), nullable=False),
            sa.Column("name_kn", sa.String(150), nullable=True),
            sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

    for table in MASTER_TABLES:
        if not _table_exists(inspector, table):
            _make_master(table)

    if _table_exists(inspector, "members"):
        cols = _columns(inspector, "members")
        for column in MEMBER_COLUMNS:
            if column not in cols:
                op.add_column("members", sa.Column(column, sa.BigInteger(), nullable=True))
