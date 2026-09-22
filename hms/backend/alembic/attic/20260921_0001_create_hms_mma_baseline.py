"""Create HMS MMA baseline tables (scaffold).

Revision ID: 20260921_0001
Revises:
Create Date: 2026-09-21

NOTE: This baseline establishes the 69 table names and common audit columns.
Add the module-specific business columns, constraints, indexes, and foreign keys
in subsequent revisions before using this schema in production.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260921_0001"
down_revision = None
branch_labels = None
depends_on = None

TABLES = [
    "states",
    "districts",
    "taluks",
    "postal_codes",
    "membership_types",
    "membership_type_prices",
    "hms_settings",
    "document_types",
    "service_types",
    "users",
    "roles",
    "permissions",
    "role_permissions",
    "user_roles",
    "members",
    "member_memberships",
    "member_documents",
    "member_approval_history",
    "member_profile_change_requests",
    "member_profile_history",
    "membership_type_change_requests",
    "membership_type_history",
    "member_deletion_requests",
    "member_kyc_requests",
    "receipts",
    "receipt_items",
    "receipt_allocations",
    "payment_transactions",
    "receipt_cancellations",
    "refund_transactions",
    "magazine_subscriptions",
    "magazine_delivery_pauses",
    "magazine_returns",
    "magazine_delivery_batches",
    "magazine_label_batches",
    "magazine_label_batch_items",
    "saved_reports",
    "report_export_logs",
    "notification_templates",
    "notification_campaigns",
    "notification_recipients",
    "notification_messages",
    "notification_delivery_logs",
    "notification_import_batches",
    "user_activity_logs",
    "member_activity_logs",
    "events",
    "event_participants",
    "event_member_links",
    "event_attachments",
    "affiliations",
    "affiliation_contacts",
    "affiliation_magazine_settings",
    "associates",
    "associate_magazine_settings",
    "press_media",
    "press_media_magazine_settings",
    "committee_categories",
    "committee_subcategories",
    "committee_members",
    "committee_member_links",
    "committee_terms",
    "refresh_tokens",
    "password_reset_tokens",
    "file_attachments",
    "approval_workflows",
    "approval_actions",
    "number_sequences",
    "system_error_logs",
]


def _audit_columns():
    """Return fresh column objects for each table."""
    return [
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        # Temporary extension point; replace with normalized business columns in later revisions.
        sa.Column("extra_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    ]


def upgrade():
    # Create users first so audit-user foreign keys can be added in a later revision.
    for table_name in TABLES:
        op.create_table(table_name, *_audit_columns())

    # Self/audit references are intentionally deferred: the user table itself is
    # created in the same loop and detailed ownership rules need confirmation.


def downgrade():
    # Drop in reverse order to make rollback deterministic.
    for table_name in reversed(TABLES):
        op.drop_table(table_name)
