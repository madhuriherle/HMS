from crud.base import CRUDBase
from models.activity import UserActivityLog, MemberActivityLog
from schemas.activity import UserActivityLogCreate, UserActivityLogUpdate, MemberActivityLogCreate, MemberActivityLogUpdate

class CRUDUserActivityLog(CRUDBase[UserActivityLog, UserActivityLogCreate, UserActivityLogUpdate]):
    pass

class CRUDMemberActivityLog(CRUDBase[MemberActivityLog, MemberActivityLogCreate, MemberActivityLogUpdate]):
    pass

user_activity = CRUDUserActivityLog(UserActivityLog)
member_activity = CRUDMemberActivityLog(MemberActivityLog)
