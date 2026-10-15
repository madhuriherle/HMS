from typing import Any, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
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
    activity_type: Optional[str] = None,
    status: Optional[str] = None,
    module: Optional[str] = None,
    client_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    show_navigation: bool = False,
    search: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    page: int = 1,
    limit: int = 50,
) -> Any:
    """User activity trail matching AIMS User Activity Logs screen."""
    from datetime import datetime, time

    q = db.query(UserActivityLog).filter(UserActivityLog.is_deleted == False)
    hidden = deps.stronger_user_ids(db, current_user)   # accounts above you never show up in a log
    if hidden:
        q = q.filter(or_(UserActivityLog.user_id.is_(None), UserActivityLog.user_id.notin_(hidden)))

    if user_id:
        q = q.filter(UserActivityLog.user_id == user_id)
    if action:
        q = q.filter(UserActivityLog.action == action.upper())
    if activity_type and activity_type != "All":
        q = q.filter(UserActivityLog.activity_type == activity_type)
    elif not show_navigation and not activity_type:
        # By default, hide navigation activity (e.g. viewed menu, viewed list)
        q = q.filter(UserActivityLog.activity_type != "NAVIGATION")

    if status and status != "All Status":
        q = q.filter(UserActivityLog.status == status.upper())
    if module:
        q = q.filter(UserActivityLog.module == module)
    if client_type and client_type != "All Clients":
        q = q.filter(UserActivityLog.client_type == client_type)
    if entity_type:
        q = q.filter(UserActivityLog.entity_type == entity_type)
    if entity_id:
        q = q.filter(UserActivityLog.entity_id == entity_id)

    if from_date:
        try:
            fd = datetime.strptime(from_date, "%Y-%m-%d")
            q = q.filter(UserActivityLog.created_at >= fd)
        except ValueError:
            pass
    if to_date:
        try:
            td = datetime.strptime(to_date, "%Y-%m-%d")
            # end of the day
            td_end = datetime.combine(td.date(), time(23, 59, 59))
            q = q.filter(UserActivityLog.created_at <= td_end)
        except ValueError:
            pass

    if search:
        s = f"%{search.strip()}%"
        q = q.filter(UserActivityLog.description.ilike(s))

    page_data = paginate(q.order_by(UserActivityLog.created_at.desc(), UserActivityLog.id.desc()), page, limit)

    # Attach user display names and roles
    user_ids = {row["user_id"] for row in page_data["data"] if row.get("user_id")}
    users_map = {}
    if user_ids:
        from models.users import User as UserModel, Role
        user_rows = (
            db.query(UserModel.id, UserModel.name, UserModel.username, Role.name.label("role_name"))
            .outerjoin(Role, Role.id == UserModel.role_id)
            .filter(UserModel.id.in_(user_ids))
            .all()
        )
        for uid, name, uname, rname in user_rows:
            users_map[uid] = {
                "name": name or uname or f"User {uid}",
                "role_name": rname or "User",
            }

    for row in page_data["data"]:
        u_info = users_map.get(row.get("user_id"))
        row["user_name"] = u_info["name"] if u_info else "System / Anonymous"
        row["role_name"] = u_info["role_name"] if u_info else "System"
        row["activity_description"] = row.get("description") or f"{row.get('action')} {row.get('entity_type') or ''}".strip()
        row["module"] = row.get("module") or "System"
        row["status"] = row.get("status") or "SUCCESS"
        row["activity_type"] = row.get("activity_type") or "ACTION"

    return page_data


@router.get("/stats")
def read_activity_stats(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user_id: Optional[int] = None,
) -> Any:
    """Card counters: Total Logs, Success, Failed, Important."""
    from datetime import datetime, time

    q = db.query(UserActivityLog).filter(UserActivityLog.is_deleted == False)
    hidden = deps.stronger_user_ids(db, current_user)
    if hidden:
        q = q.filter(or_(UserActivityLog.user_id.is_(None), UserActivityLog.user_id.notin_(hidden)))
    if user_id:
        q = q.filter(UserActivityLog.user_id == user_id)
    if from_date:
        try:
            fd = datetime.strptime(from_date, "%Y-%m-%d")
            q = q.filter(UserActivityLog.created_at >= fd)
        except ValueError:
            pass
    if to_date:
        try:
            td = datetime.strptime(to_date, "%Y-%m-%d")
            td_end = datetime.combine(td.date(), time(23, 59, 59))
            q = q.filter(UserActivityLog.created_at <= td_end)
        except ValueError:
            pass

    total = q.count()
    success = q.filter(UserActivityLog.status == "SUCCESS").count()
    failed = q.filter(UserActivityLog.status == "FAILED").count()
    important = q.filter(UserActivityLog.activity_type.in_(("IMPORTANT", "CRUD"))).count()

    return {
        "total_logs": total,
        "success": success,
        "failed": failed,
        "important": important,
    }


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
    hidden = deps.stronger_user_ids(db, current_user)
    if hidden:
        q = q.filter(or_(UserActivityLog.user_id.is_(None), UserActivityLog.user_id.notin_(hidden)))
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
            MemberActivityLog.details["entity_type"].as_string() == entity_type
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
    # Rows written before descriptions existed get theirs worked out from what they recorded.
    from services import activity_text

    hidden = deps.stronger_user_ids(db, current_user)
    for row in page_data["data"]:
        if row.get("user_id") in hidden:   # an account above you: shown as the system, never by name
            row["user_id"] = None
            row["acted_by_name"] = "System"
        else:
            row["acted_by_name"] = names.get(row.get("user_id"))
        d = row.get("details") or {}
        if not d.get("description"):
            table = d.get("entity_type")
            d = {**d, "description": activity_text.describe(
                row.get("action") or "", table, None, d.get("entity_id"), d.get("changes")
            ), "module": activity_text.module_for(table)}
            row["details"] = d
        row["description"] = d.get("description")
        row["module"] = d.get("module")

    return {
        "member_id": member_id,
        "member_name": " ".join(p for p in (member.first_name_en, member.last_name_en) if p),
        **page_data,
    }
