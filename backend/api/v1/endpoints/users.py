"""Users, roles, privileges and the module tree.

Rules (same as the Anegudde inventory system):

* one role per user (users.role_id);
* rank_level: 1 is the top, larger is weaker. A user can only see, create,
  edit or delete users — and a role holder can only see, create, edit,
  delete or re-privilege roles — that are strictly weaker than their own
  role (``target.rank_level > my.rank_level``);
* privileges are ``<module>.read|write|delete``; a role with ``is_all_access``
  bypasses privilege checks (never the rank rules);
* a module can be disabled or limited with ``min_rank_level``; both are
  enforced for every privilege linked to it;
* any change to a user's identity, role, status or password rotates their
  ``security_stamp``, which invalidates all of their existing sessions;
* module / privilege-catalog management is Rank 1 only.
"""

import uuid
from typing import Any, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api import deps
from core.pagination import paginate
from core.security import PasswordPolicyError, get_password_hash, validate_password_strength
from crud import users as crud_users
from models.users import Module, Permission, Role, RolePermission, User
from schemas import users as schemas_users
from schemas.common import PendingApproval
from services import approval_gate

router = APIRouter()

_ROLE_TO_USER_TYPE = {"SUPERADMIN": "SUPERADMIN", "ADMIN": "ADMIN", "STAFF": "STAFF", "MEMBER": "MEMBER"}


def _user_type_for(role: Role) -> str:
    return _ROLE_TO_USER_TYPE.get(role.code, "STAFF")


def _new_stamp() -> str:
    return str(uuid.uuid4())


def _check_password(password: str) -> None:
    try:
        validate_password_strength(password)
    except PasswordPolicyError as exc:
        raise HTTPException(400, str(exc))


# ═════════════════════════ USERS ═════════════════════════
@router.get("/")
def read_users(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("users.management.read")),
    page: int = 1, limit: int = 20,
    search: Optional[str] = None,
    status: Optional[bool] = None,
    role_id: Optional[int] = None,
) -> Any:
    """Only users with a strictly weaker role than yours are listed."""
    my_rank = deps.user_rank(db, current_user)
    q = (
        db.query(User)
        .join(Role, Role.id == User.role_id)
        .filter(User.is_deleted == False, Role.rank_level > my_rank)  # noqa: E712
    )
    if search:
        like = f"%{search}%"
        q = q.filter(User.name.ilike(like) | User.username.ilike(like) | User.email.ilike(like))
    if status is not None:
        q = q.filter(User.status == status)
    if role_id is not None:
        q = q.filter(User.role_id == role_id)
    page_data = paginate(q.order_by(User.id.desc()), page, limit, exclude={"password_hash", "security_stamp"})
    roles = {r.id: r for r in db.query(Role).filter(Role.id.in_({u["role_id"] for u in page_data["data"] if u.get("role_id")} or {0})).all()}
    for u in page_data["data"]:
        r = roles.get(u.get("role_id"))
        u["role_name"] = r.name if r else None
        u["role_rank_level"] = r.rank_level if r else None
    return page_data


