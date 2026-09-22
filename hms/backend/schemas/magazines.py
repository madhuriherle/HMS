from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict

class MagazineSubscriptionBase(BaseModel):
    member_id: int
    delivery_status: str = "ACTIVE"
    address_override: Optional[str] = None
    notes: Optional[str] = None

class MagazineSubscriptionCreate(MagazineSubscriptionBase):
    pass

class MagazineSubscriptionUpdate(BaseModel):
    delivery_status: Optional[str] = None
    address_override: Optional[str] = None
    notes: Optional[str] = None

class MagazineSubscriptionInDBBase(MagazineSubscriptionBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class MagazineSubscription(MagazineSubscriptionInDBBase):
    pass

# Pause Requests
class MagazineDeliveryPauseBase(BaseModel):
    subscription_id: int
    pause_start_date: date
    pause_end_date: Optional[date] = None
    reason: Optional[str] = None

class MagazineDeliveryPauseCreate(MagazineDeliveryPauseBase):
    pass

class MagazineDeliveryPauseUpdate(BaseModel):
    pause_end_date: Optional[date] = None
    reason: Optional[str] = None

class MagazineDeliveryPause(MagazineDeliveryPauseBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MagazineReturnBase(BaseModel):
    subscription_id: int
    issue_month_year: str
    return_date: date
    return_reason: Optional[str] = None
    follow_up_status: str = "PENDING"


class MagazineReturnCreate(MagazineReturnBase):
    pass


class MagazineReturnUpdate(BaseModel):
    return_reason: Optional[str] = None
    follow_up_status: Optional[str] = None


class MagazineReturn(MagazineReturnBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class MagazineDeliveryBatchCreate(BaseModel):
    batch_name: str
    issue_month_year: str
    dispatch_date: Optional[date] = None
    status: str = "PENDING"

class MagazineDeliveryBatch(BaseModel):
    id: int
    batch_name: str
    issue_month_year: str
    dispatch_date: Optional[date] = None
    status: str
    total_labels: int = 0
    filters_applied: Optional[str] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
