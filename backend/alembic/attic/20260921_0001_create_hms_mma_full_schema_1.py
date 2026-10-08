"""Create HMS MMA tables with business and audit columns."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260921_0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("states",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("code", sa.String(10)(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("districts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("state_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("taluks",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("district_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("postal_codes",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("postal_code", sa.String(10)(), nullable=False),
        sa.Column("state_id", sa.BigInteger(), nullable=False),
        sa.Column("district_id", sa.BigInteger(), nullable=False),
        sa.Column("taluk_id", sa.BigInteger(), nullable=True),
        sa.Column("office_name", sa.String(150)(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("membership_types",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("membership_type_prices",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("membership_type_id", sa.BigInteger(), nullable=False),
        sa.Column("price", sa.Numeric(12,2)(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("hms_settings",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("setting_key", sa.String(150)(), nullable=False),
        sa.Column("setting_value", postgresql.JSONB(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("document_types",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("service_types",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("users",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("full_name", sa.String(200)(), nullable=False),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("mobile", sa.String(20)(), nullable=True),
        sa.Column("password_hash", sa.String(255)(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("roles",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(100)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("permissions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("code", sa.String(150)(), nullable=False),
        sa.Column("name", sa.String(150)(), nullable=False),
        sa.Column("module", sa.String(100)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("role_permissions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("permission_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("user_roles",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("members",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("membership_no", sa.String(50)(), nullable=True),
        sa.Column("application_no", sa.String(50)(), nullable=True),
        sa.Column("first_name_en", sa.String(100)(), nullable=False),
        sa.Column("middle_name_en", sa.String(100)(), nullable=True),
        sa.Column("last_name_en", sa.String(100)(), nullable=True),
        sa.Column("first_name_kn", sa.String(150)(), nullable=True),
        sa.Column("middle_name_kn", sa.String(150)(), nullable=True),
        sa.Column("last_name_kn", sa.String(150)(), nullable=True),
        sa.Column("gender", sa.String(20)(), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("mobile_primary", sa.String(20)(), nullable=False),
        sa.Column("mobile_alternate", sa.String(20)(), nullable=True),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("address_line1", sa.String(255)(), nullable=True),
        sa.Column("address_line2", sa.String(255)(), nullable=True),
        sa.Column("state_id", sa.BigInteger(), nullable=True),
        sa.Column("district_id", sa.BigInteger(), nullable=True),
        sa.Column("taluk_id", sa.BigInteger(), nullable=True),
        sa.Column("postal_code_id", sa.BigInteger(), nullable=True),
        sa.Column("membership_type_id", sa.BigInteger(), nullable=True),
        sa.Column("registration_source", sa.String(30)(), nullable=False),
        sa.Column("approval_status", sa.String(30)(), nullable=False),
        sa.Column("membership_status", sa.String(30)(), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("approved_by", sa.BigInteger(), nullable=True),
        sa.Column("deletion_reason", sa.Text(), nullable=True),
        sa.Column("deleted_permanently_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_memberships",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("membership_type_id", sa.BigInteger(), nullable=False),
        sa.Column("membership_no", sa.String(50)(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_documents",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("document_type_id", sa.BigInteger(), nullable=False),
        sa.Column("file_attachment_id", sa.BigInteger(), nullable=True),
        sa.Column("file_name", sa.String(255)(), nullable=True),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("verification_status", sa.String(30)(), nullable=False),
        sa.Column("verified_by", sa.BigInteger(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_approval_history",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.String(30)(), nullable=False),
        sa.Column("from_status", sa.String(30)(), nullable=True),
        sa.Column("to_status", sa.String(30)(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("action_by", sa.BigInteger(), nullable=True),
        sa.Column("action_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_profile_change_requests",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("requested_by", sa.BigInteger(), nullable=True),
        sa.Column("source", sa.String(30)(), nullable=False),
        sa.Column("proposed_changes", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_profile_history",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("field_name", sa.String(150)(), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("change_source", sa.String(30)(), nullable=False),
        sa.Column("change_request_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("membership_type_change_requests",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("old_membership_type_id", sa.BigInteger(), nullable=True),
        sa.Column("new_membership_type_id", sa.BigInteger(), nullable=False),
        sa.Column("receipt_id", sa.BigInteger(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("requested_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("membership_type_history",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("old_membership_type_id", sa.BigInteger(), nullable=True),
        sa.Column("new_membership_type_id", sa.BigInteger(), nullable=False),
        sa.Column("effective_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("change_request_id", sa.BigInteger(), nullable=True),
        sa.Column("receipt_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_deletion_requests",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("deletion_type", sa.String(30)(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("requested_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_kyc_requests",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(255)(), nullable=True),
        sa.Column("sent_to", sa.String(255)(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("submitted_data", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("reviewed_by", sa.BigInteger(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("receipts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_no", sa.String(50)(), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=False),
        sa.Column("receipt_type", sa.String(30)(), nullable=False),
        sa.Column("payer_name", sa.String(200)(), nullable=True),
        sa.Column("member_id", sa.BigInteger(), nullable=True),
        sa.Column("subtotal", sa.Numeric(12,2)(), nullable=False),
        sa.Column("discount_amount", sa.Numeric(12,2)(), nullable=False),
        sa.Column("total_amount", sa.Numeric(12,2)(), nullable=False),
        sa.Column("payment_mode", sa.String(30)(), nullable=False),
        sa.Column("transaction_reference", sa.String(150)(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("receipt_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.String(255)(), nullable=False),
        sa.Column("quantity", sa.Numeric(10,2)(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12,2)(), nullable=False),
        sa.Column("amount", sa.Numeric(12,2)(), nullable=False),
        sa.Column("membership_type_id", sa.BigInteger(), nullable=True),
        sa.Column("service_type_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("receipt_allocations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), nullable=False),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("allocated_amount", sa.Numeric(12,2)(), nullable=False),
        sa.Column("allocated_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("payment_transactions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), nullable=False),
        sa.Column("gateway", sa.String(80)(), nullable=True),
        sa.Column("gateway_transaction_id", sa.String(180)(), nullable=True),
        sa.Column("amount", sa.Numeric(12,2)(), nullable=False),
        sa.Column("currency", sa.String(3)(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("receipt_cancellations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("cancelled_by", sa.BigInteger(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("refund_transactions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), nullable=False),
        sa.Column("payment_transaction_id", sa.BigInteger(), nullable=True),
        sa.Column("amount", sa.Numeric(12,2)(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("refund_reference", sa.String(150)(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("refunded_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("magazine_subscriptions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=True),
        sa.Column("affiliation_id", sa.BigInteger(), nullable=True),
        sa.Column("associate_id", sa.BigInteger(), nullable=True),
        sa.Column("press_media_id", sa.BigInteger(), nullable=True),
        sa.Column("delivery_enabled", sa.Boolean(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("address_override", postgresql.JSONB(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("magazine_delivery_pauses",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("magazine_subscription_id", sa.BigInteger(), nullable=False),
        sa.Column("pause_from", sa.Date(), nullable=False),
        sa.Column("pause_to", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("resumed_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("magazine_returns",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("magazine_subscription_id", sa.BigInteger(), nullable=False),
        sa.Column("member_id", sa.BigInteger(), nullable=True),
        sa.Column("issue_name", sa.String(150)(), nullable=True),
        sa.Column("return_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("magazine_delivery_batches",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("batch_name", sa.String(150)(), nullable=False),
        sa.Column("batch_date", sa.Date(), nullable=False),
        sa.Column("filter_criteria", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("generated_by", sa.BigInteger(), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("magazine_label_batches",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("batch_name", sa.String(150)(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("filter_criteria", postgresql.JSONB(), nullable=True),
        sa.Column("language", sa.String(10)(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("magazine_label_batch_items",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("batch_id", sa.BigInteger(), nullable=False),
        sa.Column("recipient_type", sa.String(30)(), nullable=False),
        sa.Column("recipient_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(200)(), nullable=False),
        sa.Column("address_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("has_return_flag", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("saved_reports",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(150)(), nullable=False),
        sa.Column("report_key", sa.String(150)(), nullable=False),
        sa.Column("filters", postgresql.JSONB(), nullable=True),
        sa.Column("columns_config", postgresql.JSONB(), nullable=True),
        sa.Column("language", sa.String(10)(), nullable=False),
        sa.Column("is_shared", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("report_export_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("report_key", sa.String(150)(), nullable=False),
        sa.Column("filters", postgresql.JSONB(), nullable=True),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("format", sa.String(20)(), nullable=False),
        sa.Column("exported_by", sa.BigInteger(), nullable=True),
        sa.Column("exported_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("notification_templates",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(150)(), nullable=False),
        sa.Column("provider_template_id", sa.String(150)(), nullable=True),
        sa.Column("language", sa.String(20)(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("variables", postgresql.JSONB(), nullable=True),
        sa.Column("approval_status", sa.String(30)(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("notification_campaigns",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(150)(), nullable=False),
        sa.Column("template_id", sa.BigInteger(), nullable=False),
        sa.Column("audience_filters", postgresql.JSONB(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("created_by_user", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("notification_recipients",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("campaign_id", sa.BigInteger(), nullable=True),
        sa.Column("member_id", sa.BigInteger(), nullable=True),
        sa.Column("phone_number", sa.String(20)(), nullable=False),
        sa.Column("recipient_name", sa.String(200)(), nullable=True),
        sa.Column("variables", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("notification_messages",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("recipient_id", sa.BigInteger(), nullable=False),
        sa.Column("template_id", sa.BigInteger(), nullable=True),
        sa.Column("message_body", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.String(180)(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("notification_delivery_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(50)(), nullable=False),
        sa.Column("event_payload", postgresql.JSONB(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("notification_import_batches",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("file_name", sa.String(255)(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("success_count", sa.Integer(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("imported_by", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("user_activity_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("event_type", sa.String(100)(), nullable=False),
        sa.Column("module", sa.String(100)(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(45)(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("member_activity_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(100)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("related_entity_type", sa.String(100)(), nullable=True),
        sa.Column("related_entity_id", sa.BigInteger(), nullable=True),
        sa.Column("performed_by", sa.BigInteger(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("title", sa.String(200)(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("event_date", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("location", sa.String(255)(), nullable=True),
        sa.Column("invitation_file_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("send_notification", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("event_participants",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("event_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(200)(), nullable=False),
        sa.Column("designation", sa.String(150)(), nullable=True),
        sa.Column("role", sa.String(50)(), nullable=False),
        sa.Column("member_id", sa.BigInteger(), nullable=True),
        sa.Column("honour_details", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("event_member_links",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("event_id", sa.BigInteger(), nullable=False),
        sa.Column("member_id", sa.BigInteger(), nullable=False),
        sa.Column("participation_type", sa.String(50)(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("event_attachments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("event_id", sa.BigInteger(), nullable=False),
        sa.Column("file_attachment_id", sa.BigInteger(), nullable=False),
        sa.Column("attachment_type", sa.String(50)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("affiliations",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(200)(), nullable=False),
        sa.Column("registration_no", sa.String(100)(), nullable=True),
        sa.Column("contact_person", sa.String(200)(), nullable=True),
        sa.Column("mobile", sa.String(20)(), nullable=True),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("address", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("affiliation_contacts",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("affiliation_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(200)(), nullable=False),
        sa.Column("designation", sa.String(150)(), nullable=True),
        sa.Column("mobile", sa.String(20)(), nullable=True),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("affiliation_magazine_settings",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("affiliation_id", sa.BigInteger(), nullable=False),
        sa.Column("delivery_enabled", sa.Boolean(), nullable=False),
        sa.Column("copies_count", sa.Integer(), nullable=False),
        sa.Column("delivery_address", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("associates",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(200)(), nullable=False),
        sa.Column("mobile", sa.String(20)(), nullable=True),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("address", postgresql.JSONB(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("associate_magazine_settings",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("associate_id", sa.BigInteger(), nullable=False),
        sa.Column("delivery_enabled", sa.Boolean(), nullable=False),
        sa.Column("copies_count", sa.Integer(), nullable=False),
        sa.Column("delivery_address", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("press_media",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("organization_name", sa.String(200)(), nullable=False),
        sa.Column("contact_person", sa.String(200)(), nullable=True),
        sa.Column("mobile", sa.String(20)(), nullable=True),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("address", postgresql.JSONB(), nullable=True),
        sa.Column("media_type", sa.String(100)(), nullable=True),
        sa.Column("status", sa.String(30)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("press_media_magazine_settings",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("press_media_id", sa.BigInteger(), nullable=False),
        sa.Column("delivery_enabled", sa.Boolean(), nullable=False),
        sa.Column("copies_count", sa.Integer(), nullable=False),
        sa.Column("delivery_address", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("committee_categories",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(200)(), nullable=False),
        sa.Column("name_kn", sa.String(200)(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("display_on_website", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("committee_subcategories",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(200)(), nullable=False),
        sa.Column("name_kn", sa.String(200)(), nullable=True),
        sa.Column("display_on_website", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("committee_members",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name_en", sa.String(200)(), nullable=False),
        sa.Column("name_kn", sa.String(200)(), nullable=True),
        sa.Column("designation", sa.String(150)(), nullable=True),
        sa.Column("mobile", sa.String(20)(), nullable=True),
        sa.Column("email", sa.String(255)(), nullable=True),
        sa.Column("member_id", sa.BigInteger(), nullable=True),
        sa.Column("photo_file_id", sa.BigInteger(), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("committee_member_links",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("committee_member_id", sa.BigInteger(), nullable=False),
        sa.Column("category_id", sa.BigInteger(), nullable=False),
        sa.Column("subcategory_id", sa.BigInteger(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("committee_terms",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(150)(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("refresh_tokens",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(255)(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("password_reset_tokens",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(255)(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("file_attachments",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("original_name", sa.String(255)(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(150)(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("checksum", sa.String(128)(), nullable=True),
        sa.Column("uploaded_by", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("approval_workflows",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("name", sa.String(150)(), nullable=False),
        sa.Column("module", sa.String(100)(), nullable=False),
        sa.Column("steps", postgresql.JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("approval_actions",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("workflow_id", sa.BigInteger(), nullable=True),
        sa.Column("entity_type", sa.String(100)(), nullable=False),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(30)(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("acted_by", sa.BigInteger(), nullable=True),
        sa.Column("acted_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("number_sequences",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("sequence_key", sa.String(100)(), nullable=False),
        sa.Column("prefix", sa.String(30)(), nullable=True),
        sa.Column("current_value", sa.BigInteger(), nullable=False),
        sa.Column("padding_length", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_table("system_error_logs",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("severity", sa.String(30)(), nullable=False),
        sa.Column("error_code", sa.String(100)(), nullable=True),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("traceback", sa.Text(), nullable=True),
        sa.Column("request_path", sa.Text(), nullable=True),
        sa.Column("request_method", sa.String(10)(), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True)(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.BigInteger(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    # Add foreign keys after table creation.
    op.create_foreign_key("fk_districts_state_id", "districts", "states", ["state_id"], ["id"])
    op.create_foreign_key("fk_taluks_district_id", "taluks", "districts", ["district_id"], ["id"])
    op.create_foreign_key("fk_postal_codes_state_id", "postal_codes", "states", ["state_id"], ["id"])
    op.create_foreign_key("fk_postal_codes_district_id", "postal_codes", "districts", ["district_id"], ["id"])
    op.create_foreign_key("fk_postal_codes_taluk_id", "postal_codes", "taluks", ["taluk_id"], ["id"])
    op.create_foreign_key("fk_membership_type_prices_membership_type_id", "membership_type_prices", "membership_types", ["membership_type_id"], ["id"])
    op.create_foreign_key("fk_role_permissions_role_id", "role_permissions", "roles", ["role_id"], ["id"])
    op.create_foreign_key("fk_role_permissions_permission_id", "role_permissions", "permissions", ["permission_id"], ["id"])
    op.create_foreign_key("fk_user_roles_user_id", "user_roles", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_user_roles_role_id", "user_roles", "roles", ["role_id"], ["id"])
    op.create_foreign_key("fk_members_user_id", "members", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_members_state_id", "members", "states", ["state_id"], ["id"])
    op.create_foreign_key("fk_members_district_id", "members", "districts", ["district_id"], ["id"])
    op.create_foreign_key("fk_members_taluk_id", "members", "taluks", ["taluk_id"], ["id"])
    op.create_foreign_key("fk_members_postal_code_id", "members", "postal_codes", ["postal_code_id"], ["id"])
    op.create_foreign_key("fk_members_membership_type_id", "members", "membership_types", ["membership_type_id"], ["id"])
    op.create_foreign_key("fk_members_approved_by", "members", "users", ["approved_by"], ["id"])
    op.create_foreign_key("fk_member_memberships_member_id", "member_memberships", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_memberships_membership_type_id", "member_memberships", "membership_types", ["membership_type_id"], ["id"])
    op.create_foreign_key("fk_member_documents_member_id", "member_documents", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_documents_document_type_id", "member_documents", "document_types", ["document_type_id"], ["id"])
    op.create_foreign_key("fk_member_documents_file_attachment_id", "member_documents", "file_attachments", ["file_attachment_id"], ["id"])
    op.create_foreign_key("fk_member_documents_verified_by", "member_documents", "users", ["verified_by"], ["id"])
    op.create_foreign_key("fk_member_approval_history_member_id", "member_approval_history", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_approval_history_action_by", "member_approval_history", "users", ["action_by"], ["id"])
    op.create_foreign_key("fk_member_profile_change_requests_member_id", "member_profile_change_requests", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_profile_change_requests_requested_by", "member_profile_change_requests", "users", ["requested_by"], ["id"])
    op.create_foreign_key("fk_member_profile_change_requests_reviewed_by", "member_profile_change_requests", "users", ["reviewed_by"], ["id"])
    op.create_foreign_key("fk_member_profile_history_member_id", "member_profile_history", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_profile_history_change_request_id", "member_profile_history", "member_profile_change_requests", ["change_request_id"], ["id"])
    op.create_foreign_key("fk_membership_type_change_requests_member_id", "membership_type_change_requests", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_membership_type_change_requests_old_membership_type_id", "membership_type_change_requests", "membership_types", ["old_membership_type_id"], ["id"])
    op.create_foreign_key("fk_membership_type_change_requests_new_membership_type_id", "membership_type_change_requests", "membership_types", ["new_membership_type_id"], ["id"])
    op.create_foreign_key("fk_membership_type_change_requests_receipt_id", "membership_type_change_requests", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_membership_type_change_requests_requested_by", "membership_type_change_requests", "users", ["requested_by"], ["id"])
    op.create_foreign_key("fk_membership_type_change_requests_reviewed_by", "membership_type_change_requests", "users", ["reviewed_by"], ["id"])
    op.create_foreign_key("fk_membership_type_history_member_id", "membership_type_history", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_membership_type_history_old_membership_type_id", "membership_type_history", "membership_types", ["old_membership_type_id"], ["id"])
    op.create_foreign_key("fk_membership_type_history_new_membership_type_id", "membership_type_history", "membership_types", ["new_membership_type_id"], ["id"])
    op.create_foreign_key("fk_membership_type_history_change_request_id", "membership_type_history", "membership_type_change_requests", ["change_request_id"], ["id"])
    op.create_foreign_key("fk_membership_type_history_receipt_id", "membership_type_history", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_member_deletion_requests_member_id", "member_deletion_requests", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_deletion_requests_requested_by", "member_deletion_requests", "users", ["requested_by"], ["id"])
    op.create_foreign_key("fk_member_deletion_requests_reviewed_by", "member_deletion_requests", "users", ["reviewed_by"], ["id"])
    op.create_foreign_key("fk_member_kyc_requests_member_id", "member_kyc_requests", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_kyc_requests_reviewed_by", "member_kyc_requests", "users", ["reviewed_by"], ["id"])
    op.create_foreign_key("fk_receipts_member_id", "receipts", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_receipt_items_receipt_id", "receipt_items", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_receipt_items_membership_type_id", "receipt_items", "membership_types", ["membership_type_id"], ["id"])
    op.create_foreign_key("fk_receipt_items_service_type_id", "receipt_items", "service_types", ["service_type_id"], ["id"])
    op.create_foreign_key("fk_receipt_allocations_receipt_id", "receipt_allocations", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_receipt_allocations_member_id", "receipt_allocations", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_payment_transactions_receipt_id", "payment_transactions", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_receipt_cancellations_receipt_id", "receipt_cancellations", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_receipt_cancellations_cancelled_by", "receipt_cancellations", "users", ["cancelled_by"], ["id"])
    op.create_foreign_key("fk_refund_transactions_receipt_id", "refund_transactions", "receipts", ["receipt_id"], ["id"])
    op.create_foreign_key("fk_refund_transactions_payment_transaction_id", "refund_transactions", "payment_transactions", ["payment_transaction_id"], ["id"])
    op.create_foreign_key("fk_magazine_subscriptions_member_id", "magazine_subscriptions", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_magazine_subscriptions_affiliation_id", "magazine_subscriptions", "affiliations", ["affiliation_id"], ["id"])
    op.create_foreign_key("fk_magazine_subscriptions_associate_id", "magazine_subscriptions", "associates", ["associate_id"], ["id"])
    op.create_foreign_key("fk_magazine_subscriptions_press_media_id", "magazine_subscriptions", "press_media", ["press_media_id"], ["id"])
    op.create_foreign_key("fk_magazine_delivery_pauses_magazine_subscription_id", "magazine_delivery_pauses", "magazine_subscriptions", ["magazine_subscription_id"], ["id"])
    op.create_foreign_key("fk_magazine_returns_magazine_subscription_id", "magazine_returns", "magazine_subscriptions", ["magazine_subscription_id"], ["id"])
    op.create_foreign_key("fk_magazine_returns_member_id", "magazine_returns", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_magazine_delivery_batches_generated_by", "magazine_delivery_batches", "users", ["generated_by"], ["id"])
    op.create_foreign_key("fk_magazine_label_batch_items_batch_id", "magazine_label_batch_items", "magazine_label_batches", ["batch_id"], ["id"])
    op.create_foreign_key("fk_report_export_logs_exported_by", "report_export_logs", "users", ["exported_by"], ["id"])
    op.create_foreign_key("fk_notification_campaigns_template_id", "notification_campaigns", "notification_templates", ["template_id"], ["id"])
    op.create_foreign_key("fk_notification_campaigns_created_by_user", "notification_campaigns", "users", ["created_by_user"], ["id"])
    op.create_foreign_key("fk_notification_recipients_campaign_id", "notification_recipients", "notification_campaigns", ["campaign_id"], ["id"])
    op.create_foreign_key("fk_notification_recipients_member_id", "notification_recipients", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_notification_messages_recipient_id", "notification_messages", "notification_recipients", ["recipient_id"], ["id"])
    op.create_foreign_key("fk_notification_messages_template_id", "notification_messages", "notification_templates", ["template_id"], ["id"])
    op.create_foreign_key("fk_notification_delivery_logs_message_id", "notification_delivery_logs", "notification_messages", ["message_id"], ["id"])
    op.create_foreign_key("fk_notification_import_batches_imported_by", "notification_import_batches", "users", ["imported_by"], ["id"])
    op.create_foreign_key("fk_user_activity_logs_user_id", "user_activity_logs", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_member_activity_logs_member_id", "member_activity_logs", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_member_activity_logs_performed_by", "member_activity_logs", "users", ["performed_by"], ["id"])
    op.create_foreign_key("fk_events_invitation_file_id", "events", "file_attachments", ["invitation_file_id"], ["id"])
    op.create_foreign_key("fk_event_participants_event_id", "event_participants", "events", ["event_id"], ["id"])
    op.create_foreign_key("fk_event_participants_member_id", "event_participants", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_event_member_links_event_id", "event_member_links", "events", ["event_id"], ["id"])
    op.create_foreign_key("fk_event_member_links_member_id", "event_member_links", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_event_attachments_event_id", "event_attachments", "events", ["event_id"], ["id"])
    op.create_foreign_key("fk_event_attachments_file_attachment_id", "event_attachments", "file_attachments", ["file_attachment_id"], ["id"])
    op.create_foreign_key("fk_affiliation_contacts_affiliation_id", "affiliation_contacts", "affiliations", ["affiliation_id"], ["id"])
    op.create_foreign_key("fk_affiliation_magazine_settings_affiliation_id", "affiliation_magazine_settings", "affiliations", ["affiliation_id"], ["id"])
    op.create_foreign_key("fk_associate_magazine_settings_associate_id", "associate_magazine_settings", "associates", ["associate_id"], ["id"])
    op.create_foreign_key("fk_press_media_magazine_settings_press_media_id", "press_media_magazine_settings", "press_media", ["press_media_id"], ["id"])
    op.create_foreign_key("fk_committee_subcategories_category_id", "committee_subcategories", "committee_categories", ["category_id"], ["id"])
    op.create_foreign_key("fk_committee_members_member_id", "committee_members", "members", ["member_id"], ["id"])
    op.create_foreign_key("fk_committee_members_photo_file_id", "committee_members", "file_attachments", ["photo_file_id"], ["id"])
    op.create_foreign_key("fk_committee_member_links_committee_member_id", "committee_member_links", "committee_members", ["committee_member_id"], ["id"])
    op.create_foreign_key("fk_committee_member_links_category_id", "committee_member_links", "committee_categories", ["category_id"], ["id"])
    op.create_foreign_key("fk_committee_member_links_subcategory_id", "committee_member_links", "committee_subcategories", ["subcategory_id"], ["id"])
    op.create_foreign_key("fk_refresh_tokens_user_id", "refresh_tokens", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_password_reset_tokens_user_id", "password_reset_tokens", "users", ["user_id"], ["id"])
    op.create_foreign_key("fk_file_attachments_uploaded_by", "file_attachments", "users", ["uploaded_by"], ["id"])
    op.create_foreign_key("fk_approval_actions_workflow_id", "approval_actions", "approval_workflows", ["workflow_id"], ["id"])
    op.create_foreign_key("fk_approval_actions_acted_by", "approval_actions", "users", ["acted_by"], ["id"])
    op.create_foreign_key("fk_system_error_logs_user_id", "system_error_logs", "users", ["user_id"], ["id"])

    # Useful lookup and uniqueness constraints.
    op.create_index("ix_states_name", "states", ["name"], unique=false)
    op.create_index("ix_membership_types_name", "membership_types", ["name"], unique=false)
    op.create_index("ix_roles_name", "roles", ["name"], unique=false)
    op.create_index("ix_permissions_code", "permissions", ["code"], unique=false)
    op.create_index("ix_members_membership_no", "members", ["membership_no"], unique=true)
    op.create_index("ix_receipts_receipt_no", "receipts", ["receipt_no"], unique=true)
    op.create_index("ix_number_sequences_sequence_key", "number_sequences", ["sequence_key"], unique=true)

def downgrade():
    op.drop_table("system_error_logs")
    op.drop_table("number_sequences")
    op.drop_table("approval_actions")
    op.drop_table("approval_workflows")
    op.drop_table("file_attachments")
    op.drop_table("password_reset_tokens")
    op.drop_table("refresh_tokens")
    op.drop_table("committee_terms")
    op.drop_table("committee_member_links")
    op.drop_table("committee_members")
    op.drop_table("committee_subcategories")
    op.drop_table("committee_categories")
    op.drop_table("press_media_magazine_settings")
    op.drop_table("press_media")
    op.drop_table("associate_magazine_settings")
    op.drop_table("associates")
    op.drop_table("affiliation_magazine_settings")
    op.drop_table("affiliation_contacts")
    op.drop_table("affiliations")
    op.drop_table("event_attachments")
    op.drop_table("event_member_links")
    op.drop_table("event_participants")
    op.drop_table("events")
    op.drop_table("member_activity_logs")
    op.drop_table("user_activity_logs")
    op.drop_table("notification_import_batches")
    op.drop_table("notification_delivery_logs")
    op.drop_table("notification_messages")
    op.drop_table("notification_recipients")
    op.drop_table("notification_campaigns")
    op.drop_table("notification_templates")
    op.drop_table("report_export_logs")
    op.drop_table("saved_reports")
    op.drop_table("magazine_label_batch_items")
    op.drop_table("magazine_label_batches")
    op.drop_table("magazine_delivery_batches")
    op.drop_table("magazine_returns")
    op.drop_table("magazine_delivery_pauses")
    op.drop_table("magazine_subscriptions")
    op.drop_table("refund_transactions")
    op.drop_table("receipt_cancellations")
    op.drop_table("payment_transactions")
    op.drop_table("receipt_allocations")
    op.drop_table("receipt_items")
    op.drop_table("receipts")
    op.drop_table("member_kyc_requests")
    op.drop_table("member_deletion_requests")
    op.drop_table("membership_type_history")
    op.drop_table("membership_type_change_requests")
    op.drop_table("member_profile_history")
    op.drop_table("member_profile_change_requests")
    op.drop_table("member_approval_history")
    op.drop_table("member_documents")
    op.drop_table("member_memberships")
    op.drop_table("members")
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")
    op.drop_table("users")
    op.drop_table("service_types")
    op.drop_table("document_types")
    op.drop_table("hms_settings")
    op.drop_table("membership_type_prices")
    op.drop_table("membership_types")
    op.drop_table("postal_codes")
    op.drop_table("taluks")
    op.drop_table("districts")
    op.drop_table("states")