@router.post("/", response_model=schemas_users.UserWithRole)
# Not @approval_gate.gated: user_in carries a plaintext password — the
# generic engine stores its captured payload as JSON at rest, which would
# mean storing that password in the clear.
def create_user(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("users.management.write")),
    user_in: schemas_users.UserCreate,
) -> Any:
    if db.query(User).filter(User.username == user_in.username).first():
        raise HTTPException(400, f"Username '{user_in.username}' already exists")
    role = db.query(Role).filter(Role.id == user_in.role_id, Role.is_deleted == False, Role.status == True).first()  # noqa: E712
    if not role:
        raise HTTPException(400, "Invalid role_id")
    if role.rank_level <= deps.user_rank(db, current_user):
        raise HTTPException(403, "Cannot create a user with a rank equal or higher than yours")
    _check_password(user_in.password)
    data = user_in.model_dump()
    data["password_hash"] = get_password_hash(data.pop("password"))
    obj = User(**data, user_type=_user_type_for(role), created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    out = schemas_users.UserWithRole.model_validate(obj, from_attributes=True)
    out.role = schemas_users.RoleBrief.model_validate(role, from_attributes=True)
    return out


# ═════════════════════════ MODULES (Rank 1) ═════════════════════════
def _module_permission_count(db: Session, module_id: int) -> int:
    return db.query(Permission).filter(Permission.module_id == module_id, Permission.is_deleted == False).count()  # noqa: E712


def _module_dict(m: Module, children: list, privileges: list) -> dict:
    return {
        "id": m.id, "code": m.code, "name": m.name_en, "name_en": m.name_en, "name_kn": m.name_kn,
        "icon": m.icon, "route": m.route, "parent_id": m.parent_id,
        "opens_module_id": m.opens_module_id, "display_order": m.display_order,
        "min_rank_level": m.min_rank_level, "status": m.status,
        "permission_code": m.permission_code,
        "submodules": children,
        "privileges": [
            {"id": p.id, "code": p.code, "name": p.name, "description": p.description, "status": p.status}
            for p in privileges
        ],
    }


def _modules_with_privileges(db: Session):
    modules = (
        db.query(Module).filter(Module.is_deleted == False, Module.status == True)  # noqa: E712
        .order_by(Module.display_order, Module.id).all()
    )
    privs: dict = {}
    for p in db.query(Permission).filter(Permission.is_deleted == False, Permission.status == True).order_by(Permission.code).all():  # noqa: E712
        privs.setdefault(p.module_id, []).append(p)
    by_parent: dict = {}
    for m in modules:
        by_parent.setdefault(m.parent_id, []).append(m)
    return by_parent, privs


@router.get("/modules/menu")
def my_menu(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)) -> Any:
    """Sidebar menu for the current user: enabled modules within the role's
    rank, limited to the role's module scope; a leaf shows only when the role
    holds one of its privileges (all-access roles see everything)."""
    role = deps.get_user_role(db, current_user)
    if not role or not role.status:
        return []
    rank = role.rank_level
    held = deps.user_permission_codes(db, current_user)
    by_parent, privs = _modules_with_privileges(db)

    def build(m: Module):
        if m.min_rank_level is not None and rank > m.min_rank_level:
            return None
        kids, seen = [], set()
        for c in by_parent.get(m.id, []):
            t = build(c)
            if t:
                key = t["route"] or f"name:{t['name'].lower()}"
                if key in seen:
                    continue
                seen.add(key)
                kids.append(t)
        mine = privs.get(m.id, [])
        visible = bool(kids)
        if not visible:
            if role.is_all_access:
                visible = bool(m.route or m.parent_id is None)
            elif m.permission_code:
                # page gated by one explicit privilege
                visible = bool(m.route) and m.permission_code in held
            elif mine:
                visible = bool(m.route) and any(p.code in held for p in mine if p.code.endswith(".read"))
            else:
                # no privilege gate configured: the rank gate above is all that applies
                visible = bool(m.route)
        if not visible:
            return None
        return _module_dict(m, kids, [p for p in mine if role.is_all_access or p.code in held])

    if role.module_id:
        scope = next((m for ms in by_parent.values() for m in ms if m.id == role.module_id), None)
        roots = [scope] if scope else []
    else:
        roots = by_parent.get(None, [])
    return [t for t in (build(r) for r in roots) if t]


@router.get("/modules/privilege-tree")
def privilege_tree(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("users.privileges.read", "roles.read")),
) -> Any:
    """Full module tree with the privileges under each module, for the role
    privilege screen. Modules above your rank and Rank-1-only privileges are
    left out."""
    rank = deps.user_rank(db, current_user)
    by_parent, privs = _modules_with_privileges(db)

    def build(m: Module):
        if m.min_rank_level is not None and rank > m.min_rank_level:
            return None
        kids = [t for t in (build(c) for c in by_parent.get(m.id, [])) if t]
        mine = privs.get(m.id, [])
        if not kids and not mine:
            return None
        return _module_dict(m, kids, mine)

    return [t for t in (build(r) for r in by_parent.get(None, [])) if t]


@router.get("/modules")
def read_modules(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_superuser),
    page: int = 1, limit: int = 100,
    search: Optional[str] = None, status: Optional[bool] = None,
) -> Any:
    q = db.query(Module).filter(Module.is_deleted == False)  # noqa: E712
    if search:
        q = q.filter(Module.name_en.ilike(f"%{search}%") | Module.code.ilike(f"%{search}%"))
    if status is not None:
        q = q.filter(Module.status == status)
    page_data = paginate(q.order_by(Module.display_order, Module.id), page, limit)
    for module in page_data["data"]:
        module["permission_count"] = _module_permission_count(db, module["id"])
    return page_data


