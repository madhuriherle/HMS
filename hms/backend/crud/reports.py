from crud.base import CRUDBase
from models.reports import ReportExportLog, SavedReport
from schemas.reports import (
    ReportExportLogCreate,
    ReportExportLogUpdate,
    SavedReportCreate,
    SavedReportUpdate,
)


class CRUDSavedReport(CRUDBase[SavedReport, SavedReportCreate, SavedReportUpdate]):
    pass


class CRUDReportExportLog(CRUDBase[ReportExportLog, ReportExportLogCreate, ReportExportLogUpdate]):
    pass


saved_report = CRUDSavedReport(SavedReport)
export_log = CRUDReportExportLog(ReportExportLog)
