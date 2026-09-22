from typing import Optional, Literal, List
from datetime import datetime
from pydantic import BaseModel, ConfigDict

UserType = Literal["SUPERADMIN", "ADMIN", "STAFF", "MEMBER"]

class UserBase(BaseModel):
    name: str
    username: str
    email: Optional[str] = None
    mobile: Optional[str] = None
    mobile_country_code: str = "+91"
    user_type: UserType
    status: bool = True

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    mobile: Optional[str] = None
    mobile_country_code: Optional[str] = None
    status: Optional[bool] = None
    password: Optional[str] = None  # admin reset; hashed before storage, never returned

    # username / user_type are immutable via this endpoint — identity and
    # privilege class shouldn't change silently on an edit.

class UserInDBBase(UserBase):
    id: int
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class User(UserInDBBase):
    pass

# Roles
class RoleBase(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    status: bool = True

class RoleCreate(RoleBase):
    pass

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[bool] = None

class Role(RoleBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class RoleWithPermissions(Role):
    permission_codes: List[str] = []
    user_count: int = 0


class RolePermissionSet(BaseModel):
    """Bulk replace a role's privileges. Empty list = strip the role."""
    permission_codes: List[str]


class RoleWithUserCount(Role):
    user_count: int = 0


class UserRoleOut(BaseModel):
    """A role assignment on a user."""
    id: int
    role_id: int
    role_code: str
    role_name: str
    scope_type: str
    scope_id: Optional[int] = None
    assigned_at: Optional[datetime] = None


class UserWithRoles(User):
    roles: List[UserRoleOut] = []

# Permissions
class PermissionBase(BaseModel):
    module: str
    name: str
    code: str
    description: Optional[str] = None

class PermissionCreate(PermissionBase):
    pass

class PermissionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class Permission(PermissionBase):
    id: int
    model_config = ConfigDict(from_attributes=True)

class UserRoleBase(BaseModel):
    user_id: int
    role_id: int
    scope_type: str = "GLOBAL"
    scope_id: Optional[int] = None

class UserRoleCreate(UserRoleBase):
    pass

class UserRoleUpdate(BaseModel):
    scope_type: Optional[str] = None
    scope_id: Optional[int] = None

class UserRole(UserRoleBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
