from sqlalchemy import String, BigInteger, Boolean, DateTime, Text, ForeignKey, Enum, CheckConstraint, Index, Integer, text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin
from typing import Optional
import enum

class User(AuditMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "user_type IN ('SUPERADMIN', 'ADMIN', 'STAFF', 'MEMBER')",
            name="ck_users_user_type",
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(191), nullable=True, index=True)
    mobile: Mapped[str] = mapped_column(String(20), nullable=True, index=True)
    mobile_country_code: Mapped[str] = mapped_column(String(5), default="+91")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    user_type: Mapped[str] = mapped_column(String(30), nullable=False)
    member_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    # Login tracking (Mangalya parity: userprofile.logincount / last_login_method).
    login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_login_method: Mapped[str] = mapped_column(String(20), nullable=True)
    # Exactly one role per user (Anegudde model): rank, privileges and the
    # all-access flag all come from it.
    role_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("roles.id"), nullable=True, index=True)
    # Rotated whenever the account's identity/role/status/password changes;
    # tokens carry it, so a mismatch invalidates every older session.
    security_stamp: Mapped[str] = mapped_column(String(100), nullable=True)

class Module(AuditMixin, Base):
    """RBAC module master (masters, users, members, receipts, …). Groups
    permissions for display and lets the module list itself be managed
    instead of living only as free-text strings on Permission.module."""
    __tablename__ = "modules"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name_en: Mapped[str] = mapped_column(String(100), nullable=False)
    name_kn: Mapped[str] = mapped_column(String(150), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    # Menu tree (sidebar): parent/child modules, the screen a leaf opens, and
    # an optional rank gate (roles ranked worse than min_rank_level are locked
    # out of every privilege in this module).
    icon: Mapped[str] = mapped_column(String(50), nullable=True)
    parent_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("modules.id"), nullable=True)
    opens_module_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("modules.id"), nullable=True)
    route: Mapped[str] = mapped_column(String(255), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    min_rank_level: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

class Role(AuditMixin, Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    # 1 = top; a larger number is a weaker role. Users/roles can only be
    # managed by someone with a strictly smaller rank_level.
    rank_level: Mapped[int] = mapped_column(Integer, nullable=False, default=99, server_default="99")
    # All-access roles bypass privilege checks (rank and module-status rules
    # still apply).
    is_all_access: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # Optional scope: the role's menu starts from this module branch.
    module_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("modules.id"), nullable=True)

class Permission(AuditMixin, Base): # Added missing AuditMixin!
    __tablename__ = "permissions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    # Kept as a plain string for backward-compat reads (several endpoints
    # already return p.module directly); module_id is the enforced FK — a
    # permission can't reference a module that isn't in the modules master.
    module: Mapped[str] = mapped_column(String(80), nullable=False)
    module_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("modules.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))

class RolePermission(AuditMixin, Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        # One *active* grant per role/permission; revoked rows are soft-deleted.
        Index(
            "uq_role_permissions_active", "role_id", "permission_id",
            unique=True,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    role_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("roles.id"), nullable=False)
    permission_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("permissions.id"), nullable=False)
    # When true, a holder of this permission (via this role) doesn't get to
    # act directly — the action auto-files an approval request instead of
    # executing (see api.deps.permission_requires_approval). Lets the same
    # permission code be "free" for one role and "gated" for another.
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
