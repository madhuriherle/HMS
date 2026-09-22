from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class NotificationTemplateBase(BaseModel):
    template_name: str
    provider_template_id: Optional[str] = None
    language: str = "en"
    content: str
    status: bool = True

class NotificationTemplateCreate(NotificationTemplateBase):
    pass

class NotificationTemplateUpdate(BaseModel):
    content: Optional[str] = None
    status: Optional[bool] = None

class NotificationTemplate(NotificationTemplateBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationCampaignCreate(BaseModel):
    campaign_name: str
    template_id: int
    target_audience: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: str = "PENDING"


class NotificationCampaign(BaseModel):
    id: int
    campaign_name: str
    template_id: int
    target_audience: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationCallback(BaseModel):
    message_id: int
    status_update: str
    updated_at_provider: Optional[datetime] = None
