"""Add Mangalya-parity member fields, masters and receipt renewal columns.

Revision ID: 20260923_0005
Revises: 20260923_0004
Create Date: 2026-09-23

* members: father_husband_name, blood_group, gotra_id, native_place_id/_text,
  qualification_id/_text, occupation, aadhaar_number, whatsapp_number,
  login_count, referred_by_member_id (+ FK)
* member_memberships: family_membership_number
* receipts: is_renewal, cheque_number, cheque_date
* new master tables: gothras, nakshatras, rashis, masas, mithis,
  samvathraras, qualifications, native_places
"""

import sqlalchemy as sa
from alembic import op

revision = "20260923_0005"
down_revision = "20260923_0004"
branch_labels = None
depends_on = None

MEMBER_COLUMNS = [
    # (column, type, server_default)
    ("father_husband_name", sa.String(150), None),
    ("blood_group", sa.String(10), None),
    ("gotra_id", sa.BigInteger(), None),
    ("nakshatra_id", sa.BigInteger(), None),
    ("rashi_id", sa.BigInteger(), None),
    ("masa_id", sa.BigInteger(), None),
    ("mithi_id", sa.BigInteger(), None),
    ("samvathsara_id", sa.BigInteger(), None),
    ("native_place_id", sa.BigInteger(), None),
    ("native_place_text", sa.String(150), None),
    ("qualification_id", sa.BigInteger(), None),
    ("qualification_text", sa.String(150), None),
    ("occupation", sa.String(150), None),
    ("aadhaar_number", sa.String(20), None),
    ("whatsapp_number", sa.String(20), None),
    ("login_count", sa.BigInteger(), "0"),
    ("referred_by_member_id", sa.BigInteger(), None),
]

MASTER_TABLES = ["gothras", "nakshatras", "rashis", "masas", "mithis", "samvathraras", "qualifications", "native_places"]


def _table_exists(inspector, name: str) -> bool:
    return name in inspector.get_table_names()


def _columns(inspector, table: str) -> set:
    return {c["name"] for c in inspector.get_columns(table)}


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


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ── master tables ──
    for table in MASTER_TABLES:
        if not _table_exists(inspector, table):
            _make_master(table)
    if _table_exists(inspector, "native_places"):
        cols = _columns(inspector, "native_places")
        if "district_id" not in cols:
            op.add_column("native_places", sa.Column("district_id", sa.BigInteger(), nullable=True))

    if not _table_exists(inspector, "members"):
        return
    cols = _columns(inspector, "members")

    # ── member columns ──
    for column, col_type, default in MEMBER_COLUMNS:
        if column in cols:
            continue
        op.add_column(
            "members",
            sa.Column(column, col_type, nullable=True,
                      server_default=sa.text(default) if default else None),
        )
        if default:
            op.alter_column("members", column, server_default=None)

    if "referred_by_member_id" in cols or True:
        existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("members")}
        if "fk_members_referred_by" not in existing_fks and _table_exists(inspector, "members"):
            try:
                op.create_foreign_key(
                    "fk_members_referred_by", "members", "members",
                    ["referred_by_member_id"], ["id"],
                )
            except Exception:
                pass  # column may not exist yet on very old databases

    # ── memberships ──
    if _table_exists(inspector, "member_memberships"):
        mcols = _columns(inspector, "member_memberships")
        if "family_membership_number" not in mcols:
            op.add_column("member_memberships", sa.Column("family_membership_number", sa.String(30), nullable=True))

    # ── receipts ──
    if _table_exists(inspector, "receipts"):
        rcols = _columns(inspector, "receipts")
        if "is_renewal" not in rcols:
            op.add_column("receipts", sa.Column("is_renewal", sa.Boolean(), nullable=False, server_default=sa.text("false")))
            op.alter_column("receipts", "is_renewal", server_default=None)
        if "cheque_number" not in rcols:
            op.add_column("receipts", sa.Column("cheque_number", sa.String(50), nullable=True))
        if "cheque_date" not in rcols:
            op.add_column("receipts", sa.Column("cheque_date", sa.Date(), nullable=True))

    # ── users: login tracking ──
    if _table_exists(inspector, "users"):
        ucols = _columns(inspector, "users")
        if "login_count" not in ucols:
            op.add_column("users", sa.Column("login_count", sa.Integer(), nullable=False, server_default=sa.text("0")))
        if "last_login_method" not in ucols:
            op.add_column("users", sa.Column("last_login_method", sa.String(20), nullable=True))

    # ── user_activity_logs: user_id becomes nullable (unknown-username
    # login failures are recorded without a user) ──
    if _table_exists(inspector, "user_activity_logs"):
        acols = _columns(inspector, "user_activity_logs")
        if "user_id" in acols:
            try:
                op.alter_column(
                    "user_activity_logs", "user_id",
                    existing_type=sa.BigInteger(), nullable=True,
                )
            except Exception:
                pass  # already nullable / FK constraint differences


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _table_exists(inspector, "receipts"):
        rcols = _columns(inspector, "receipts")
        for column in ("cheque_date", "cheque_number", "is_renewal"):
            if column in rcols:
                op.drop_column("receipts", column)

    if _table_exists(inspector, "member_memberships"):
        if "family_membership_number" in _columns(inspector, "member_memberships"):
            op.drop_column("member_memberships", "family_membership_number")

    if _table_exists(inspector, "user_activity_logs"):
        try:
            op.alter_column(
                "user_activity_logs", "user_id",
                existing_type=sa.BigInteger(), nullable=False,
            )
        except Exception:
            pass

    if _table_exists(inspector, "users"):
        ucols = _columns(inspector, "users")
        for column in ("last_login_method", "login_count"):
            if column in ucols:
                op.drop_column("users", column)

    if _table_exists(inspector, "members"):
        cols = _columns(inspector, "members")
        if "referred_by_member_id" in cols:
            try:
                op.drop_constraint("fk_members_referred_by", "members", type_="foreignkey")
            except Exception:
                pass
        for column, _, _ in reversed(MEMBER_COLUMNS):
            if column in cols:
                op.drop_column("members", column)

    for table in reversed(MASTER_TABLES):
        if _table_exists(inspector, table):
            op.drop_table(table)
