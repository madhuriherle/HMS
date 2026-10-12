"""API request activity logging service.

Extracts user identity, maps endpoint to human-readable description and module,
and saves user activity logs to the database in background/middleware.
"""

from datetime import datetime, timezone
import re
from typing import Optional, Tuple
from starlette.requests import Request
from jose import jwt, JWTError

from core.config import settings
from db.session import SessionLocal
from models.activity import UserActivityLog


def extract_user_id_from_auth_header(auth_header: Optional[str]) -> Optional[int]:
    """Decode JWT without hitting database to quickly identify the user."""
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id = payload.get("sub")
        return int(user_id) if user_id is not None else None
    except (JWTError, ValueError):
        return None


def describe_api_call(method: str, path: str, status_code: int) -> Tuple[str, str, str]:
    """
    Returns (description, module, activity_type).
    activity_type can be: NAVIGATION, IMPORTANT, CRUD, AUTH
    """
    m = method.upper()
    p = path.rstrip("/")

    # Auth
    if "/auth/login" in p:
        status_desc = "user logged in" if status_code < 400 else "failed login attempt"
        return status_desc, "System", "AUTH"
    if "/auth/logout" in p:
        return "user logged out", "System", "AUTH"
    if "/auth/me" in p:
        return "viewed user profile", "Users", "NAVIGATION"

    # Activity
    if "/activity/users/summary" in p:
        return "viewed today's overall activity summary", "Dashboard", "NAVIGATION"
    if "/activity" in p:
        return "viewed activity logs", "Audit Logs", "NAVIGATION"

    # Dashboard
    if p.endswith("/dashboard/stats") or p.endswith("/dashboard"):
        return "viewed dashboard overview", "Dashboard", "NAVIGATION"

    # Menu
    if "/modules/menu" in p:
        return "viewed menu", "System", "NAVIGATION"

    # Receipts
    if "/receipts/member-lookup" in p:
        return "searched member for receipt", "Receipts", "NAVIGATION"
    if "/receipts/next-number" in p:
        return "fetched next receipt number", "Receipts", "NAVIGATION"
    if "/receipts/tracking" in p:
        return "viewed receipt tracking list", "Receipts", "NAVIGATION"
    if "/receipts/entry" in p or (p.endswith("/receipts") and m == "POST"):
        return "issued new receipt", "Receipts", "IMPORTANT"
    if "/receipts" in p and m == "GET":
        return "viewed receipts", "Receipts", "NAVIGATION"

    # Members
    if "/members/lookup" in p:
        return "looked up member by number", "Membership", "NAVIGATION"
    if re.search(r"/members/\d+/approve", p):
        return "approved member application", "Membership", "IMPORTANT"
    if re.search(r"/members/\d+/reject", p):
        return "rejected member application", "Membership", "IMPORTANT"
    if re.search(r"/members/\d+/photo", p):
        return "uploaded member photo", "Membership", "CRUD"
    if "/members" in p and m == "POST":
        return "registered new member", "Membership", "IMPORTANT"
    if re.search(r"/members/\d+", p) and m in ("PUT", "PATCH"):
        return "updated member details", "Membership", "IMPORTANT"
    if re.search(r"/members/\d+", p) and m == "DELETE":
        return "deleted member record", "Membership", "IMPORTANT"
    if "/members" in p and m == "GET":
        if "unapproved" in p:
            return "viewed unapproved members list", "Membership", "NAVIGATION"
        return "viewed members list", "Membership", "NAVIGATION"

    # Approvals
    if "/approvals" in p and "approve" in p:
        return "approved pending request", "Approvals", "IMPORTANT"
    if "/approvals" in p and "reject" in p:
        return "rejected pending request", "Approvals", "IMPORTANT"
    if "/approvals" in p:
        return "viewed approvals queue", "Approvals", "NAVIGATION"

    # Users & Roles
    if "/users/roles" in p and m in ("POST", "PUT"):
        return "modified role permissions", "Role Management", "IMPORTANT"
    if "/users/roles" in p and m == "GET":
        return "viewed roles and privileges", "Role Management", "NAVIGATION"
    if "/users" in p and m == "POST":
        return "created new system user", "User Management", "IMPORTANT"
    if "/users" in p and m in ("PUT", "PATCH"):
        return "updated system user", "User Management", "IMPORTANT"
    if "/users" in p and m == "GET":
        return "viewed users list", "User Management", "NAVIGATION"

    # Masters
    if "/masters/membership-types" in p:
        return "accessed membership types master", "Master Settings", "IMPORTANT" if m != "GET" else "NAVIGATION"
    if "/masters/receipt-types" in p or "/masters/particulars" in p:
        return "accessed receipt types / particulars", "Master Settings", "IMPORTANT" if m != "GET" else "NAVIGATION"
    if "/masters/location" in p or "/masters/postal-codes" in p:
        return "accessed location setup", "Master Settings", "NAVIGATION"
    if "/masters" in p:
        return "accessed master settings", "Master Settings", "NAVIGATION"

    # Default fallback
    if m == "GET":
        return f"viewed {p.split('/')[-1] or 'page'}", "System", "NAVIGATION"
    elif m == "POST":
        return f"created {p.split('/')[-1] or 'record'}", "System", "CRUD"
    elif m in ("PUT", "PATCH"):
        return f"updated {p.split('/')[-1] or 'record'}", "System", "CRUD"
    elif m == "DELETE":
        return f"deleted {p.split('/')[-1] or 'record'}", "System", "IMPORTANT"
    return f"{m} {p}", "System", "ACTION"


def record_http_activity(
    method: str,
    path: str,
    status_code: int,
    ip_address: Optional[str],
    user_agent: Optional[str],
    auth_header: Optional[str],
) -> None:
    """Record an HTTP request activity in the database."""
    # Skip docs, openapi, static media files, and auth login/logout which are explicitly recorded by auth endpoints with full user_id
    if any(path.startswith(prefix) for prefix in ("/api/v1/docs", "/api/v1/redoc", "/api/v1/openapi.json", "/uploads", "/static")):
        return
    if path.endswith("/auth/login") or path.endswith("/auth/logout"):
        return

    user_id = extract_user_id_from_auth_header(auth_header)
    description, module, act_type = describe_api_call(method, path, status_code)
    status_str = "SUCCESS" if status_code < 400 else "FAILED"
    now = datetime.now(timezone.utc)

    # Determine client type
    client_type = "Web Admin"
    if user_agent and ("Mobile" in user_agent or "Android" in user_agent or "iPhone" in user_agent):
        client_type = "Mobile App"

    # Short action verb for legacy schema column
    action_verb = method.upper()
    if "login" in path:
        action_verb = "LOGIN"
    elif "logout" in path:
        action_verb = "LOGOUT"

    try:
        with SessionLocal() as db:
            log_entry = UserActivityLog(
                user_id=user_id,
                action=action_verb,
                description=description,
                module=module,
                activity_type=act_type,
                status=status_str,
                status_code=status_code,
                http_method=method.upper(),
                endpoint_path=path,
                ip_address=ip_address,
                client_type=client_type,
                created_at=now,
            )
            db.add(log_entry)
            db.commit()
    except Exception:
        # Never crash request cycle on background audit failure
        pass
