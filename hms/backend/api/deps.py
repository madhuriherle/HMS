from typing import Generator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from db.session import SessionLocal
from core.security import decode_token
from models.users import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()

def get_current_user(
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
    # Expose the acting user to the audit listener (services/audit.py).
    # FastAPI caches the get_db dependency per request, so this is the same
    # session instance every endpoint in the request uses.
    db._current_user_id = user.id
    return user

def get_current_active_superuser(current_user: User = Depends(get_current_user)) -> User:
    if current_user.user_type != "SUPERADMIN":
        raise HTTPException(status_code=403, detail="Not enough privileges")
    return current_user

def require_permission(permission_code: str):
    """Dependency factory to check if user has a specific permission.

    SUPERADMIN bypasses permission checks. Everyone else needs the code through
    one of their assigned roles (permissions are seeded at startup).
    """
    def _check(
        db: Session = Depends(get_db),
        current_user: User = Depends(get_current_user)
    ) -> User:
        if current_user.user_type == "SUPERADMIN":
            return current_user

        # Cached on the session (one per request) so parallel permission
        # dependencies in the same request only hit the DB once.
        codes = db.info.get("user_permission_codes")
        if codes is None:
            from models.users import UserRole, RolePermission, Permission
            # Fetch all permission codes assigned to the user's roles
            user_permissions = (
                db.query(Permission.code)
                .join(RolePermission, RolePermission.permission_id == Permission.id)
                .join(UserRole, UserRole.role_id == RolePermission.role_id)
                .filter(UserRole.user_id == current_user.id, UserRole.is_deleted == False)
                .all()
            )
            codes = [p.code for p in user_permissions]
            db.info["user_permission_codes"] = codes
        if permission_code not in codes:
            raise HTTPException(status_code=403, detail=f"Permission '{permission_code}' required")
        return current_user
    return _check
