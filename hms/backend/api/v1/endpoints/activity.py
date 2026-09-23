from typing import Any, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from api import deps
from models.users import User
from models.activity import UserActivityLog, MemberActivityLog
from models.members import Member
from core.pagination import paginate

router = APIRouter()

VALID_ACTIONS = {
    "LOGIN", "LOGOUT", "CREATE", "UPDATE", "DELETE",
    "APPROVE", "REJECT", "SEND", "ALLOCATE", "CANCEL",
}


@router.get("/users")
def read_user_activity(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    user_id: Optional[int] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    page: int = 1,
    limit: int = 50,
) -> Any:
    """User activity trail: login → logout and every entity touched."""
    q = db.query(UserActivityLog).filter(UserActivityLog.is_deleted == False)
    if user_id:
        q = q.filter(UserActivityLog.user_id == user_id)
    if action:
        q = q.filter(UserActivityLog.action == action.upper())
    if entity_type:
        q = q.filter(UserActivityLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(UserActivityLog.entity_id == entity_id)
    return paginate(q.order_by(UserActivityLog.created_at.desc()), page, limit)


@router.get("/users/summary")
def read_user_activity_summary(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    user_id: Optional[int] = None,
) -> Any:
    """Per-user activity counters (logins, creates, updates, ...)."""
    q = db.query(
        UserActivityLog.user_id,
        UserActivityLog.action,
        func.count(UserActivityLog.id).label("count"),
    ).filter(UserActivityLog.is_deleted == False)
    if user_id:
        q = q.filter(UserActivityLog.user_id == user_id)
    rows = q.group_by(UserActivityLog.user_id, UserActivityLog.action).all()

    summary: dict = {}
    for uid, action, count in rows:
        summary.setdefault(str(uid), {})[action] = count
    return {"total": len(summary), "data": summary}


@router.get("/members")
def read_member_activity(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    member_id: Optional[int] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> Any:
    """Member activity trail (paginated)."""
    q = db.query(MemberActivityLog).filter(MemberActivityLog.is_deleted == False)
    if member_id:
        q = q.filter(MemberActivityLog.member_id == member_id)
    if action:
        q = q.filter(MemberActivityLog.action == action.upper())
    if entity_type:
        # JSON path filter; cast to text for cross-dialect (SQLite/PostgreSQL) use.
        q = q.filter(
            func.json_extract(MemberActivityLog.details, '$.entity_type') == entity_type
        )
    return paginate(q.order_by(MemberActivityLog.created_at.desc()), page, limit)


@router.get("/members/{member_id}/timeline")
def read_member_timeline(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    member_id: int,
    page: int = 1,
    limit: int = 100,
) -> Any:
    """Chronological timeline for one member's profile screen: creation,
    edits (with before/after), service usage, receipts, magazine changes…"""
    member = db.query(Member).filter(Member.id == member_id).first()
    if not member:
        from fastapi import HTTPException
        raise HTTPException(404, "Member not found")

    q = db.query(MemberActivityLog).filter(
        MemberActivityLog.member_id == member_id,
        MemberActivityLog.is_deleted == False,
    )
    page_data = paginate(q.order_by(MemberActivityLog.created_at.desc(), MemberActivityLog.id.desc()), page, limit)

    # Resolve acting users in bulk for display.
    user_ids = {row["user_id"] for row in page_data["data"] if row.get("user_id")}
    names = {}
    if user_ids:
        from models.users import User as UserModel
        for u in db.query(UserModel).filter(UserModel.id.in_(user_ids)).all():
            names[u.id] = u.name or u.username
    for row in page_data["data"]:
        row["acted_by_name"] = names.get(row.get("user_id"))

    return {
        "member_id": member_id,
        "member_name": " ".join(p for p in (member.first_name_en, member.last_name_en) if p),
        **page_data,
    }
