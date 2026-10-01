"""Generic approval_requests queue (maker-checker for any CRUD action).

Revision ID: 20260925_0011
Revises: 20260925_0010
Create Date: 2026-09-25

Backs api.deps.permission_requires_approval + services.approval_gate /
services.approval_registry: any create/update/delete endpoint can be
gated per-role (role_permissions.requires_approval) without a bespoke
per-module request table.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260925_0011"
down_revision = "20260925_0010"
branch_labels = None
depends_on = None


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _table_exists(inspector, "approval_requests"):
        return

    op.create_table(
        "approval_requests",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("module", sa.String(80), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("entity_type", sa.String(100), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=True),
        sa.Column("permission_code", sa.String(120), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("requested_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("reviewed_by", sa.BigInteger(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_approval_requests_status", "approval_requests", ["status"])
    op.create_index("ix_approval_requests_module_action", "approval_requests", ["module", "action"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if _table_exists(inspector, "approval_requests"):
        op.drop_table("approval_requests")
