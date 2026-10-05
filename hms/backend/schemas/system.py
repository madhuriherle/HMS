from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class FileAttachmentBase(BaseModel):
    entity_type: str
    entity_id: int
    file_path: str
    original_filename: str
    mime_type: Optional[str] = None

class FileAttachmentCreate(FileAttachmentBase):
    uploaded_by: Optional[int] = None

class FileAttachmentUpdate(BaseModel):
    pass

class FileAttachment(FileAttachmentBase):
    id: int
    uploaded_at: datetime
    model_config = ConfigDict(from_attributes=True)

class SystemErrorLogBase(BaseModel):
    error_message: str
    stack_trace: Optional[str] = None
    endpoint: Optional[str] = None

class SystemErrorLogCreate(SystemErrorLogBase):
    pass

class SystemErrorLogUpdate(BaseModel):
    pass

class SystemErrorLog(SystemErrorLogBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class OrganisationSettingsUpdate(BaseModel):
    """Partial PUT body for the Settings screen: only the fields present in
    the request are changed. Unknown fields are rejected (422) so typos don't
    silently drop data."""
    model_config = ConfigDict(extra="forbid")

    # Organisation profile
    name_en: Optional[str] = None
    name_kn: Optional[str] = None
    address_en: Optional[str] = None
    address_kn: Optional[str] = None
    registration_no: Optional[str] = None
    iso_cert_no: Optional[str] = None
    logo_path: Optional[str] = None
    website: Optional[str] = None
    # Contact settings
    phone: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    # Print-header settings
    print_header_enabled: Optional[bool] = None
    receipt_footer_note_en: Optional[str] = None
    receipt_footer_note_kn: Optional[str] = None
    president_title_en: Optional[str] = None
    president_title_kn: Optional[str] = None
    secretary_title_en: Optional[str] = None
    secretary_title_kn: Optional[str] = None
    treasurer_title_en: Optional[str] = None
    treasurer_title_kn: Optional[str] = None
    pay_mode_cash_en: Optional[str] = None
    pay_mode_cash_kn: Optional[str] = None
    pay_mode_cheque_en: Optional[str] = None
    pay_mode_cheque_kn: Optional[str] = None
    pay_mode_dd_en: Optional[str] = None
    pay_mode_dd_kn: Optional[str] = None
    pay_mode_upi_en: Optional[str] = None
    pay_mode_upi_kn: Optional[str] = None
    # Notification settings
    notify_email_enabled: Optional[bool] = None
    notify_sms_enabled: Optional[bool] = None
    notify_whatsapp_enabled: Optional[bool] = None
    notify_reply_to_email: Optional[str] = None
    notify_footer_note: Optional[str] = None

class OrganisationSettings(OrganisationSettingsUpdate):
    """Response shape of GET/PUT /system/settings."""
    id: int
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = ConfigDict(from_attributes=True)
