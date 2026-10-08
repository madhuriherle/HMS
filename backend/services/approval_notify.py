"""Ping everyone who can act on a pending approval, instead of leaving them
to poll GET /approvals/... / /approvals/requests. Uses the existing in-app
inbox (models.inbox.AppNotification) — one row per approver, so it shows up
in their normal notification list, not a broadcast to every user.
"""

from typing import Optional
from sqlalchemy.orm import Session


def _approvers_write_holders(db: Session) -> list:
    """User ids who can act on approvals: holders of approvals.write through
    their (single) role, plus all-access roles."""
    from models.users import Permission, Role, RolePermission, User

    granted_roles = (
        db.query(RolePermission.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .filter(
            Permission.code == "approvals.write",
            RolePermission.is_deleted == False,  # noqa: E712
        )
    )
    rows = (
        db.query(User.id)
        .join(Role, Role.id == User.role_id)
        .filter(
            User.is_deleted == False,  # noqa: E712
            User.status == True,  # noqa: E712
            Role.is_deleted == False,  # noqa: E712
            Role.status == True,  # noqa: E712
            (Role.is_all_access == True) | Role.id.in_(granted_roles),  # noqa: E712
        )
        .distinct()
        .all()
    )
    return [r[0] for r in rows]


def notify_approvers(db: Session, title: str, body: str, data: Optional[dict] = None) -> int:
    """Insert one AppNotification per approvals.write holder. Returns the
    count notified. Never raises — a notification failure shouldn't fail the
    request that triggered it."""
    try:
        from models.inbox import AppNotification

        user_ids = _approvers_write_holders(db)
        for user_id in user_ids:
            db.add(AppNotification(
                user_id=user_id, title=title, body=body,
                source="APPROVAL_REQUEST", data=data,
            ))
        if user_ids:
            db.commit()
        return len(user_ids)
    except Exception:
        db.rollback()
        return 0
