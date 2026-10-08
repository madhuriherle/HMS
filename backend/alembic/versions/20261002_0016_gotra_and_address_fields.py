"""Restore gotra (master + member columns) and add village-style address fields.

Revision ID: 20261002_0016
Revises: 20261001_0015
Create Date: 2026-10-02

Gotra is recorded in the Sabha's own member register (the legacy "Vilas"
screen), so it comes back: a `gotras` master and members.gotra_id /
gotra_text (same id + free-text-fallback shape as qualification). The
register also keeps area / place / grama / village / label point / address
remarks, which are added to members. The other horoscope fields stay removed.

0001 builds fresh databases from the current ORM metadata, so every step
checks before it adds.
"""

import sqlalchemy as sa
from alembic import op

revision = "20261002_0016"
down_revision = "20261001_0015"
branch_labels = None
depends_on = None

MEMBER_COLUMNS = [
    ("gotra_id", sa.BigInteger()),
    ("gotra_text", sa.String(100)),
    ("area", sa.String(150)),
    ("place", sa.String(150)),
    ("grama", sa.String(150)),
    ("village", sa.String(150)),
    ("label_point", sa.String(100)),
    ("address_remarks", sa.Text()),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if "gotras" not in insp.get_table_names():
        op.create_table(
            "gotras",
            sa.Column("id", sa.BigInteger(), primary_key=True),
            sa.Column("name_en", sa.String(100), nullable=False),
            sa.Column("name_kn", sa.String(150), nullable=True),
            sa.Column("status", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
        op.create_index("ix_gotras_id", "gotras", ["id"])

    have = {c["name"] for c in insp.get_columns("members")}
    for name, type_ in MEMBER_COLUMNS:
        if name not in have:
            op.add_column("members", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in MEMBER_COLUMNS:
        op.drop_column("members", name)
    op.drop_table("gotras")
