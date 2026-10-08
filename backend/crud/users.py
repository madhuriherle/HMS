from crud.base import CRUDBase
from models.users import User, Role, Permission, Module
from schemas.users import UserCreate, UserUpdate, RoleCreate, RoleUpdate, PermissionCreate, PermissionUpdate, ModuleCreate, ModuleUpdate

class CRUDUser(CRUDBase[User, UserCreate, UserUpdate]):
    pass

class CRUDModule(CRUDBase[Module, ModuleCreate, ModuleUpdate]):
    pass

class CRUDRole(CRUDBase[Role, RoleCreate, RoleUpdate]):
    pass

class CRUDPermission(CRUDBase[Permission, PermissionCreate, PermissionUpdate]):
    pass

user = CRUDUser(User)
module = CRUDModule(Module)
role = CRUDRole(Role)
permission = CRUDPermission(Permission)
