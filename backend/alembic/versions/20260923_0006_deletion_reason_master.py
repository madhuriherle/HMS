"""Deletion reason master (Mangalya parity: delete_reason).

Revision ID: 20260923_0006
Revises: 20260923_0005
Create Date: 2026-09-23

Creates the deletion_reasons master (bilingual, applies_to SOFT/PERMANENT),
adds member_deletion_requests.reason_id, and seeds the common reasons so the
dropdown is usable immediately after deploy.
"""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0006"
down_revision = "20260923_0005"
branch_labels = None
depends_on = None

DEFAULT_REASONS = [
    # (name_en, name_kn, applies_to)
    ("Duplicate registration", "ಪುನರಾವರ್ತಿತ ನೋಂದಣಿ", None),
    ("Member request", "ಸದಸ್ಯರ ವಿನಂತಿ", None),
    ("Deceased", "ಮೃತಪಟ್ಟಿರುವುದು", None),
    ("Incorrect data entry", "ತಪ್ಪು ದತ್ತಾಂಶ ನಮೂದು", "SOFT"),
    ("Relocated out of state", "ರಾಜ್ಯದ ಹೊರಗೆ ಸ್ಥಳಾಂತರ", "SOFT"),
    ("Requested removal from records", "ದಾಖಲೆಗಳಿಂದ ತೆಗೆದುಹಾಕಲು ವಿನಂತಿ", "PERMANENT"),
]


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _columns(inspector, table: str):
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not _table_exists(inspector, "deletion_reasons"):
        op.create_table(
            "deletion_reasons",
            sa.Column("id", sa.BigInteger(), primary_key=True),
            sa.Column("name_en", sa.String(150), nullable=False),
            sa.Column("name_kn", sa.String(200), nullable=True),
            sa.Column("applies_to", sa.String(10), nullable=True),
            sa.Column("status", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("created_by", sa.BigInteger(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_by", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by", sa.BigInteger(), nullable=True),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )

        # Seed the common reasons (idempotent: only on fresh table creation).
        for name_en, name_kn, applies_to in DEFAULT_REASONS:
            bind.execute(
                sa.text(
                    "INSERT INTO deletion_reasons (name_en, name_kn, applies_to, status) "
                    "VALUES (:name_en, :name_kn, :applies_to, true)"
                ),
                {"name_en": name_en, "name_kn": name_kn, "applies_to": applies_to},
            )

    if _table_exists(inspector, "member_deletion_requests"):
        dcols = _columns(inspector, "member_deletion_requests")
        if "reason_id" not in dcols:
            op.add_column(
                "member_deletion_requests",
                sa.Column("reason_id", sa.BigInteger(), nullable=True),
            )
            try:
                op.create_foreign_key(
                    "fk_deletion_requests_reason", "member_deletion_requests",
                    "deletion_reasons", ["reason_id"], ["id"],
                )
            except Exception:
                pass  # constraint may already exist by another name


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _table_exists(inspector, "member_deletion_requests"):
        if "reason_id" in _columns(inspector, "member_deletion_requests"):
            try:
                op.drop_constraint("fk_deletion_requests_reason", "member_deletion_requests", type_="foreignkey")
            except Exception:
                pass
            op.drop_column("member_deletion_requests", "reason_id")

    if _table_exists(inspector, "deletion_reasons"):
        op.drop_table("deletion_reasons")
