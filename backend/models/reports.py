from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from models.base import AuditMixin, Base


class SavedReport(AuditMixin, Base):
    __tablename__ = "saved_reports"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    report_key: Mapped[str] = mapped_column(String(150), nullable=False)
    filters: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    columns_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ReportExportLog(AuditMixin, Base):
    __tablename__ = "report_export_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, index=True)
    report_key: Mapped[str] = mapped_column(String(150), nullable=False)
    filters: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    file_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    format: Mapped[str] = mapped_column(String(20), nullable=False)
    exported_by: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    exported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
