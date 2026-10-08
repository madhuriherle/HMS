from datetime import datetime, timedelta, timezone
from typing import Optional, Any
import re
import bcrypt
from jose import JWTError, jwt
from core.config import settings

# NOTE: bcrypt is used directly. passlib 1.7.4 (the last release, from 2020)
# crashes with bcrypt>=4.1, which is what a fresh `pip install` resolves today.
# Existing $2b$ hashes verify identically either way.

MIN_PASSWORD_LENGTH = 8

class PasswordPolicyError(ValueError):
    pass

def validate_password_strength(password: str) -> None:
    """Password policy (same rules as the Anegudde system, 8+ chars): upper
    and lower case letters, a digit and a symbol. Raises PasswordPolicyError."""
    message = (
        f"Password must be at least {MIN_PASSWORD_LENGTH} characters and include "
        "uppercase, lowercase, number, and symbol"
    )
    if (
        not password
        or len(password) < MIN_PASSWORD_LENGTH
        or not re.search(r"[A-Z]", password)
        or not re.search(r"[a-z]", password)
        or not re.search(r"\d", password)
        or not re.search(r"[^A-Za-z0-9\s]", password)
    ):
        raise PasswordPolicyError(message)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"), hashed_password.encode("utf-8")
        )
    except (ValueError, TypeError):
        # Malformed / empty stored hash must never authenticate.
        return False

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def create_access_token(subject: Any, expires_delta: Optional[timedelta] = None, security_stamp: Optional[str] = None) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"exp": expire, "sub": str(subject), "type": "access"}
    if security_stamp:
        to_encode["ss"] = security_stamp
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def create_refresh_token(subject: Any, security_stamp: Optional[str] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode = {"exp": expire, "sub": str(subject), "type": "refresh"}
    if security_stamp:
        to_encode["ss"] = security_stamp
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
