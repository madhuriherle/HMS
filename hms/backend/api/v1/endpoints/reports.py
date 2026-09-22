from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from models.members import Member, MemberMembership
from models.receipts import Receipt
from models.reports import ReportExportLog, SavedReport
from api import deps
from models.users import User
from core.pagination import paginate
from schemas import reports as schemas_reports
import pandas as pd
import io

router = APIRouter()

# Spec: "All Approved members report (in Kannada or English) with option to
# display fields in print" — these are the selectable print fields and their
# Kannada headers.
MEMBER_REPORT_FIELDS = [
    "member_code", "first_name_en", "last_name_en", "full_name_kn",
    "gender", "mobile", "email", "approval_status", "member_status",
    "registration_source",
]
KANNADA_HEADERS = {
    "member_code": "ಸದಸ್ಯ ಸಂಖ್ಯೆ",
    "first_name_en": "ಮೊದಲ ಹೆಸರು",
    "last_name_en": "ಕೊನೆಯ ಹೆಸರು",
    "full_name_kn": "ಹೆಸರು (ಕನ್ನಡ)",
    "gender": "ಲಿಂಗ",
    "mobile": "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ",
    "email": "ಇಮೇಲ್",
    "approval_status": "ಅನುಮೋದನೆ ಸ್ಥಿತಿ",
    "member_status": "ಸದಸ್ಯ ಸ್ಥಿತಿ",
    "registration_source": "ನೋಂದಣಿ ಮೂಲ",
}

@router.get("/members")
def report_members(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    gender: Optional[str] = None,
    approval_status: Optional[str] = None,
    membership_type_id: Optional[int] = None,
    export: Optional[str] = None,  # "csv" or "excel"
    language: str = "en",          # "en" or "kn" (headers of exported files)
    columns: Optional[str] = None,  # comma separated subset of MEMBER_REPORT_FIELDS
) -> Any:
    """Members report with filters. Use export=csv or export=excel to download."""
    language = (language or "en").lower()
    if language not in ("en", "kn"):
        raise HTTPException(400, "language must be 'en' or 'kn'")

    selected = MEMBER_REPORT_FIELDS
    if columns:
        requested = [c.strip() for c in columns.split(",") if c.strip()]
        unknown = [c for c in requested if c not in MEMBER_REPORT_FIELDS]
        if unknown:
            raise HTTPException(400, f"Unknown columns: {', '.join(unknown)}")
        selected = requested
    query = db.query(Member).filter(Member.is_deleted == False)
    if district_id:
        query = query.filter(Member.district_id == district_id)
    if taluk_id:
        query = query.filter(Member.taluk_id == taluk_id)
    if gender:
        query = query.filter(Member.gender == gender)
    if approval_status:
        query = query.filter(Member.approval_status == approval_status)
    if membership_type_id:
        query = query.join(MemberMembership, MemberMembership.member_id == Member.id).filter(
            MemberMembership.membership_type_id == membership_type_id,
            MemberMembership.is_deleted == False,
        )

    members = query.all()

    full_rows = [{
        "member_code": m.member_code,
        "first_name_en": m.first_name_en,
        "last_name_en": m.last_name_en,
        "full_name_kn": m.full_name_kn,
        "gender": m.gender,
        "mobile": m.mobile,
        "email": m.email,
        "approval_status": m.approval_status,
        "member_status": m.member_status,
        "registration_source": m.registration_source,
    } for m in members]
    data = [{key: row[key] for key in selected} for row in full_rows]

    def _headers(columns_in):
        if language == "kn":
            return [KANNADA_HEADERS.get(c, c) for c in columns_in]
        return list(columns_in)

    export_filters = {
        "district_id": district_id,
        "taluk_id": taluk_id,
        "gender": gender,
        "approval_status": approval_status,
        "membership_type_id": membership_type_id,
        "language": language,
        "columns": ",".join(selected),
    }

    if export == "csv":
        log_report_export(db, current_user.id, "members", "csv", export_filters)
        df = pd.DataFrame(data, columns=selected)
        df.columns = _headers(df.columns)
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        return Response(
            # BOM so Excel opens Kannada headers correctly
            content="\ufeff" + stream.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=members_report.csv"}
        )
    elif export == "excel":
        log_report_export(db, current_user.id, "members", "excel", export_filters)
        df = pd.DataFrame(data, columns=selected)
        df.columns = _headers(df.columns)
        stream = io.BytesIO()
        df.to_excel(stream, index=False, engine="openpyxl")
        stream.seek(0)
        return Response(
            content=stream.read(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=members_report.xlsx"}
        )

    return {
        "total": len(data),
        "language": language,
        "columns": selected,
        "data": data,
    }

@router.get("/receipts")
def report_receipts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    payment_status: Optional[str] = None,
    payment_mode: Optional[str] = None,
    export: Optional[str] = None,
) -> Any:
    """Receipts report with filters."""
    query = db.query(Receipt).filter(Receipt.is_deleted == False)
    if payment_status:
        query = query.filter(Receipt.payment_status == payment_status)
    if payment_mode:
        query = query.filter(Receipt.payment_mode == payment_mode)

    receipts = query.all()
    data = [{
        "receipt_number": r.receipt_number,
        "receipt_date": str(r.receipt_date),
        "payer_name": r.payer_name,
        "payment_mode": r.payment_mode,
        "net_amount": float(r.net_amount),
        "payment_status": r.payment_status,
    } for r in receipts]

    if export == "csv":
        log_report_export(db, current_user.id, "receipts", "csv", {
            "payment_status": payment_status,
            "payment_mode": payment_mode,
        })
        df = pd.DataFrame(data)
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        return Response(
            content=stream.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=receipts_report.csv"}
        )

    return {"total": len(data), "data": data}

