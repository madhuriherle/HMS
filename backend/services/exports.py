"""Shared CSV / Excel export helpers.

Moved out of reports.py so operational screens (receipt tracking) can offer
the same Export button as the reports module. Every export is logged to
report_export_logs for the audit trail.
"""
import io
from typing import List, Optional

import pandas as pd
from fastapi import HTTPException, Response
from sqlalchemy.orm import Session

from datetime import datetime, timezone

from models.reports import ReportExportLog
from models.users import User


def log_report_export(db: Session, user_id: int, report_key: str, export_format: str, filters: dict) -> None:
    db.add(ReportExportLog(
        report_key=report_key,
        filters={key: value for key, value in filters.items() if value is not None},
        format=export_format,
        exported_by=user_id,
        exported_at=datetime.now(timezone.utc),
        created_by=user_id,
    ))
    db.commit()


def _dates_as_dd_mm_yyyy(df: pd.DataFrame) -> pd.DataFrame:
    """Dates in a download read DD-MM-YYYY, like everywhere else on screen (times are kept)."""
    import datetime as _dt

    def fmt(v):
        if v is pd.NaT:
            return None     # a blank date (pandas turns it into NaT) stays blank
        if isinstance(v, _dt.datetime):
            return v.strftime("%d-%m-%Y %H:%M:%S")
        if isinstance(v, _dt.date):
            return v.strftime("%d-%m-%Y")
        return v

    for col in df.columns:
        if df[col].map(lambda v: isinstance(v, (_dt.date, _dt.datetime))).any():
            df[col] = df[col].map(fmt)
    return df


def render_export(
    db: Session,
    current_user: User,
    report_key: str,
    export: str,
    filters: dict,
    data: List[dict],
    filename: str,
):
    """Render rows as CSV (with Kannada-safe BOM) or Excel, logging the export."""
    if export not in ("csv", "excel"):
        raise HTTPException(400, "export must be 'csv' or 'excel'")
    log_report_export(db, current_user.id, report_key, export, filters)
    df = pd.DataFrame(data)
    df = _dates_as_dd_mm_yyyy(df)
    if export == "csv":
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        return Response(
            # BOM so Excel opens Kannada content correctly
            content="\ufeff" + stream.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
        )
    stream = io.BytesIO()
    df.to_excel(stream, index=False, engine="openpyxl")
    stream.seek(0)
    return Response(
        content=stream.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"},
    )


# Backwards-compatible alias for reports.py's internal call sites.
_export_response = render_export
