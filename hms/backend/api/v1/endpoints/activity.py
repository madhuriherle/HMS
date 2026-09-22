from typing import Any
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from api import deps
from models.users import User
from models.activity import UserActivityLog, MemberActivityLog
from core.pagination import paginate

router = APIRouter()

@router.get("/users")
def read_user_activity(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    user_id: int = None,
    page: int = 1, limit: int = 50
) -> Any:
    q = db.query(UserActivityLog)
    if user_id: q = q.filter(UserActivityLog.user_id == user_id)
    return paginate(q.order_by(UserActivityLog.created_at.desc()), page, limit)

@router.get("/members")
def read_member_activity(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    member_id: int = None,
    page: int = 1, limit: int = 50
) -> Any:
    q = db.query(MemberActivityLog)
    if member_id: q = q.filter(MemberActivityLog.member_id == member_id)
    return paginate(q.order_by(MemberActivityLog.created_at.desc()), page, limit)