@router.get("/modules/{module_id}", response_model=schemas_users.ModuleWithPermissionCount)
def read_module(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_active_superuser), module_id: int) -> Any:
    module = crud_users.module.get(db, module_id)
    if not module:
        raise HTTPException(404, "Module not found")
    out = schemas_users.ModuleWithPermissionCount.model_validate(module, from_attributes=True)
    out.permission_count = _module_permission_count(db, module.id)
    return out


def _check_permission_code(db: Session, code) -> None:
    if code and not db.query(Permission).filter(Permission.code == code, Permission.is_deleted == False).first():  # noqa: E712
        raise HTTPException(400, f"permission_code '{code}' is not a known privilege")


def _check_module_refs(db: Session, parent_id, opens_id, own_id=None) -> None:
    for label, ref in (("parent_id", parent_id), ("opens_module_id", opens_id)):
        if ref is not None:
            if ref == own_id:
                raise HTTPException(400, f"{label} cannot point at the module itself")
            if not crud_users.module.get(db, ref):
                raise HTTPException(400, f"{label} {ref} not found")


@router.post("/modules", response_model=schemas_users.Module)
def create_module(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_active_superuser), module_in: schemas_users.ModuleCreate) -> Any:
    if db.query(Module).filter(Module.code == module_in.code, Module.is_deleted == False).first():  # noqa: E712
        raise HTTPException(409, f"Module code '{module_in.code}' already exists")
    _check_module_refs(db, module_in.parent_id, module_in.opens_module_id)
    _check_permission_code(db, module_in.permission_code)
    return crud_users.module.create(db=db, obj_in=module_in, created_by=current_user.id)


@router.put("/modules/{module_id}", response_model=schemas_users.Module)
def update_module(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_active_superuser), module_id: int, module_in: schemas_users.ModuleUpdate) -> Any:
    module = crud_users.module.get(db, module_id)
    if not module:
        raise HTTPException(404, "Module not found")
    data = module_in.model_dump(exclude_unset=True)
    _check_module_refs(db, data.get("parent_id"), data.get("opens_module_id"), own_id=module_id)
    _check_permission_code(db, data.get("permission_code"))
    return crud_users.module.update(db, db_obj=module, obj_in=module_in, updated_by=current_user.id)


@router.delete("/modules/{module_id}", response_model=schemas_users.Module)
def delete_module(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_active_superuser), module_id: int) -> Any:
    module = crud_users.module.get(db, module_id)
    if not module:
        raise HTTPException(404, "Module not found")
    if _module_permission_count(db, module.id) > 0:
        raise HTTPException(409, "Module has permissions assigned to it and cannot be deleted")
    if db.query(Module).filter(Module.parent_id == module_id, Module.is_deleted == False).count():  # noqa: E712
        raise HTTPException(400, "Cannot delete a module that has submodules")
    return crud_users.module.remove(db, id=module_id, deleted_by=current_user.id)


@router.post("/modules/{module_id}/link-privileges")
def link_privileges(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_superuser),
    module_id: int, permission_ids: List[int],
) -> Any:
    """Attach privileges to a module (Rank 1)."""
    module = crud_users.module.get(db, module_id)
    if not module:
        raise HTTPException(404, "Module not found")
    perms = db.query(Permission).filter(Permission.id.in_(permission_ids), Permission.is_deleted == False).all()  # noqa: E712
    if len(perms) != len(set(permission_ids)):
        raise HTTPException(400, "One or more permission ids are invalid")
    for p in perms:
        p.module_id = module.id
        p.module = module.code
    db.commit()
    return {"message": f"{len(perms)} privilege(s) linked to '{module.name_en}'"}


# ═════════════════════════ ROLES ═════════════════════════
def _role_user_count(db: Session, role_id: int) -> int:
    return db.query(User).filter(User.role_id == role_id, User.is_deleted == False).count()  # noqa: E712


def _role_permission_codes(db: Session, role_id: int) -> List[str]:
    rows = (
        db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False)  # noqa: E712
        .all()
    )
    return [r[0] for r in rows]


