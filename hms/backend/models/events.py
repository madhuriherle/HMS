from sqlalchemy import String, BigInteger, Boolean, DateTime, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, AuditMixin

class Event(AuditMixin, Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    event_date: Mapped[Date] = mapped_column(Date, nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=True)
    invitation_file_path: Mapped[str] = mapped_column(Text, nullable=True)

class EventParticipant(AuditMixin, Base):
    __tablename__ = "event_participants"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), nullable=False)
    participant_name: Mapped[str] = mapped_column(String(150), nullable=False)
    participant_role: Mapped[str] = mapped_column(String(100), nullable=True)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=True)

class EventMemberLink(AuditMixin, Base):
    __tablename__ = "event_member_links"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), nullable=False)
    member_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("members.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(100), nullable=True)

class EventAttachment(AuditMixin, Base):
    __tablename__ = "event_attachments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=True)
