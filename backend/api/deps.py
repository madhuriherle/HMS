from typing import Generator, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from db.session import SessionLocal
from core.security import decode_token
from models.users import User
from services.permission_areas import resolve as resolve_permission

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise credentials_exception
    user_id: str = payload.get("sub")
    if not user_id:
        raise credentials_exception
    user = db.query(User).filter(User.id == int(user_id), User.is_deleted == False).first()
    if not user:
        raise credentials_exception
    if not user.status:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    # Session invalidation: a changed role/password/status rotates the stamp,
    # which makes every token issued before the change worthless.
    if user.security_stamp and user.security_stamp != payload.get("ss"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalidated. Please login again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Expose the acting user to the audit listener (services/audit.py).
    # FastAPI caches the get_db dependency per request, so this is the same
    # session instance every endpoint in the request uses.
    db._current_user_id = user.id
    # The web panel asks for a reason before every change and sends it in
    # X-Action-Reason; the audit listener stores it with each activity row.
    reason = (request.headers.get("X-Action-Reason") or "").strip()
    db._action_reason = reason[:500] or None
    return user

def get_user_role(db: Session, user: User):
    """The user's single role (cached on the request session)."""
    from models.users import Role
    cache = db.info.setdefault("user_role", {})
    if user.id not in cache:
        cache[user.id] = (
            db.query(Role).filter(Role.id == user.role_id, Role.is_deleted == False).first()  # noqa: E712
            if user.role_id else None
        )
    return cache[user.id]


def user_rank(db: Session, user: User) -> int:
    role = get_user_role(db, user)
    return role.rank_level if role else 99


def is_all_access(db: Session, user: User) -> bool:
    role = get_user_role(db, user)
    return bool(role and role.status and role.is_all_access)


def get_current_active_superuser(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> User:
    """Rank-1 only (module/privilege-catalog management, system settings)."""
    if user_rank(db, current_user) != 1:
        raise HTTPException(status_code=403, detail="Strictly reserved for Super Admin (Rank 1)")
    return current_user


def user_permission_codes(db: Session, user: User) -> set:
    """Active privilege codes granted to the user's role (not expanded for
    all-access roles — callers check is_all_access first)."""
    from models.users import Permission, RolePermission
    role = get_user_role(db, user)
    if not role or not role.status:
        return set()
    key = f"perm_codes:{user.id}"
    if key not in db.info:
        rows = (
            db.query(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .filter(
                RolePermission.role_id == role.id,
                RolePermission.is_deleted == False,  # noqa: E712
                Permission.is_deleted == False,  # noqa: E712
                Permission.status == True,  # noqa: E712
            )
            .all()
        )
        db.info[key] = {r[0] for r in rows}
    return db.info[key]


def permission_requires_approval(db: Session, user: User, permission_code: str) -> bool:
    """True if the user's role grant for this permission is flagged
    requires_approval (maker-checker): the action then files an approval
    request instead of executing. All-access roles never need approval."""
    role = get_user_role(db, user)
    if not role or role.is_all_access:
        return False
    permission_code = resolve_permission(permission_code)
    from models.users import Permission, RolePermission
    gated = (
        db.query(RolePermission.requires_approval)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .filter(
            Permission.code == permission_code,
            RolePermission.role_id == role.id,
            RolePermission.is_deleted == False,  # noqa: E712
        )
        .first()
    )
    return bool(gated and gated[0])


def _module_gate(db: Session, user: User, permission_code: str) -> None:
    """Module-level rules from the privilege's module: a disabled module
    blocks everyone; min_rank_level blocks roles ranked worse than it."""
    from models.users import Module, Permission
    row = (
        db.query(Module)
        .join(Permission, Permission.module_id == Module.id)
        .filter(Permission.code == permission_code, Permission.status == True)  # noqa: E712
        .first()
    )
    if not row:
        return
    if not row.status:
        raise HTTPException(403, f"The '{row.name_en}' module is currently disabled by administrator.")
    if row.min_rank_level and user_rank(db, user) > row.min_rank_level:
        raise HTTPException(403, f"This module requires Rank {row.min_rank_level} or higher access.")


def require_permission(permission_code: str):
    """Dependency factory: the user's role must hold the privilege (or be
    all-access), and the privilege's module must be enabled and within the
    role's rank."""
    def _check(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
    ) -> User:
        role = get_user_role(db, current_user)
        if not role or not role.status:
            raise HTTPException(403, "No active role assigned to this user")
        code = resolve_permission(permission_code)  # the sub-module's privilege for this page, if it has one
        if not role.is_all_access and code not in user_permission_codes(db, current_user):
            raise HTTPException(403, f"Not enough permissions. Required: {code}")
        _module_gate(db, current_user, code)
        return current_user
    return _check


def require_any_permission(*permission_codes: str):
    """Like require_permission but satisfied by any one of the codes."""
    def _check(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
    ) -> User:
        role = get_user_role(db, current_user)
        if not role or not role.status:
            raise HTTPException(403, "No active role assigned to this user")
        held = user_permission_codes(db, current_user)
        resolved = [resolve_permission(c) for c in permission_codes]
        matched = [c for c in resolved if role.is_all_access or c in held]
        if not matched:
            raise HTTPException(403, f"Not enough permissions. Required one of: {', '.join(permission_codes)}")
        last = None
        for code in matched:
            try:
                _module_gate(db, current_user, code)
                return current_user
            except HTTPException as exc:
                last = exc
        raise last
    return _check


def read_guard(module: str, exempt_prefixes: tuple = ()):
    """Router-level dependency: GET/HEAD requests need `<module>.read`.
    Writes keep their own per-endpoint guards (and unauthenticated webhooks
    on the router, e.g. provider callbacks, are untouched). `exempt_prefixes`
    are path prefixes (after the router prefix) that only need a login."""
    async def _guard(request: Request, db: Session = Depends(get_db)) -> None:
        if request.method not in ("GET", "HEAD"):
            return
        if any(f"/{module}{p}" in request.url.path for p in exempt_prefixes):
            return
        token = await oauth2_scheme(request)
        current_user = get_current_user(request=request, db=db, token=token)
        require_permission(f"{module}.read")(db=db, current_user=current_user)
    return _guard