def _visible_role(db: Session, me: User, role: Optional[Role]) -> Role:
    """404 unless the role exists and is strictly weaker than mine (Rank 1
    may also see its own rank)."""
    if not role or role.is_deleted:
        raise HTTPException(404, "Role not found")
    my_rank = deps.user_rank(db, me)
    if my_rank != 1 and role.rank_level <= my_rank:
        raise HTTPException(403, "Cannot access a role with the same or higher rank than yours")
    return role


def _manageable_role(db: Session, me: User, role: Optional[Role]) -> Role:
    """The role must be strictly weaker than mine, always (Rank 1 included)."""
    if not role or role.is_deleted:
        raise HTTPException(404, "Role not found")
    if role.rank_level <= deps.user_rank(db, me):
        raise HTTPException(403, "Cannot modify a role with the same or higher rank than yours")
    return role


_ROLE_READERS = ("roles.read", "users.management.read", "users.privileges.read")


@router.get("/roles")
def read_roles(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission(*_ROLE_READERS)),
    page: int = 1, limit: int = 50,
) -> Any:
    """Roles weaker than yours (Rank 1 sees every role)."""
    my_rank = deps.user_rank(db, current_user)
    q = db.query(Role).filter(Role.is_deleted == False)  # noqa: E712
    if my_rank > 1:
        q = q.filter(Role.rank_level > my_rank)
    page_data = paginate(q.order_by(Role.rank_level, Role.id), page, limit)
    for role in page_data["data"]:
        role["permission_codes"] = _role_permission_codes(db, role["id"])
        role["user_count"] = _role_user_count(db, role["id"])
    return page_data


@router.get("/roles/{role_id}", response_model=schemas_users.RoleWithPermissions)
def read_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_any_permission(*_ROLE_READERS)), role_id: int) -> Any:
    role = _visible_role(db, current_user, crud_users.role.get(db, role_id))
    out = schemas_users.RoleWithPermissions.model_validate(role, from_attributes=True)
    out.permission_codes = _role_permission_codes(db, role_id)
    out.user_count = _role_user_count(db, role_id)
    return out


def _check_role_scope_module(db: Session, module_id: Optional[int]) -> None:
    if module_id is not None and not crud_users.module.get(db, module_id):
        raise HTTPException(400, f"module_id {module_id} not found")


@router.post("/roles", response_model=Union[schemas_users.Role, PendingApproval])
@approval_gate.gated("users", "CREATE", "Role", "roles.write")
def create_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("roles.write")), role_in: schemas_users.RoleCreate) -> Any:
    if role_in.rank_level <= deps.user_rank(db, current_user):
        raise HTTPException(400, "Cannot create a role with the same or higher rank than yours")
    if role_in.is_all_access and not deps.is_all_access(db, current_user):
        raise HTTPException(403, "Only an all-access role can create another all-access role")
    if db.query(Role).filter(Role.code == role_in.code, Role.is_deleted == False).first():  # noqa: E712
        raise HTTPException(400, f"Role code '{role_in.code}' already exists")
    if db.query(Role).filter(Role.name == role_in.name, Role.is_deleted == False).first():  # noqa: E712
        raise HTTPException(400, "Role name already exists")
    _check_role_scope_module(db, role_in.module_id)
    return crud_users.role.create(db=db, obj_in=role_in, created_by=current_user.id)


@router.put("/roles/{role_id}", response_model=Union[schemas_users.Role, PendingApproval])
@approval_gate.gated("users", "UPDATE", "Role", "roles.write", id_param="role_id")
def update_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("roles.write")), role_id: int, role_in: schemas_users.RoleUpdate) -> Any:
    role = _manageable_role(db, current_user, crud_users.role.get(db, role_id))
    data = role_in.model_dump(exclude_unset=True)
    my_rank = deps.user_rank(db, current_user)
    if data.get("rank_level") is not None and data["rank_level"] <= my_rank:
        raise HTTPException(400, "New rank must be weaker than yours")
    if data.get("is_all_access") and not deps.is_all_access(db, current_user):
        raise HTTPException(403, "Only an all-access role can grant all-access")
    if data.get("name") and data["name"] != role.name and db.query(Role).filter(Role.name == data["name"], Role.is_deleted == False, Role.id != role_id).first():  # noqa: E712
        raise HTTPException(400, "Role name already exists")
    if "status" in data and data["status"] is False and _role_user_count(db, role_id) > 0:
        raise HTTPException(409, "Role is assigned to users; reassign them before deactivating")
    if "module_id" in data:
        _check_role_scope_module(db, data["module_id"])
    return crud_users.role.update(db, db_obj=role, obj_in=role_in, updated_by=current_user.id)


