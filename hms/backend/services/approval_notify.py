"""Ping everyone who can act on a pending approval, instead of leaving them
to poll GET /approvals/... / /approvals/requests. Uses the existing in-app
inbox (models.inbox.AppNotification) — one row per approver, so it shows up
in their normal notification list, not a broadcast to every user.
"""

from typing import Optional
from sqlalchemy.orm import Session


def _approvers_write_holders(db: Session) -> list:
    """User ids holding approvals.write via any active role grant (SUPERADMIN
    doesn't need a grant to act, but also doesn't need a nudge here — this is
    for the staff actually configured to review approvals)."""
    from models.users import Permission, RolePermission, UserRole

    rows = (
        db.query(UserRole.user_id)
        .join(RolePermission, RolePermission.role_id == UserRole.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .filter(
            Permission.code == "approvals.write",
            UserRole.is_deleted == False,  # noqa: E712
            RolePermission.is_deleted == False,  # noqa: E712
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
