from typing import Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from api import deps
from models.users import User, Role, Permission, RolePermission, UserRole, ScopeTypeEnum
from schemas import users as schemas_users
from crud import users as crud_users
from core.pagination import paginate
from core.security import get_password_hash, validate_password_strength, PasswordPolicyError
from datetime import datetime, timezone

router = APIRouter()

# NOTE: static sub-routes (/roles, /permissions) are declared BEFORE /{id},
# otherwise GET /users/roles is captured by the {id} path parameter.

# ─────────────── USERS ────────────────
@router.get("/")
def read_users(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 20, search: Optional[str] = None) -> Any:
    q = db.query(User).filter(User.is_deleted == False)
    if search:
        q = q.filter(User.name.ilike(f"%{search}%") | User.username.ilike(f"%{search}%"))
    # password_hash must never leave the API
    return paginate(q, page, limit, exclude={"password_hash"})

@router.post("/", response_model=schemas_users.User)
def create_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), user_in: schemas_users.UserCreate) -> Any:
    existing = db.query(User).filter(User.username == user_in.username).first()
    if existing:
        raise HTTPException(400, f"Username '{user_in.username}' already exists")
    try:
        validate_password_strength(user_in.password)
    except PasswordPolicyError as exc:
        raise HTTPException(400, str(exc))
    data = user_in.model_dump()
    data["password_hash"] = get_password_hash(data.pop("password"))
    obj = User(**data, created_by=current_user.id)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj

# ─────────────── ROLES ────────────────
def _role_user_count(db: Session, role_id: int) -> int:
    return (
        db.query(UserRole.user_id)
        .filter(UserRole.role_id == role_id, UserRole.is_deleted == False)
        .distinct()
        .count()
    )

def _role_permission_codes(db: Session, role_id: int) -> List[str]:
    rows = (
        db.query(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False)
        .all()
    )
    return [r[0] for r in rows]

@router.get("/roles")
def read_roles(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 50) -> Any:
    page_data = paginate(db.query(Role).filter(Role.is_deleted == False), page, limit)
    for role in page_data["data"]:
        role["permission_codes"] = _role_permission_codes(db, role["id"])
        role["user_count"] = _role_user_count(db, role["id"])
    return page_data

@router.get("/roles/{role_id}", response_model=schemas_users.RoleWithPermissions)
def read_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), role_id: int) -> Any:
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    out = schemas_users.RoleWithPermissions.model_validate(role, from_attributes=True)
    out.permission_codes = _role_permission_codes(db, role_id)
    out.user_count = _role_user_count(db, role_id)
    return out

@router.post("/roles", response_model=schemas_users.Role)
def create_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_in: schemas_users.RoleCreate) -> Any:
    existing = db.query(Role).filter(Role.code == role_in.code, Role.is_deleted == False).first()
    if existing:
        raise HTTPException(400, f"Role code '{role_in.code}' already exists")
    return crud_users.role.create(db=db, obj_in=role_in, created_by=current_user.id)

@router.put("/roles/{role_id}", response_model=schemas_users.Role)
def update_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_id: int, role_in: schemas_users.RoleUpdate) -> Any:
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    data = role_in.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is False and _role_user_count(db, role_id) > 0:
        raise HTTPException(409, "Role is assigned to users; unassign them before deactivating")
    return crud_users.role.update(db, db_obj=role, obj_in=role_in, updated_by=current_user.id)

@router.delete("/roles/{role_id}", response_model=schemas_users.Role)
def delete_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_id: int) -> Any:
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    if _role_user_count(db, role_id) > 0:
        raise HTTPException(409, "Role is assigned to users; unassign it before deleting")
    return crud_users.role.remove(db, id=role_id, deleted_by=current_user.id)

# ─────────────── ROLE ↔ PERMISSIONS ────────────────
@router.get("/roles/{role_id}/permissions")
def list_role_permissions(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), role_id: int) -> Any:
    rows = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False)
        .all()
    )
    return [{"id": p.id, "module": p.module, "code": p.code, "name": p.name} for p in rows]

@router.post("/roles/{role_id}/permissions")
def grant_role_permission(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_id: int, permission_id: Optional[int] = None, code: Optional[str] = None) -> Any:
    """Grant a permission to a role, by permission_id or code."""
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")

    q = db.query(Permission).filter(Permission.is_deleted == False)
    perm = q.filter(Permission.id == permission_id).first() if permission_id else q.filter(Permission.code == code).first()
    if not perm:
        raise HTTPException(404, f"Permission not found ({'id ' + str(permission_id) if permission_id else 'code ' + str(code)})")

    existing = db.query(RolePermission).filter(
        RolePermission.role_id == role_id,
        RolePermission.permission_id == perm.id,
        RolePermission.is_deleted == False,
    ).first()
    if existing:
        return {"message": f"Role already has permission '{perm.code}'"}

    db.add(RolePermission(role_id=role_id, permission_id=perm.id, created_by=current_user.id))
    db.commit()
    return {"message": f"Permission '{perm.code}' granted to role '{role.name}'"}

