from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class SavedReportBase(BaseModel):
    name: str
    report_key: str
    filters: Optional[dict] = None
    columns_config: Optional[dict] = None
    language: str = "en"
    is_shared: bool = False


class SavedReportCreate(SavedReportBase):
    pass


class SavedReportUpdate(BaseModel):
    name: Optional[str] = None
    filters: Optional[dict] = None
    columns_config: Optional[dict] = None
    language: Optional[str] = None
    is_shared: Optional[bool] = None


class SavedReport(SavedReportBase):
    id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ReportExportLogBase(BaseModel):
    report_key: str
    filters: Optional[dict] = None
    file_path: Optional[str] = None
    format: str


class ReportExportLogCreate(ReportExportLogBase):
    pass


class ReportExportLogUpdate(BaseModel):
    file_path: Optional[str] = None


class ReportExportLog(ReportExportLogBase):
    id: int
    exported_by: Optional[int] = None
    exported_at: datetime
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