@router.get("/labels")
def report_labels(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    export: Optional[str] = None,
) -> Any:
    """Magazine label report – members eligible for label printing."""
    from models.magazines import MagazineSubscription
    query = (
        db.query(Member, MagazineSubscription)
        .join(MagazineSubscription, MagazineSubscription.member_id == Member.id)
        .filter(
            MagazineSubscription.delivery_status == "ACTIVE",
            MagazineSubscription.is_deleted == False,
            Member.is_deleted == False,
        )
    )
    if district_id:
        query = query.filter(Member.district_id == district_id)
    if taluk_id:
        query = query.filter(Member.taluk_id == taluk_id)

    results = query.all()
    data = [{
        "member_code": m.member_code,
        "name": f"{m.first_name_en} {m.last_name_en or ''}".strip(),
        "address_line1": m.address_line1,
        "locality": m.locality,
        "mobile": m.mobile,
    } for m, sub in results]

    if export == "csv":
        log_report_export(db, current_user.id, "labels", "csv", {
            "district_id": district_id,
            "taluk_id": taluk_id,
        })
        df = pd.DataFrame(data)
        stream = io.StringIO()
        df.to_csv(stream, index=False)
        return Response(
            content=stream.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=labels_report.csv"}
        )

    return {"total": len(data), "data": data}

@router.get("/unapproved-members")
def report_unapproved(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """Report of all unapproved members."""
    members = db.query(Member).filter(
        Member.approval_status == "UNAPPROVED",
        Member.is_deleted == False
    ).all()
    return {"total": len(members), "data": [{"id": m.id, "name": m.first_name_en, "mobile": m.mobile} for m in members]}

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

@router.get("/saved")
def read_saved_reports(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    report_key: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> Any:
    q = db.query(SavedReport).filter(SavedReport.is_deleted == False)
    if report_key:
        q = q.filter(SavedReport.report_key == report_key)
    return paginate(q, page, limit)

@router.post("/saved", response_model=schemas_reports.SavedReport)
def create_saved_report(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("reports.write")),
    report_in: schemas_reports.SavedReportCreate,
) -> Any:
    report = SavedReport(**report_in.model_dump(), created_by=current_user.id)
    db.add(report)
    db.commit()
    db.refresh(report)
    return report

@router.put("/saved/{id}", response_model=schemas_reports.SavedReport)
def update_saved_report(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("reports.write")),
    id: int,
    report_in: schemas_reports.SavedReportUpdate,
) -> Any:
    report = db.query(SavedReport).filter(SavedReport.id == id, SavedReport.is_deleted == False).first()
    if not report:
        raise HTTPException(404, "Saved report not found")
    for field, value in report_in.model_dump(exclude_unset=True).items():
        setattr(report, field, value)
    report.updated_by = current_user.id
    db.commit()
    db.refresh(report)
    return report

@router.delete("/saved/{id}")
def delete_saved_report(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("reports.write")),
    id: int,
) -> Any:
    report = db.query(SavedReport).filter(SavedReport.id == id, SavedReport.is_deleted == False).first()
    if not report:
        raise HTTPException(404, "Saved report not found")
    report.is_deleted = True
    report.deleted_by = current_user.id
    db.commit()
    return {"message": "Saved report deleted"}

@router.get("/export-logs")
def read_export_logs(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    report_key: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> Any:
    q = db.query(ReportExportLog).filter(ReportExportLog.is_deleted == False)
    if report_key:
        q = q.filter(ReportExportLog.report_key == report_key)
    return paginate(q.order_by(ReportExportLog.exported_at.desc()), page, limit)