@router.put("/roles/{role_id}/permissions")
def set_role_permissions(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_id: int, payload: schemas_users.RolePermissionSet) -> Any:
    """Bulk-configure a role's privileges: grant missing, revoke absent (single commit)."""
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")

    requested = list(dict.fromkeys(payload.permission_codes))  # dedupe, keep order
    perms = (
        db.query(Permission)
        .filter(Permission.code.in_(requested), Permission.is_deleted == False)
        .all()
        if requested
        else []
    )
    unknown = set(requested) - {p.code for p in perms}
    if unknown:
        raise HTTPException(400, f"Unknown permission code(s): {', '.join(sorted(unknown))}")

    current_links = (
        db.query(RolePermission)
        .filter(RolePermission.role_id == role_id, RolePermission.is_deleted == False)
        .all()
    )
    by_perm = {lp.permission_id: lp for lp in current_links}
    target_ids = {p.id for p in perms}

    granted, revoked = [], []
    for pid in target_ids - set(by_perm):
        db.add(RolePermission(role_id=role_id, permission_id=pid, created_by=current_user.id))
        granted.append(pid)
    for lp in current_links:
        if lp.permission_id not in target_ids:
            lp.is_deleted = True
            lp.deleted_by = current_user.id
            revoked.append(lp.permission_id)
    db.commit()

    codes_by_id = {p.id: p.code for p in perms}
    all_codes = {p.id: p.code for p in db.query(Permission).filter(Permission.id.in_(revoked)).all()} if revoked else {}
    revoked_codes = [all_codes.get(pid, str(pid)) for pid in revoked]
    return {
        "message": f"Role '{role.name}' now has {len(target_ids)} permission(s)",
        "granted": [codes_by_id[pid] for pid in granted],
        "revoked": revoked_codes,
        "permission_codes": sorted(codes_by_id.values()),
    }

@router.delete("/roles/{role_id}/permissions/{permission_id}")
def revoke_role_permission(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_id: int, permission_id: int) -> Any:
    link = db.query(RolePermission).filter(
        RolePermission.role_id == role_id,
        RolePermission.permission_id == permission_id,
        RolePermission.is_deleted == False,
    ).first()
    if not link:
        raise HTTPException(404, "Permission is not granted to this role")
    link.is_deleted = True
    link.deleted_by = current_user.id
    db.commit()
    return {"message": "Permission revoked"}

# ─────────────── PERMISSIONS ────────────────
@router.get("/permissions")
def read_permissions(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 100) -> Any:
    return paginate(db.query(Permission), page, limit)

# ─────────────── USER BY ID ────────────────
def _user_roles(db: Session, user_id: int) -> List[schemas_users.UserRoleOut]:
    rows = (
        db.query(UserRole, Role)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id == user_id, UserRole.is_deleted == False, Role.is_deleted == False)
        .order_by(UserRole.id)
        .all()
    )
    return [
        schemas_users.UserRoleOut(
            id=ur.id,
            role_id=role.id,
            role_code=role.code,
            role_name=role.name,
            scope_type=ur.scope_type.value if hasattr(ur.scope_type, "value") else str(ur.scope_type),
            scope_id=ur.scope_id,
            assigned_at=ur.assigned_at,
        )
        for ur, role in rows
    ]

@router.get("/{id}", response_model=schemas_users.UserWithRoles)
def read_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    user = crud_users.user.get(db, id)
    if not user:
        raise HTTPException(404, "User not found")
    out = schemas_users.UserWithRoles.model_validate(user, from_attributes=True)
    out.roles = _user_roles(db, id)
    return out

@router.put("/{id}", response_model=schemas_users.UserWithRoles)
def update_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), id: int, user_in: schemas_users.UserUpdate) -> Any:
    user = crud_users.user.get(db, id)
    if not user:
        raise HTTPException(404, "User not found")
    data = user_in.model_dump(exclude_unset=True)

    # Admin-initiated password reset goes through the same strength policy.
    if "password" in data:
        new_password = data.pop("password")
        if new_password:
            try:
                validate_password_strength(new_password)
            except PasswordPolicyError as exc:
                raise HTTPException(400, str(exc))
            user.password_hash = get_password_hash(new_password)

    # An admin cannot lock themselves out.
    if "status" in data and data["status"] is False and id == current_user.id:
        raise HTTPException(400, "You cannot deactivate your own account")

    crud_users.user.update(db, db_obj=user, obj_in=data, updated_by=current_user.id)
    out = schemas_users.UserWithRoles.model_validate(user, from_attributes=True)
    out.roles = _user_roles(db, id)
    return out

