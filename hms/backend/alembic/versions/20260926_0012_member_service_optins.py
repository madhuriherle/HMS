"""Member service opt-ins against the service_types catalogue.

Revision ID: 20260926_0012
Revises: 20260925_0011
Create Date: 2026-09-26

Backs the spec's "service opted details (Magazine, Temple, Mangalya, Hall
etc)" on the member profile: service_types was a catalogue nothing joined to,
so this table is the per-member opt-in. Services with a richer lifecycle keep
their own table and are referenced via linked_type/linked_id rather than
duplicated.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260926_0012"
down_revision = "20260925_0011"
branch_labels = None
depends_on = None


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _table_exists(inspector, "member_service_optins"):
        return

    op.create_table(
        "member_service_optins",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), sa.ForeignKey("members.id"), nullable=False),
        sa.Column("service_type_id", sa.BigInteger(), sa.ForeignKey("service_types.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("opted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("opted_via", sa.String(20), nullable=False, server_default="ADMIN"),
        sa.Column("linked_type", sa.String(30), nullable=True),
        sa.Column("linked_id", sa.BigInteger(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_member_service_optins_member_id", "member_service_optins", ["member_id"])
    op.create_index("ix_member_service_optins_service_type_id", "member_service_optins", ["service_type_id"])
    # Mirrors models/members.py MemberServiceOptin.__table_args__ — one live
    # opt-in per (member, service). Partial index so a cancelled-then-re-opted
    # pair doesn't collide with the soft-deleted original.
    op.create_index(
        "uq_member_service_optin_active",
        "member_service_optins",
        ["member_id", "service_type_id"],
        unique=True,
        postgresql_where=sa.text("is_deleted = false"),
        sqlite_where=sa.text("is_deleted = false"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _table_exists(inspector, "member_service_optins"):
        op.drop_table("member_service_optins")
