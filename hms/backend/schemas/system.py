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
