from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from api import deps
from core.security import decode_token, get_password_hash, create_access_token, create_refresh_token
from core.config import settings
from models.users import User
from models.system import PasswordResetToken
from services.whatsapp import whatsapp_service
from services.audit import record_activity
from core.ratelimit import rate_limiter
from core.security import (
    verify_password,
    validate_password_strength,
    PasswordPolicyError,
)
from datetime import datetime, timedelta, timezone
import secrets

router = APIRouter()

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(BaseModel):
    refresh_token: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class ForgotPasswordRequest(BaseModel):
    mobile: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

from fastapi.security import OAuth2PasswordRequestForm
from core.security import verify_password

@router.post("/login", response_model=Token)
def login(
    request: Request,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends()
) -> Any:
    """Login with username & password."""
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"login:{client_ip}:{form_data.username}", max_hits=10, window_seconds=300):
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Please try again in a few minutes.",
        )
    user = db.query(User).filter(
        User.username == form_data.username,
        User.is_deleted == False
    ).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not user.status:
        raise HTTPException(status_code=403, detail="Account is inactive")
    now = datetime.now(timezone.utc)
    user.last_login_at = now
    record_activity(
        db,
        user_id=user.id,
        action="LOGIN",
        entity_type="users",
        entity_id=user.id,
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }

@router.post("/logout")
def logout(
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    payload: Optional[RefreshRequest] = None,
) -> Any:
    """Logout: records the LOGOUT activity and revokes the refresh token when
    one is supplied (access tokens simply expire)."""
    from models.system import RefreshToken

    if payload and payload.refresh_token:
        row = db.query(RefreshToken).filter(
            RefreshToken.token == payload.refresh_token,
            RefreshToken.revoked == False,  # noqa: E712
        ).first()
        if row:
            row.revoked = True
    record_activity(
        db,
        user_id=current_user.id,
        action="LOGOUT",
        entity_type="users",
        entity_id=current_user.id,
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return {"message": "Logged out successfully"}

@router.post("/refresh", response_model=Token)
def refresh_token(payload: RefreshRequest, db: Session = Depends(deps.get_db)) -> Any:
    data = decode_token(payload.refresh_token)
    if not data or data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = db.query(User).filter(User.id == int(data["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return {
        "access_token": create_access_token(user.id),
        "refresh_token": create_refresh_token(user.id),
        "token_type": "bearer",
    }

@router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    background_tasks: BackgroundTasks = BackgroundTasks()
) -> Any:
    """Send password reset OTP via WhatsApp."""
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.check(f"forgot:{client_ip}:{payload.mobile}", max_hits=5, window_seconds=900):
        raise HTTPException(
            status_code=429,
            detail="Too many reset requests. Please try again later.",
        )
    user = db.query(User).filter(User.mobile == payload.mobile, User.is_deleted == False).first()
    if not user:
        # Don't reveal if user exists or not
        return {"message": "If the number is registered, a reset link has been sent."}

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    reset = PasswordResetToken(
        user_id=user.id,
        token=token,
        expires_at=now + timedelta(minutes=30),
        created_at=now
    )
    db.add(reset)
    db.commit()

    msg = f"HMS MMA Password Reset: Your reset token is {token}. Valid for 30 minutes."

    async def send():
        await whatsapp_service.send_message(
            to=f"+91{payload.mobile}", message=msg
        )

    background_tasks.add_task(send)
    return {"message": "If the number is registered, a reset link has been sent."}

@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(deps.get_db)) -> Any:
    """Reset password using token."""
    try:
        validate_password_strength(payload.new_password)
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    reset = db.query(PasswordResetToken).filter(
        PasswordResetToken.token == payload.token,
        PasswordResetToken.used == False
    ).first()
    if not reset:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    expires_at = reset.expires_at
    if expires_at.tzinfo is None:
        # SQLite returns naive UTC values even from timezone-aware columns;
        # PostgreSQL returns tz-aware ones. Normalise before comparing.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(payload.new_password)
    reset.used = True
    db.commit()
    return {"message": "Password reset successfully"}

@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
) -> Any:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    try:
        validate_password_strength(payload.new_password)
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    current_user.password_hash = get_password_hash(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully"}

@router.get("/me")
def read_me(current_user: User = Depends(deps.get_current_user)) -> Any:
    return {
        "id": current_user.id,
        "name": current_user.name,
        "username": current_user.username,
        "email": current_user.email,
        "user_type": current_user.user_type,
        "status": current_user.status,
    }
