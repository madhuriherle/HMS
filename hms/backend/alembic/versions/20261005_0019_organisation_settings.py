"""Organisation settings screen (profile / print-header / contact / notifications).

Revision ID: 20261005_0019
Revises: 20261004_0018
Create Date: 2026-10-05

Adds the singleton ``organisation_settings`` table (row id = 1) backing the
Settings screen: organisation profile, contact details, the receipt-book
print header (bilingual name/address, reg & ISO numbers, payment-mode labels,
signature titles, footer note) and notification preferences. The row is
seeded with the Sabha's printed-receipt defaults and the new ``system.write``
privilege is seeded so Rank 1 can edit the screen immediately.

Credentials (SMTP / WhatsApp API keys) stay in the environment (core/config.py).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

revision = "20261005_0019"
down_revision = "20261004_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organisation_settings",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        # Organisation profile
        sa.Column("name_en", sa.String(200), nullable=False, server_default=""),
        sa.Column("name_kn", sa.String(200), nullable=True),
        sa.Column("address_en", sa.Text(), nullable=True),
        sa.Column("address_kn", sa.Text(), nullable=True),
        sa.Column("registration_no", sa.String(50), nullable=True),
        sa.Column("iso_cert_no", sa.String(50), nullable=True),
        sa.Column("logo_path", sa.String(255), nullable=True),
        sa.Column("website", sa.String(200), nullable=True),
        # Contact settings
        sa.Column("phone", sa.String(30), nullable=True),
        sa.Column("mobile", sa.String(30), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        # Print-header settings (receipt book)
        sa.Column("print_header_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("receipt_footer_note_en", sa.Text(), nullable=True),
        sa.Column("receipt_footer_note_kn", sa.Text(), nullable=True),
        sa.Column("president_title_en", sa.String(50), nullable=True),
        sa.Column("president_title_kn", sa.String(50), nullable=True),
        sa.Column("secretary_title_en", sa.String(50), nullable=True),
        sa.Column("secretary_title_kn", sa.String(50), nullable=True),
        sa.Column("treasurer_title_en", sa.String(50), nullable=True),
        sa.Column("treasurer_title_kn", sa.String(50), nullable=True),
        sa.Column("pay_mode_cash_en", sa.String(30), nullable=True),
        sa.Column("pay_mode_cash_kn", sa.String(30), nullable=True),
        sa.Column("pay_mode_cheque_en", sa.String(30), nullable=True),
        sa.Column("pay_mode_cheque_kn", sa.String(30), nullable=True),
        sa.Column("pay_mode_dd_en", sa.String(30), nullable=True),
        sa.Column("pay_mode_dd_kn", sa.String(30), nullable=True),
        sa.Column("pay_mode_upi_en", sa.String(30), nullable=True),
        sa.Column("pay_mode_upi_kn", sa.String(30), nullable=True),
        # Notification settings (credentials live in env config)
        sa.Column("notify_email_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notify_sms_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notify_whatsapp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notify_reply_to_email", sa.String(200), nullable=True),
        sa.Column("notify_footer_note", sa.Text(), nullable=True),
        # AuditMixin
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_organisation_settings_id", "organisation_settings", ["id"])

    # Seed the new privilege and the default settings row (db/seed_defaults.py).
    session = Session(bind=op.get_bind())
    try:
        from db.seed_defaults import seed_permissions, seed_organisation_settings

        seed_permissions(session)
        seed_organisation_settings(session)
    finally:
        session.close()


def downgrade() -> None:
    op.drop_index("ix_organisation_settings_id", table_name="organisation_settings")
    op.drop_table("organisation_settings")
