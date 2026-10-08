from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, AuditMixin


class ApprovalRequest(AuditMixin, Base):
    """Generic maker-checker queue for any create/update/delete action whose
    permission grant is flagged requires_approval (see
    api.deps.permission_requires_approval and services.approval_gate).

    On approval, services.approval_registry looks up the endpoint function
    originally registered for (module, action, entity_type) and re-invokes
    it with the ORIGINAL requester's identity and the captured payload —
    the same code path the direct API call would have taken, so there is no
    separately-maintained copy of the business logic to drift out of sync.
    """
    __tablename__ = "approval_requests"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    module: Mapped[str] = mapped_column(String(80), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)  # CREATE, UPDATE, DELETE
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)  # None for CREATE
    permission_code: Mapped[str] = mapped_column(String(120), nullable=False)
    payload: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    requested_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)  # PENDING/APPROVED/REJECTED
    reviewed_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    executed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # set if replay raised on approval
