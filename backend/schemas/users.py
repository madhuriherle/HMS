import re
from typing import Optional, List

from core import rules
from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class RoleBrief(BaseModel):
    id: int
    code: str
    name: str
    rank_level: int
    is_all_access: bool
    status: bool
    model_config = ConfigDict(from_attributes=True)


# ── Users ────────────────────────────────────────────────────

def _check_email(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    v = v.strip()
    if not re.fullmatch(rules.EMAIL_PATTERN, v):
        raise ValueError("email is not a valid email address")
    return v


def _check_mobile(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    v = v.strip()
    if not v.isdigit() or not (rules.MOBILE_MIN_DIGITS <= len(v) <= rules.MOBILE_MAX_DIGITS):
        raise ValueError("mobile must be 10-12 digits")
    return v


def _check_username(v: Optional[str]) -> Optional[str]:
    if v is None:
        return v
    v = v.strip()
    if len(v) < rules.USERNAME_MIN_LENGTH:
        raise ValueError(f"username must be at least {rules.USERNAME_MIN_LENGTH} characters")
    if not re.fullmatch(rules.USERNAME_PATTERN, v):
        raise ValueError("username can only contain letters, numbers, dots and underscores")
    return v

class UserBase(BaseModel):
    name: str
    username: str
    email: Optional[str] = None
    mobile: Optional[str] = None
    mobile_country_code: str = "+91"
    status: bool = True

    @field_validator("username")
    @classmethod
    def _v_username(cls, v):
        return _check_username(v)

    @field_validator("email")
    @classmethod
    def _v_email(cls, v):
        return _check_email(v)

    @field_validator("mobile")
    @classmethod
    def _v_mobile(cls, v):
        return _check_mobile(v)


class UserCreate(UserBase):
    password: str
    role_id: int  # exactly one role per user


class UserUpdate(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    mobile_country_code: Optional[str] = None
    status: Optional[bool] = None
    role_id: Optional[int] = None
    password: Optional[str] = None  # admin reset; hashed before storage, never returned

    @field_validator("username")
    @classmethod
    def _v_username(cls, v):
        return _check_username(v)

    @field_validator("email")
    @classmethod
    def _v_email(cls, v):
        return _check_email(v)

    @field_validator("mobile")
    @classmethod
    def _v_mobile(cls, v):
        return _check_mobile(v)


class ProfileUpdate(BaseModel):
    """Self-service profile edit (no role / status / password here)."""
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    mobile_country_code: Optional[str] = None


class UserInDBBase(UserBase):
    id: int
    user_type: Optional[str] = None
    role_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class User(UserInDBBase):
    pass


class UserWithRole(User):
    role: Optional[RoleBrief] = None


# ── Modules ──────────────────────────────────────────────────
class ModuleBase(BaseModel):
    code: str
    name_en: str
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: bool = True
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    opens_module_id: Optional[int] = None
    route: Optional[str] = None
    display_order: int = 0
    min_rank_level: Optional[int] = None
    permission_code: Optional[str] = None


class ModuleCreate(ModuleBase):
    pass


class ModuleUpdate(BaseModel):
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    opens_module_id: Optional[int] = None
    route: Optional[str] = None
    display_order: Optional[int] = None
    min_rank_level: Optional[int] = None
    permission_code: Optional[str] = None
    # code is immutable — permissions reference it as a stable string key.


class Module(ModuleBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ModuleWithPermissionCount(Module):
    permission_count: int = 0


# ── Roles ────────────────────────────────────────────────────
class RoleBase(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    status: bool = True
    rank_level: int = 99
    is_all_access: bool = False
    module_id: Optional[int] = None

    @field_validator("module_id", mode="before")
    @classmethod
    def coerce_zero_module(cls, v):
        return None if v in (0, "0") else v


class RoleCreate(RoleBase):
    @model_validator(mode="before")
    @classmethod
    def _make_code(cls, data):
        if isinstance(data, dict) and not str(data.get("code") or "").strip() and data.get("name"):
            data = {**data, "code": rules.make_code(data["name"]).replace(" ", "_")}
        return data


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None
    rank_level: Optional[int] = None
    is_all_access: Optional[bool] = None
    module_id: Optional[int] = None

    @field_validator("module_id", mode="before")
    @classmethod
    def coerce_zero_module(cls, v):
        return None if v in (0, "0") else v


class Role(RoleBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class RoleWithPermissions(Role):
    permission_codes: List[str] = []
    user_count: int = 0


class RolePermissionSet(BaseModel):
    """Bulk replace a role's privileges. Empty list = strip the role.

    approval_required_codes is a subset of permission_codes: those grants
    are flagged requires_approval=True (holder still has the permission,
    but exercising it auto-files an approval request instead of executing
    directly). Any code not listed here defaults to un-gated.
    """
    permission_codes: List[str]
    approval_required_codes: List[str] = []


class RoleWithUserCount(Role):
    user_count: int = 0


# ── Permissions (privileges) ─────────────────────────────────
class PermissionBase(BaseModel):
    module: str
    module_id: Optional[int] = None
    name: str
    code: str
    description: Optional[str] = None
    status: bool = True


class PermissionCreate(PermissionBase):
    pass


class PermissionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None


class Permission(PermissionBase):
    id: int
    model_config = ConfigDict(from_attributes=True)
