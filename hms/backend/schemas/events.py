from typing import Optional
from datetime import datetime, date
from pydantic import BaseModel, ConfigDict, field_validator

# Guests attend; honoured persons are felicitated on stage.
VALID_PARTICIPANT_TYPES = {"GUEST", "HONOURED"}


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
    description: Optional[str] = None
    event_date: Optional[date] = None
    location: Optional[str] = None
    invitation_file_path: Optional[str] = None

class EventInDBBase(EventBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)

class Event(EventInDBBase):
    pass


class EventParticipantBase(BaseModel):
    participant_name: str
    participant_role: Optional[str] = None
    participant_type: str = "GUEST"
    member_id: Optional[int] = None

    @field_validator("participant_type")
    @classmethod
    def type_allowed(cls, v: str) -> str:
        v = (v or "").upper()
        if v not in VALID_PARTICIPANT_TYPES:
            raise ValueError(f"participant_type must be one of {sorted(VALID_PARTICIPANT_TYPES)}")
        return v


class EventParticipantCreate(EventParticipantBase):
    pass


class EventParticipantUpdate(BaseModel):
    participant_name: Optional[str] = None
    participant_role: Optional[str] = None
    participant_type: Optional[str] = None
    member_id: Optional[int] = None


class EventParticipant(EventParticipantBase):
    id: int
    event_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
