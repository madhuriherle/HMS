from typing import Any, Optional
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
@router.get("/roles")
def read_roles(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), page: int = 1, limit: int = 50) -> Any:
    return paginate(db.query(Role).filter(Role.is_deleted == False), page, limit)

@router.post("/roles", response_model=schemas_users.Role)
def create_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), role_in: schemas_users.RoleCreate) -> Any:
    existing = db.query(Role).filter(Role.code == role_in.code, Role.is_deleted == False).first()
    if existing:
        raise HTTPException(400, f"Role code '{role_in.code}' already exists")
    return crud_users.role.create(db=db, obj_in=role_in, created_by=current_user.id)

@router.put("/roles/{id}", response_model=schemas_users.Role)
def update_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), id: int, role_in: schemas_users.RoleUpdate) -> Any:
    role = crud_users.role.get(db, id)
    if not role: raise HTTPException(404, "Role not found")
    return crud_users.role.update(db, db_obj=role, obj_in=role_in, updated_by=current_user.id)

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
@router.get("/{id}", response_model=schemas_users.User)
def read_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user), id: int) -> Any:
    user = crud_users.user.get(db, id)
    if not user: raise HTTPException(404, "User not found")
    return user

@router.put("/{id}", response_model=schemas_users.User)
def update_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), id: int, user_in: schemas_users.UserUpdate) -> Any:
    user = crud_users.user.get(db, id)
    if not user: raise HTTPException(404, "User not found")
    return crud_users.user.update(db, db_obj=user, obj_in=user_in, updated_by=current_user.id)

@router.delete("/{id}", response_model=schemas_users.User)
def delete_user(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), id: int) -> Any:
    if id == current_user.id:
        raise HTTPException(400, "You cannot delete your own account")
    user = crud_users.user.get(db, id)
    if not user:
        raise HTTPException(404, "User not found")
    return crud_users.user.remove(db, id=id, deleted_by=current_user.id)

# ─────────────── USER-ROLE ASSIGNMENT ────────────────
@router.post("/{user_id}/assign-role")
def assign_role(*, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.require_permission("users.write")), user_id: int, role_id: int, scope_type: str = "GLOBAL", scope_id: Optional[int] = None) -> Any:
    user = crud_users.user.get(db, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    role = crud_users.role.get(db, role_id)
    if not role:
        raise HTTPException(404, "Role not found")
    existing = db.query(UserRole).filter(
        UserRole.user_id == user_id,
        UserRole.role_id == role_id,
        UserRole.is_deleted == False,
    ).first()
    if existing:
        return {"message": f"Role {role.code} is already assigned to user {user_id}"}
    try:
        scope = ScopeTypeEnum(scope_type)
    except ValueError:
        raise HTTPException(400, f"Invalid scope_type '{scope_type}'")
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
