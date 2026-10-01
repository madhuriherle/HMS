"""Modules master (RBAC module list, managed instead of bare strings).

Revision ID: 20260925_0008
Revises: 20260923_0007
Create Date: 2026-09-25

Creates the modules table and seeds it with the module codes already used by
the permissions catalog (masters, users, members, receipts, magazines,
events, engagements, notifications, approvals, imports, reports), so the
table isn't empty after deploy.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260925_0008"
down_revision = "20260923_0007"
branch_labels = None
depends_on = None

MODULE_CATALOG = [
    ("masters", "Masters"),
    ("users", "Users"),
    ("members", "Membership"),
    ("receipts", "Receipts"),
    ("magazines", "Magazine"),
    ("events", "Events"),
    ("engagements", "Engagements"),
    ("notifications", "Notifications"),
    ("approvals", "Approvals"),
    ("imports", "Imports"),
    ("reports", "Reports"),
]


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _table_exists(inspector, "modules"):
        return

    op.create_table(
        "modules",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("code", sa.String(80), nullable=False, unique=True),
        sa.Column("name_en", sa.String(100), nullable=False),
        sa.Column("name_kn", sa.String(150), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    for code, name_en in MODULE_CATALOG:
        bind.execute(
            sa.text("INSERT INTO modules (code, name_en, status) VALUES (:code, :name_en, true)"),
            {"code": code, "name_en": name_en},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _table_exists(inspector, "modules"):
        op.drop_table("modules")
