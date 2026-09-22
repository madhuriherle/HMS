from typing import Optional, List
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict

class EventBase(BaseModel):
    title: str
    description: Optional[str] = None
    event_date: date
    location: Optional[str] = None
    invitation_file_path: Optional[str] = None

class EventCreate(EventBase):
    pass

class EventUpdate(BaseModel):
    title: Optional[str] = None
    event_date: Optional[date] = None
    location: Optional[str] = None

class EventInDBBase(EventBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class Event(EventInDBBase):
    pass
