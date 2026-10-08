from typing import Optional
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict

class NotificationTemplateBase(BaseModel):
    template_name: str
    provider_template_id: Optional[str] = None
    language: str = "en"
    content: str
    purpose: str = "GENERAL"
    status: bool = True


class ProviderApprovalStatus(str, Enum):
    """WhatsApp provider template-review states we track per template."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class TemplateApprovalStatusUpdate(BaseModel):
    """Body for PUT /notifications/templates/{id}/approval-status.

    Records what the provider dashboard says so the bulk-send screen can
    filter on 'approved templates only'."""

    provider_approval_status: ProviderApprovalStatus
    provider_template_id: Optional[str] = None
    note: Optional[str] = None

class NotificationTemplateCreate(NotificationTemplateBase):
    pass

class NotificationTemplateUpdate(BaseModel):
    template_name: Optional[str] = None
    provider_template_id: Optional[str] = None
    language: Optional[str] = None
    content: Optional[str] = None
    purpose: Optional[str] = None
    status: Optional[bool] = None

class NotificationTemplate(NotificationTemplateBase):
    id: int
    created_at: datetime
    provider_approval_status: Optional[str] = None
    provider_approval_synced_at: Optional[datetime] = None
    provider_approval_note: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class InboxBroadcastCreate(BaseModel):
    title: str
    body: str
    source: Optional[str] = "MANUAL"
    data: Optional[dict] = None


class DeviceTokenCreate(BaseModel):
    device_token: str
    platform: str = "FCM"  # FCM or APNS
    device_name: Optional[str] = None


class NotificationCampaignCreate(BaseModel):
    campaign_name: str
    template_id: int
    target_audience: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: str = "PENDING"
    # MEMBERS (default): pick recipients from registered members using
    # member_filters; empty filters = all active members.
    member_filters: Optional[dict] = None


class BulkSendRequest(BaseModel):
    """Body for POST /notifications/send-bulk."""

    template_id: int
    member_filters: Optional[dict] = None


class NotificationCampaignUpdate(BaseModel):
    campaign_name: Optional[str] = None
    template_id: Optional[int] = None
    target_audience: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    member_filters: Optional[dict] = None


class NotificationCampaign(BaseModel):
    id: int
    campaign_name: str
    template_id: int
    target_audience: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    status: str
    source: str = "MEMBERS"
    member_filters: Optional[dict] = None
    total_recipients: int = 0
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class NotificationCallback(BaseModel):
    message_id: int
    status_update: str
    updated_at_provider: Optional[datetime] = None
