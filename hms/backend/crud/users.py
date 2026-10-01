from crud.base import CRUDBase
from models.users import User, Role, Permission, UserRole, Module
from schemas.users import UserCreate, UserUpdate, RoleCreate, RoleUpdate, PermissionCreate, PermissionUpdate, UserRoleCreate, UserRoleUpdate, ModuleCreate, ModuleUpdate

class CRUDUser(CRUDBase[User, UserCreate, UserUpdate]):
    pass

class CRUDModule(CRUDBase[Module, ModuleCreate, ModuleUpdate]):
    pass

class CRUDRole(CRUDBase[Role, RoleCreate, RoleUpdate]):
    pass

class CRUDPermission(CRUDBase[Permission, PermissionCreate, PermissionUpdate]):
    pass

class CRUDUserRole(CRUDBase[UserRole, UserRoleCreate, UserRoleUpdate]):
    pass

user = CRUDUser(User)
module = CRUDModule(Module)
role = CRUDRole(Role)
permission = CRUDPermission(Permission)
user_role = CRUDUserRole(UserRole)
