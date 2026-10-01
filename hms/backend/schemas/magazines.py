from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    """Pausing needs a reason (e.g. 'returned twice') and starts today unless
    a date is given."""
    pause_start_date: date = Field(default_factory=date.today)
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_required(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A reason is required to pause the magazine service")
        return v.strip()

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
    return_date: date = Field(default_factory=date.today)


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

class MagazineDeliveryBatchUpdate(BaseModel):
    batch_name: Optional[str] = None
    issue_month_year: Optional[str] = None
    dispatch_date: Optional[date] = None
    status: Optional[str] = None


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