@router.delete("/{id}", response_model=schemas_users.User)
def delete_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), id: int) -> Any:
    user = crud_users.user.get(db, id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.user_type == "SUPERADMIN":
        raise HTTPException(409, "SUPERADMIN accounts cannot be deleted")
    if id == current_user.id:
        raise HTTPException(400, "You cannot delete your own account")
    # Soft-delete the user and their role assignments together.
    assignments = (
        db.query(UserRole)
        .filter(UserRole.user_id == id, UserRole.is_deleted == False)
        .all()
    )
    for ur in assignments:
        ur.is_deleted = True
        ur.deleted_by = current_user.id
    removed = crud_users.user.remove(db, id=id, deleted_by=current_user.id)
    return removed

# ─────────────── USER-ROLE ASSIGNMENT ────────────────
@router.post("/{user_id}/assign-role")
def assign_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), user_id: int, role_id: int, scope_type: str = "GLOBAL", scope_id: Optional[int] = None) -> Any:
    user = crud_users.user.get(db, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    try:
        scope = ScopeTypeEnum(scope_type)
    except ValueError:
        raise HTTPException(400, f"Invalid scope_type '{scope_type}' (use GLOBAL, STATE, DISTRICT or TALUK)")
    # Scoped roles must say *where* they apply.
    if scope != ScopeTypeEnum.GLOBAL and not scope_id:
        raise HTTPException(400, f"scope_id is required for scope_type {scope.value}")
    if scope == ScopeTypeEnum.GLOBAL and scope_id:
        raise HTTPException(400, "scope_id must be empty for scope_type GLOBAL")
    if scope == ScopeTypeEnum.STATE:
        from models.masters import State
        if not db.query(State).filter(State.id == scope_id, State.is_deleted == False).first():
            raise HTTPException(400, f"State {scope_id} not found")
    elif scope == ScopeTypeEnum.DISTRICT:
        from models.masters import District
        if not db.query(District).filter(District.id == scope_id, District.is_deleted == False).first():
            raise HTTPException(400, f"District {scope_id} not found")
    elif scope == ScopeTypeEnum.TALUK:
        from models.masters import Taluk
        if not db.query(Taluk).filter(Taluk.id == scope_id, Taluk.is_deleted == False).first():
            raise HTTPException(400, f"Taluk {scope_id} not found")

    existing = db.query(UserRole).filter(
        UserRole.user_id == user_id,
        UserRole.role_id == role_id,
        UserRole.is_deleted == False,
    ).first()
    if existing:
        return {"message": f"Role {role.code} is already assigned to user {user_id}"}
    obj = UserRole(
        user_id=user_id, role_id=role_id,
        scope_type=scope, scope_id=scope_id,
        assigned_by=current_user.id,
        assigned_at=datetime.now(timezone.utc),
        created_by=current_user.id
    )
    db.add(obj)
    db.commit()
    return {"message": f"Role {role_id} assigned to user {user_id}"}

@router.get("/{user_id}/roles")
def list_user_roles(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), user_id: int) -> Any:
    """Roles assigned to a user, with scope info."""
    user = crud_users.user.get(db, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return [r.model_dump(mode="json") for r in _user_roles(db, user_id)]

@router.delete("/{user_id}/roles/{role_id}")
def remove_role_from_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), user_id: int, role_id: int) -> Any:
    """Revoke a role assignment (soft-deletes the user_roles row)."""
    user = crud_users.user.get(db, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    link = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == user_id,
            UserRole.role_id == role_id,
            UserRole.is_deleted == False,
        )
        .first()
    )
    if not link:
        raise HTTPException(404, "Role is not assigned to this user")
    if user.user_type == "SUPERADMIN":
        # Keep at least one active role on the superadmin.
        remaining = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == user_id,
                UserRole.is_deleted == False,
                UserRole.id != link.id,
            )
            .count()
        )
        if remaining == 0:
            raise HTTPException(409, "Cannot remove the last role from a SUPERADMIN account")
    link.is_deleted = True
    link.deleted_by = current_user.id
    link.updated_by = current_user.id
    db.commit()
    return {"message": f"Role {role_id} removed from user {user_id}"}

@router.get("/{user_id}/permissions")
def get_user_permissions(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), user_id: int) -> Any:
    """Get all permissions for a user across all their roles."""
    perms = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(UserRole, UserRole.role_id == RolePermission.role_id)
        .filter(UserRole.user_id == user_id, UserRole.is_deleted == False, RolePermission.is_deleted == False)
        .distinct().all()
    )
    return [{"id": p.id, "module": p.module, "code": p.code, "name": p.name} for p in perms]