@router.delete("/roles/{role_id}", response_model=Union[schemas_users.Role, PendingApproval])
@approval_gate.gated("users", "DELETE", "Role", "roles.delete", id_param="role_id")
def delete_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("roles.delete")), role_id: int) -> Any:
    role = _manageable_role(db, current_user, crud_users.role.get(db, role_id))
    if role.code in ("SUPERADMIN", "MEMBER"):
        raise HTTPException(409, f"The built-in {role.code} role cannot be deleted")
    count = _role_user_count(db, role_id)
    if count > 0:
        raise HTTPException(400, f"Cannot delete role. It is assigned to {count} user(s).")
    return crud_users.role.remove(db, id=role_id, deleted_by=current_user.id)


# ═════════════════════════ ROLE ↔ PRIVILEGES ═════════════════════════
@router.get("/roles/{role_id}/permissions")
def list_role_permissions(
    *, db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("users.privileges.read", "roles.read")),
    role_id: int,
) -> Any:
    _visible_role(db, current_user, crud_users.role.get(db, role_id))
    rows = (
        db.query(Permission, RolePermission.requires_approval)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False)  # noqa: E712
        .all()
    )
    return [
        {"id": p.id, "module": p.module, "module_id": p.module_id, "code": p.code, "name": p.name, "requires_approval": requires_approval}
        for p, requires_approval in rows
    ]


def _check_grantable(db: Session, role: Role, perms: List[Permission], me: User) -> None:
    """A role cannot be given privileges from a module its rank is locked out
    of (module.min_rank_level, read from the modules table)."""
    modules = {m.id: m for m in db.query(Module).filter(Module.id.in_({p.module_id for p in perms if p.module_id} or {0})).all()}
    blocked = [
        p.code for p in perms
        if p.module_id in modules
        and modules[p.module_id].min_rank_level is not None
        and role.rank_level > modules[p.module_id].min_rank_level
    ]
    if blocked:
        raise HTTPException(403, f"Selected role rank cannot access: {', '.join(sorted(blocked))}")


