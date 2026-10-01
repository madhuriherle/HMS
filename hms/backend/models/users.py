from sqlalchemy import String, BigInteger, Boolean, DateTime, Text, ForeignKey, Enum, CheckConstraint, Index, Integer, text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin
from typing import Optional
import enum

class ScopeTypeEnum(str, enum.Enum):
    GLOBAL = "GLOBAL"
    STATE = "STATE"
    DISTRICT = "DISTRICT"
    TALUK = "TALUK"

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

class Role(AuditMixin, Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[bool] = mapped_column(Boolean, default=True)

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

class UserRole(AuditMixin, Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        Index(
            "uq_user_roles_active", "user_id", "role_id",
            unique=True,
            postgresql_where=text("is_deleted = false"),
            sqlite_where=text("is_deleted = false"),
        ),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    role_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("roles.id"), nullable=False)
    assigned_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    assigned_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), nullable=True)
    scope_type: Mapped[ScopeTypeEnum] = mapped_column(Enum(ScopeTypeEnum), default=ScopeTypeEnum.GLOBAL)
    scope_id: Mapped[int] = mapped_column(BigInteger, nullable=True)
