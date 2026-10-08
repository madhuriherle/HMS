from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class UserActivityLogBase(BaseModel):
    user_id: int
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    details: Optional[dict] = None
    ip_address: Optional[str] = None

class UserActivityLogCreate(UserActivityLogBase):
    pass

class UserActivityLogUpdate(BaseModel):
    pass

class UserActivityLog(UserActivityLogBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class MemberActivityLogBase(BaseModel):
    member_id: int
    action: str
    details: Optional[dict] = None

class MemberActivityLogCreate(MemberActivityLogBase):
    pass

class MemberActivityLogUpdate(BaseModel):
    pass

class MemberActivityLog(MemberActivityLogBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