@router.post("/roles/{role_id}/permissions")
@approval_gate.gated("users", "CREATE", "RolePermission", "users.privileges.write", id_param="role_id")
def grant_role_permission(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.privileges.write")), role_id: int, permission_id: Optional[int] = None, code: Optional[str] = None, requires_approval: bool = False) -> Any:
    """Grant a privilege to a role, by permission_id or code.

    requires_approval: if true, a holder of this privilege via this role
    doesn't act directly — the action auto-files an approval request
    instead (see api.deps.permission_requires_approval). Calling this again
    on an existing grant updates the flag rather than erroring.
    """
    role = _manageable_role(db, current_user, crud_users.role.get(db, role_id))
    q = db.query(Permission).filter(Permission.is_deleted == False, Permission.status == True)  # noqa: E712
    perm = q.filter(Permission.id == permission_id).first() if permission_id else q.filter(Permission.code == code).first()
    if not perm:
        raise HTTPException(404, f"Permission not found ({'id ' + str(permission_id) if permission_id else 'code ' + str(code)})")
    _check_grantable(db, role, [perm], current_user)

    existing = db.query(RolePermission).filter(
        RolePermission.role_id == role_id,
        RolePermission.permission_id == perm.id,
        RolePermission.is_deleted == False,  # noqa: E712
    ).first()
    if existing:
        if existing.requires_approval != requires_approval:
            existing.requires_approval = requires_approval
            existing.updated_by = current_user.id
            db.commit()
            return {"message": f"Permission '{perm.code}' updated (requires_approval={requires_approval})"}
        return {"message": f"Role already has permission '{perm.code}'"}

    db.add(RolePermission(
        role_id=role_id, permission_id=perm.id,
        requires_approval=requires_approval, created_by=current_user.id,
    ))
    db.commit()
    return {"message": f"Permission '{perm.code}' granted to role '{role.name}' (requires_approval={requires_approval})"}


@router.put("/roles/{role_id}/permissions")
@approval_gate.gated("users", "UPDATE", "RolePermission", "users.privileges.write", id_param="role_id")
def set_role_permissions(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.privileges.write")), role_id: int, payload: schemas_users.RolePermissionSet) -> Any:
    """Bulk-configure a role's privileges: grant missing, revoke absent,
    sync requires_approval on everything that stays (single commit)."""
    role = _manageable_role(db, current_user, crud_users.role.get(db, role_id))

    requested = list(dict.fromkeys(payload.permission_codes))  # dedupe, keep order
    perms = (
        db.query(Permission)
        .filter(Permission.code.in_(requested), Permission.is_deleted == False, Permission.status == True)  # noqa: E712
        .all()
        if requested
        else []
    )
    unknown = set(requested) - {p.code for p in perms}
    if unknown:
        raise HTTPException(400, f"Unknown permission code(s): {', '.join(sorted(unknown))}")
    _check_grantable(db, role, perms, current_user)

    approval_required = set(payload.approval_required_codes)
    unknown_gated = approval_required - set(requested)
    if unknown_gated:
        raise HTTPException(400, f"approval_required_codes must be a subset of permission_codes: {', '.join(sorted(unknown_gated))}")

    codes_by_id = {p.id: p.code for p in perms}
    gated_ids = {p.id for p in perms if p.code in approval_required}

    current_links = (
        db.query(RolePermission)
        .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False)  # noqa: E712
        .all()
    )
    by_perm = {lp.permission_id: lp for lp in current_links}
    target_ids = {p.id for p in perms}

    granted, revoked = [], []
    for pid in target_ids - set(by_perm):
        db.add(RolePermission(
            role_id=role_id, permission_id=pid,
            requires_approval=pid in gated_ids, created_by=current_user.id,
        ))
        granted.append(pid)
    for lp in current_links:
        if lp.permission_id not in target_ids:
            lp.is_deleted = True
            lp.deleted_by = current_user.id
            revoked.append(lp.permission_id)
        else:
            desired = lp.permission_id in gated_ids
            if lp.requires_approval != desired:
                lp.requires_approval = desired
                lp.updated_by = current_user.id
    db.commit()

    all_codes = {p.id: p.code for p in db.query(Permission).filter(Permission.id.in_(revoked)).all()} if revoked else {}
    revoked_codes = [all_codes.get(pid, str(pid)) for pid in revoked]
    return {
        "message": f"Role '{role.name}' now has {len(target_ids)} permission(s)",
        "granted": [codes_by_id[pid] for pid in granted],
        "revoked": revoked_codes,
        "permission_codes": sorted(codes_by_id.values()),
        "approval_required_codes": sorted(approval_required),
    }


@router.delete("/roles/{role_id}/permissions/{permission_id}")
@approval_gate.gated("users", "DELETE", "RolePermission", "users.privileges.write", id_param="permission_id")
def revoke_role_permission(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.privileges.write")), role_id: int, permission_id: int) -> Any:
    _manageable_role(db, current_user, crud_users.role.get(db, role_id))
    link = db.query(RolePermission).filter(
        RolePermission.role_id == role_id,
        RolePermission.permission_id == permission_id,
        RolePermission.is_deleted == False,  # noqa: E712
    ).first()
    if not link:
        raise HTTPException(404, "Permission is not granted to this role")
    link.is_deleted = True
    link.deleted_by = current_user.id
    db.commit()
    return {"message": "Permission revoked"}


# ═════════════════════════ PRIVILEGE CATALOG ═════════════════════════
@router.get("/permissions")
def read_permissions(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_any_permission("users.privileges.read", "roles.read")),
    page: int = 1, limit: int = 100,
) -> Any:
    q = db.query(Permission).filter(Permission.is_deleted == False, Permission.status == True)  # noqa: E712
    # Privileges of modules above your rank (modules.min_rank_level) stay hidden.
    my_rank = deps.user_rank(db, current_user)
    locked = [m.id for m in db.query(Module.id, Module.min_rank_level).filter(
        Module.min_rank_level.isnot(None), Module.min_rank_level < my_rank).all()]
    if locked:
        q = q.filter(~Permission.module_id.in_(locked))
    return paginate(q.order_by(Permission.code), page, limit)


# ═════════════════════════ USER BY ID ═════════════════════════
def _visible_user(db: Session, me: User, user: Optional[User]) -> User:
    """A user is only reachable if their role is strictly weaker than mine
    (you can always reach yourself)."""
    if not user or user.is_deleted:
        raise HTTPException(404, "User not found")
    if user.id == me.id:
        return user
    target = deps.get_user_role(db, user)
    if (target.rank_level if target else 99) <= deps.user_rank(db, me):
        raise HTTPException(403, "Unauthorized to access a user with the same or higher rank")
    return user


@router.get("/{user_id}/permissions")
def get_user_permissions(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.management.read")), user_id: int) -> Any:
    """The privileges a user holds through their role."""
    user = _visible_user(db, current_user, crud_users.user.get(db, user_id))
    role = deps.get_user_role(db, user)
    if not role:
        return []
    q = db.query(Permission).filter(Permission.is_deleted == False, Permission.status == True)  # noqa: E712
    if not role.is_all_access:
        q = q.join(RolePermission, RolePermission.permission_id == Permission.id).filter(
            RolePermission.role_id == role.id, RolePermission.is_deleted == False)  # noqa: E712
    return [{"id": p.id, "module": p.module, "module_id": p.module_id, "code": p.code, "name": p.name} for p in q.all()]


@router.get("/{id}", response_model=schemas_users.UserWithRole)
def read_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.management.read")), id: int) -> Any:
    user = _visible_user(db, current_user, crud_users.user.get(db, id))
    out = schemas_users.UserWithRole.model_validate(user, from_attributes=True)
    role = deps.get_user_role(db, user)
    out.role = schemas_users.RoleBrief.model_validate(role, from_attributes=True) if role else None
    return out


@router.put("/{id}", response_model=schemas_users.UserWithRole)
# Not @approval_gate.gated: user_in can carry a plaintext password (admin
# reset) — see the note on create_user above.
def update_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.management.write")), id: int, user_in: schemas_users.UserUpdate) -> Any:
    user = _visible_user(db, current_user, crud_users.user.get(db, id))
    data = user_in.model_dump(exclude_unset=True)
    is_self = id == current_user.id
    changed = False

    if "username" in data and data["username"] and data["username"] != user.username:
        if db.query(User).filter(User.username == data["username"], User.id != id).first():
            raise HTTPException(400, "Username already exists")
        changed = True
    else:
        data.pop("username", None)

    if "role_id" in data and data["role_id"] is not None and data["role_id"] != user.role_id:
        if is_self:
            raise HTTPException(400, "You cannot change your own role")
        new_role = db.query(Role).filter(Role.id == data["role_id"], Role.is_deleted == False, Role.status == True).first()  # noqa: E712
        if not new_role:
            raise HTTPException(400, "Invalid role_id")
        if new_role.rank_level <= deps.user_rank(db, current_user):
            raise HTTPException(403, "Cannot assign a rank equal or higher than yours")
        data["user_type"] = _user_type_for(new_role)
        changed = True
    else:
        data.pop("role_id", None)

    # An admin cannot lock themselves out.
    if "status" in data and data["status"] is False and is_self:
        raise HTTPException(400, "You cannot deactivate your own account")

    # Admin-initiated password reset goes through the same strength policy.
    new_password = data.pop("password", None)
    if new_password:
        _check_password(new_password)
        user.password_hash = get_password_hash(new_password)
        changed = True

    for field in ("name", "email", "mobile", "mobile_country_code", "status"):
        if field in data and data[field] != getattr(user, field):
            changed = True

    crud_users.user.update(db, db_obj=user, obj_in=data, updated_by=current_user.id)
    if changed:
        user.security_stamp = _new_stamp()  # sign the user out everywhere
        db.commit()
    db.refresh(user)
    db.info.pop("user_role", None)
    out = schemas_users.UserWithRole.model_validate(user, from_attributes=True)
    role = deps.get_user_role(db, user)
    out.role = schemas_users.RoleBrief.model_validate(role, from_attributes=True) if role else None
    return out


@router.delete("/{id}", response_model=Union[schemas_users.User, PendingApproval])
@approval_gate.gated("users", "DELETE", "User", "users.management.delete")
def delete_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.management.delete")), id: int) -> Any:
    if id == current_user.id:
        raise HTTPException(400, "Cannot delete your own account")
    user = _visible_user(db, current_user, crud_users.user.get(db, id))
    return crud_users.user.remove(db, id=id, deleted_by=current_user.id)
