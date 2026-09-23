from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from datetime import datetime, date, timezone
from sqlalchemy import func
from models.members import Member, MemberMembership
from models.masters import District, Taluk, MembershipType
from models.receipts import Receipt, ReceiptAllocation
from models.magazines import (
    MagazineSubscription,
    MagazineDeliveryPause,
    MagazineLabelBatch,
    MagazineLabelBatchItem,
    MagazineReturn,
)
from models.reports import ReportExportLog, SavedReport
from api import deps
from models.users import User
from core.pagination import paginate
from schemas import reports as schemas_reports
import pandas as pd
import io
import re

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


# ─────────────── shared helpers ───────────────

def _export_response(
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


def _member_name(m: Member) -> str:
    return " ".join(p for p in (m.first_name_en, m.last_name_en) if p)


def _member_geo_rows(
    db: Session,
    *,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    state_id: Optional[int] = None,
    approval_status: Optional[str] = None,
    gender: Optional[str] = None,
    membership_type_id: Optional[int] = None,
):
    """Members joined with their district/taluk names for grouped reports."""
    q = (
        db.query(
            Member,
            District.name_en.label("district_name"),
            District.name_kn.label("district_name_kn"),
            Taluk.name_en.label("taluk_name"),
            Taluk.name_kn.label("taluk_name_kn"),
        )
        .outerjoin(District, District.id == Member.district_id)
        .outerjoin(Taluk, Taluk.id == Member.taluk_id)
        .filter(Member.is_deleted == False)
    )
    if state_id:
        q = q.filter(Member.state_id == state_id)
    if district_id:
        q = q.filter(Member.district_id == district_id)
    if taluk_id:
        q = q.filter(Member.taluk_id == taluk_id)
    if approval_status:
        q = q.filter(Member.approval_status == approval_status)
    if gender:
        q = q.filter(Member.gender == gender)
    if membership_type_id:
        q = q.join(MemberMembership, MemberMembership.member_id == Member.id).filter(
            MemberMembership.membership_type_id == membership_type_id,
            MemberMembership.is_deleted == False,
        )
    return q


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
    """All-members report. Use export=csv or export=excel to download;
    language=kn renders Kannada headers; columns picks the print fields."""
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


# ─────────────── geography / gender / membership-type reports ───────────────

@router.get("/members/by-geography")
def report_members_by_geography(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    group_by: str = "district",  # "district" or "taluk"
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    approval_status: Optional[str] = None,
    gender: Optional[str] = None,
    membership_type_id: Optional[int] = None,
    export: Optional[str] = None,
) -> Any:
    """District-wise / taluk-wise member counts (with the member list on request)."""
    group_by = (group_by or "district").lower()
    if group_by not in ("district", "taluk"):
        raise HTTPException(400, "group_by must be 'district' or 'taluk'")

    rows = _member_geo_rows(
        db, state_id=state_id, district_id=district_id, taluk_id=taluk_id,
        approval_status=approval_status, gender=gender,
        membership_type_id=membership_type_id,
    ).all()

    counts: dict = {}
    for m, district_name, district_kn, taluk_name, taluk_kn in rows:
        if group_by == "district":
            key = (m.district_id, district_name or "Unspecified")
            extra = {"district_name_kn": district_kn}
        else:
            key = (m.taluk_id, taluk_name or "Unspecified")
            extra = {"taluk_name_kn": taluk_kn, "district_name": district_name}
        entry = counts.setdefault(key, {"count": 0, **extra})
        entry["count"] += 1

    data = []
    for (geo_id, name), info in sorted(counts.items(), key=lambda kv: (kv[0][1] or "", -kv[1]["count"])):
        row = {
            f"{group_by}_id": geo_id,
            f"{group_by}_name": name,
            "member_count": info["count"],
        }
        for extra_key, extra_val in info.items():
            if extra_key != "count":
                row[extra_key] = extra_val
        data.append(row)

    export_filters = {
        "group_by": group_by, "state_id": state_id, "district_id": district_id,
        "taluk_id": taluk_id, "approval_status": approval_status,
        "gender": gender, "membership_type_id": membership_type_id,
    }
    if export:
        return _export_response(
            db, current_user, "members_by_geography", export, export_filters,
            data, f"members_by_{group_by}",
        )

    total_members = sum(r["member_count"] for r in data)

    # Optional member list per group for drill-down screens
    members = [{
        "member_code": m.member_code,
        "name": _member_name(m),
        "full_name_kn": m.full_name_kn,
        "mobile": m.mobile,
        "district_id": m.district_id,
        "district_name": district_name,
        "taluk_id": m.taluk_id,
        "taluk_name": taluk_name,
    } for m, district_name, _, taluk_name, _ in rows]

    return {
        "total": len(data),
        "total_members": total_members,
        "group_by": group_by,
        "data": data,
        "members": members,
    }


@router.get("/members/by-gender")
def report_members_by_gender(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    approval_status: Optional[str] = None,
    export: Optional[str] = None,
) -> Any:
    """Gender-wise member counts (MALE/FEMALE/OTHER/unspecified)."""
    rows = _member_geo_rows(
        db, state_id=state_id, district_id=district_id, taluk_id=taluk_id,
        approval_status=approval_status,
    ).all()

    counts: dict = {}
    for m, *_ in rows:
        key = m.gender or "UNSPECIFIED"
        counts[key] = counts.get(key, 0) + 1

    data = [
        {"gender": g, "member_count": c}
        for g, c in sorted(counts.items(), key=lambda kv: -kv[1])
    ]

    export_filters = {
        "district_id": district_id, "taluk_id": taluk_id,
        "approval_status": approval_status,
    }
    if export:
        return _export_response(
            db, current_user, "members_by_gender", export, export_filters,
            data, "members_by_gender",
        )

    members = [{
        "member_code": m.member_code,
        "name": _member_name(m),
        "full_name_kn": m.full_name_kn,
        "gender": m.gender,
        "mobile": m.mobile,
    } for m, *_ in rows]

    return {
        "total": len(data),
        "total_members": len(rows),
        "data": data,
        "members": members,
    }


@router.get("/members/by-membership-type")
def report_members_by_membership_type(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    membership_type_id: Optional[int] = None,
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    active_only: bool = False,
    export: Optional[str] = None,
) -> Any:
    """Membership type based report: member counts per type (+ member list)."""
    q = (
        db.query(
            Member,
            MembershipType,
            MemberMembership.status.label("membership_status"),
            MemberMembership.membership_number,
        )
        .join(MemberMembership, MemberMembership.member_id == Member.id)
        .join(MembershipType, MembershipType.id == MemberMembership.membership_type_id)
        .filter(
            Member.is_deleted == False,
            MemberMembership.is_deleted == False,
            MembershipType.is_deleted == False,
        )
    )
    if membership_type_id:
        q = q.filter(MembershipType.id == membership_type_id)
    if state_id:
        q = q.filter(Member.state_id == state_id)
    if district_id:
        q = q.filter(Member.district_id == district_id)
    if taluk_id:
        q = q.filter(Member.taluk_id == taluk_id)
    if active_only:
        q = q.filter(MemberMembership.status == "ACTIVE")

    rows = q.all()

    types: dict = {}
    for m, mt, status, number in rows:
        entry = types.setdefault(mt.id, {
            "type_code": mt.code,
            "type_name_en": mt.name_en,
            "type_name_kn": mt.name_kn,
            "member_count": 0,
        })
        entry["member_count"] += 1

    data = sorted(types.values(), key=lambda t: -t["member_count"])

    export_filters = {
        "membership_type_id": membership_type_id, "state_id": state_id,
        "district_id": district_id, "taluk_id": taluk_id,
        "active_only": active_only,
    }
    if export:
        return _export_response(
            db, current_user, "members_by_membership_type", export,
            export_filters, data, "members_by_membership_type",
        )

    members = [{
        "member_code": m.member_code,
        "name": _member_name(m),
        "full_name_kn": m.full_name_kn,
        "mobile": m.mobile,
        "membership_type_id": mt.id,
        "membership_type": mt.name_en,
        "membership_number": number,
        "membership_status": status,
    } for m, mt, status, number in rows]

    return {
        "total": len(data),
        "total_memberships": len(rows),
        "data": data,
        "members": members,
    }


# ─────────────── unapproved members report ───────────────

@router.get("/unapproved-members")
def report_unapproved(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    state_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    registration_source: Optional[str] = None,
    registered_from: Optional[date] = None,
    registered_to: Optional[date] = None,
    export: Optional[str] = None,
) -> Any:
    """Report of all unapproved members (registration pending approval)."""
    q = (
        db.query(
            Member,
            District.name_en.label("district_name"),
            Taluk.name_en.label("taluk_name"),
        )
        .outerjoin(District, District.id == Member.district_id)
        .outerjoin(Taluk, Taluk.id == Member.taluk_id)
        .filter(
            Member.approval_status.in_(("UNAPPROVED", "PENDING")),
            Member.is_deleted == False,
        )
    )
    if state_id:
        q = q.filter(Member.state_id == state_id)
    if district_id:
        q = q.filter(Member.district_id == district_id)
    if taluk_id:
        q = q.filter(Member.taluk_id == taluk_id)
    if registration_source:
        q = q.filter(Member.registration_source == registration_source)
    if registered_from:
        q = q.filter(func.date(Member.created_at) >= registered_from)
    if registered_to:
        q = q.filter(func.date(Member.created_at) <= registered_to)

    rows = q.all()
    data = [{
        "member_id": m.id,
        "member_code": m.member_code,
        "name": _member_name(m),
        "full_name_kn": m.full_name_kn,
        "gender": m.gender,
        "mobile": m.mobile,
        "district": district_name,
        "taluk": taluk_name,
        "registration_source": m.registration_source,
        "registered_on": m.created_at.date() if m.created_at else None,
        "approval_status": m.approval_status,
    } for m, district_name, taluk_name in rows]

    export_filters = {
        "district_id": district_id, "taluk_id": taluk_id,
        "registration_source": registration_source,
        "registered_from": registered_from, "registered_to": registered_to,
    }
    if export:
        return _export_response(
            db, current_user, "unapproved_members", export, export_filters,
            data, "unapproved_members_report",
        )

    return {"total": len(data), "data": data}


# ─────────────── labels report (pending / generated) ───────────────

def _active_pause_subscription_ids(db: Session) -> set:
    today = date.today()
    return {
        p.subscription_id
        for p in db.query(MagazineDeliveryPause).filter(
            MagazineDeliveryPause.pause_start_date <= today,
            (MagazineDeliveryPause.pause_end_date >= today)
            | (MagazineDeliveryPause.pause_end_date == None),  # noqa: E711
            MagazineDeliveryPause.is_deleted == False,
        ).all()
    }


@router.get("/labels")
def report_labels(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    status: str = "pending",  # "pending" or "generated"
    issue_month_year: Optional[str] = None,
    batch_id: Optional[int] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    export: Optional[str] = None,
) -> Any:
    """Magazine labels report.

    status=pending: members eligible for printing but not yet in a generated
    batch for the issue (stopped subscriptions and active pauses excluded).
    status=generated: labels already produced for the issue, returns flagged.
    """
    status = (status or "pending").lower()
    if status not in ("pending", "generated"):
        raise HTTPException(400, "status must be 'pending' or 'generated'")
    if issue_month_year and not re.match(r"^\d{4}-\d{2}$", issue_month_year):
        raise HTTPException(400, "issue_month_year must be in YYYY-MM format")

    export_filters = {
        "status": status, "issue_month_year": issue_month_year,
        "batch_id": batch_id, "district_id": district_id, "taluk_id": taluk_id,
    }

    if status == "pending":
        q = (
            db.query(Member, MagazineSubscription, District.name_en, Taluk.name_en)
            .join(MagazineSubscription, MagazineSubscription.member_id == Member.id)
            .outerjoin(District, District.id == Member.district_id)
            .outerjoin(Taluk, Taluk.id == Member.taluk_id)
            .filter(
                MagazineSubscription.delivery_status == "ACTIVE",
                MagazineSubscription.is_deleted == False,
                Member.is_deleted == False,
            )
        )
        if district_id:
            q = q.filter(Member.district_id == district_id)
        if taluk_id:
            q = q.filter(Member.taluk_id == taluk_id)

        rows = q.all()
        paused = _active_pause_subscription_ids(db)

        # Members already present in a generated batch for the issue are no
        # longer pending (unless the caller passes batch_id to preview one batch).
        printed_member_ids: set = set()
        if issue_month_year:
            printed_member_ids = {
                item.recipient_id
                for item in db.query(MagazineLabelBatchItem)
                .join(MagazineLabelBatch, MagazineLabelBatch.id == MagazineLabelBatchItem.label_batch_id)
                .filter(
                    MagazineLabelBatch.issue_month_year == issue_month_year,
                    MagazineLabelBatchItem.recipient_type == "MEMBER",
                    MagazineLabelBatchItem.is_deleted == False,
                    MagazineLabelBatch.is_deleted == False,
                )
                .all()
            }

        data = [{
            "member_id": m.id,
            "member_code": m.member_code,
            "name": _member_name(m),
            "address_line1": m.address_line1,
            "locality": m.locality,
            "mobile": m.mobile,
            "district": district_name,
            "taluk": taluk_name,
        } for m, sub, district_name, taluk_name in rows
            if sub.id not in paused and m.id not in printed_member_ids]
        report_key = "labels_pending"
    else:
        q = (
            db.query(MagazineLabelBatchItem, MagazineLabelBatch)
            .join(MagazineLabelBatch, MagazineLabelBatch.id == MagazineLabelBatchItem.label_batch_id)
            .filter(
                MagazineLabelBatchItem.is_deleted == False,
                MagazineLabelBatch.is_deleted == False,
            )
        )
        if issue_month_year:
            q = q.filter(MagazineLabelBatch.issue_month_year == issue_month_year)
        if batch_id:
            q = q.filter(MagazineLabelBatch.id == batch_id)

        items = q.order_by(MagazineLabelBatchItem.id).all()

        # Resolve member rows for names/addresses; non-member recipients are
        # reported with their type only.
        member_ids = {i.recipient_id for i, _ in items if i.recipient_type == "MEMBER"}
        members = {
            m.id: m
            for m in db.query(Member).filter(Member.id.in_(member_ids or {0})).all()
        }
        data = []
        for item, batch in items:
            m = members.get(item.recipient_id) if item.recipient_type == "MEMBER" else None
            data.append({
                "batch_id": batch.id,
                "batch_name": batch.batch_name,
                "issue_month_year": batch.issue_month_year,
                "recipient_type": item.recipient_type,
                "recipient_id": item.recipient_id,
                "name": _member_name(m) if m else None,
                "label_address": item.label_address,
                "is_return": item.is_return,
            })
        report_key = "labels_generated"

    if export:
        return _export_response(
            db, current_user, report_key, export, export_filters,
            data, f"{report_key}_report",
        )

    return {
        "status": status,
        "total": len(data),
        "returned_count": sum(1 for r in data if r.get("is_return")),
        "data": data,
    }


# ─────────────── magazine returns report ───────────────

@router.get("/magazine-returns")
def report_magazine_returns(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    issue_month_year: Optional[str] = None,
    follow_up_status: Optional[str] = None,
    district_id: Optional[int] = None,
    taluk_id: Optional[int] = None,
    export: Optional[str] = None,
) -> Any:
    """Magazine returned report: who returned which issue and the follow-up state."""
    if issue_month_year and not re.match(r"^\d{4}-\d{2}$", issue_month_year):
        raise HTTPException(400, "issue_month_year must be in YYYY-MM format")

    q = (
        db.query(MagazineReturn, MagazineSubscription, Member, District.name_en, Taluk.name_en)
        .join(MagazineSubscription, MagazineSubscription.id == MagazineReturn.subscription_id)
        .join(Member, Member.id == MagazineSubscription.member_id)
        .outerjoin(District, District.id == Member.district_id)
        .outerjoin(Taluk, Taluk.id == Member.taluk_id)
        .filter(
            MagazineReturn.is_deleted == False,
            MagazineSubscription.is_deleted == False,
            Member.is_deleted == False,
        )
    )
    if issue_month_year:
        q = q.filter(MagazineReturn.issue_month_year == issue_month_year)
    if follow_up_status:
        q = q.filter(MagazineReturn.follow_up_status == follow_up_status)
    if district_id:
        q = q.filter(Member.district_id == district_id)
    if taluk_id:
        q = q.filter(Member.taluk_id == taluk_id)

    rows = q.order_by(MagazineReturn.return_date.desc()).all()
    data = [{
        "return_id": r.id,
        "member_id": m.id,
        "member_code": m.member_code,
        "name": _member_name(m),
        "full_name_kn": m.full_name_kn,
        "mobile": m.mobile,
        "district": district_name,
        "taluk": taluk_name,
        "issue_month_year": r.issue_month_year,
        "return_date": r.return_date,
        "return_reason": r.return_reason,
        "follow_up_status": r.follow_up_status,
    } for r, sub, m, district_name, taluk_name in rows]

    export_filters = {
        "issue_month_year": issue_month_year, "follow_up_status": follow_up_status,
        "district_id": district_id, "taluk_id": taluk_id,
    }
    if export:
        return _export_response(
            db, current_user, "magazine_returns", export, export_filters,
            data, "magazine_returns_report",
        )

    return {
        "total": len(data),
        "pending_follow_ups": sum(1 for r in data if r["follow_up_status"] == "PENDING"),
        "data": data,
    }


# ─────────────── receipt reports ───────────────

@router.get("/receipts")
def report_receipts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    payment_status: Optional[str] = None,
    payment_mode: Optional[str] = None,
    receipt_type: Optional[str] = None,
    source: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    export: Optional[str] = None,
) -> Any:
    """Receipts report with filters and totals summary."""
    query = db.query(Receipt).filter(Receipt.is_deleted == False)
    if payment_status:
        query = query.filter(Receipt.payment_status == payment_status)
    if payment_mode:
        query = query.filter(Receipt.payment_mode == payment_mode)
    if receipt_type:
        query = query.filter(Receipt.receipt_type == receipt_type)
    if source:
        query = query.filter(Receipt.source == source)
    if from_date:
        query = query.filter(Receipt.receipt_date >= from_date)
    if to_date:
        query = query.filter(Receipt.receipt_date <= to_date)

    receipts = query.order_by(Receipt.receipt_date.desc()).all()
    data = [{
        "receipt_number": r.receipt_number,
        "receipt_date": str(r.receipt_date),
        "receipt_type": r.receipt_type,
        "payer_name": r.payer_name,
        "payment_mode": r.payment_mode,
        "source": r.source,
        "net_amount": float(r.net_amount),
        "payment_status": r.payment_status,
    } for r in receipts]

    summary = {
        "count": len(data),
        "total_amount": sum(r["net_amount"] for r in data),
        "cancelled": sum(1 for r in data if r["payment_status"] == "CANCELLED"),
    }

    export_filters = {
        "payment_status": payment_status, "payment_mode": payment_mode,
        "receipt_type": receipt_type, "source": source,
        "from_date": from_date, "to_date": to_date,
    }
    if export:
        return _export_response(
            db, current_user, "receipts", export, export_filters,
            data, "receipts_report",
        )

    return {"total": len(data), "summary": summary, "data": data}


@router.get("/receipts/by-member")
def report_receipts_by_member(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    member_id: Optional[int] = None,
    receipt_type: Optional[str] = None,
    payment_mode: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    export: Optional[str] = None,
) -> Any:
    """Receipt-wise members report: every receipt mapped to a member via
    allocations (the members whose names land on the label print list)."""
    q = (
        db.query(ReceiptAllocation, Receipt, Member, District.name_en, Taluk.name_en)
        .join(Receipt, Receipt.id == ReceiptAllocation.receipt_id)
        .join(Member, Member.id == ReceiptAllocation.member_id)
        .outerjoin(District, District.id == Member.district_id)
        .outerjoin(Taluk, Taluk.id == Member.taluk_id)
        .filter(
            ReceiptAllocation.is_deleted == False,
            Receipt.is_deleted == False,
            Member.is_deleted == False,
        )
    )
    if member_id:
        q = q.filter(ReceiptAllocation.member_id == member_id)
    if receipt_type:
        q = q.filter(Receipt.receipt_type == receipt_type)
    if payment_mode:
        q = q.filter(Receipt.payment_mode == payment_mode)
    if from_date:
        q = q.filter(Receipt.receipt_date >= from_date)
    if to_date:
        q = q.filter(Receipt.receipt_date <= to_date)

    rows = q.order_by(Receipt.receipt_date.desc()).all()
    data = [{
        "allocation_id": a.id,
        "receipt_id": r.id,
        "receipt_number": r.receipt_number,
        "receipt_date": str(r.receipt_date),
        "receipt_type": r.receipt_type,
        "payment_mode": r.payment_mode,
        "receipt_source": r.source,
        "receipt_amount": float(r.net_amount),
        "allocated_amount": float(a.allocated_amount),
        "member_id": m.id,
        "member_code": m.member_code,
        "name": _member_name(m),
        "full_name_kn": m.full_name_kn,
        "mobile": m.mobile,
        "district": district_name,
        "taluk": taluk_name,
    } for a, r, m, district_name, taluk_name in rows]

    export_filters = {
        "member_id": member_id, "receipt_type": receipt_type,
        "payment_mode": payment_mode, "from_date": from_date, "to_date": to_date,
    }
    if export:
        return _export_response(
            db, current_user, "receipts_by_member", export, export_filters,
            data, "receipts_by_member_report",
        )

    return {
        "total": len(data),
        "total_allocated": sum(r["allocated_amount"] for r in data),
        "distinct_members": len({r["member_id"] for r in data}),
        "data": data,
    }


# ─────────────── consolidated summary ───────────────

@router.get("/summary")
def report_summary(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """One-shot snapshot of every existing data area for the dashboard."""
    def count(q):
        return q.count()

    members_total = count(db.query(Member).filter(Member.is_deleted == False))
    members_by_approval = dict(
        db.query(Member.approval_status, func.count(Member.id))
        .filter(Member.is_deleted == False)
        .group_by(Member.approval_status)
        .all()
    )
    members_by_gender = dict(
        db.query(func.coalesce(Member.gender, "UNSPECIFIED"), func.count(Member.id))
        .filter(Member.is_deleted == False)
        .group_by(func.coalesce(Member.gender, "UNSPECIFIED"))
        .all()
    )
    members_by_source = dict(
        db.query(Member.registration_source, func.count(Member.id))
        .filter(Member.is_deleted == False)
        .group_by(Member.registration_source)
        .all()
    )

    receipts = db.query(Receipt).filter(Receipt.is_deleted == False)
    receipt_count = receipts.count()
    receipt_amount = float(
        db.query(func.coalesce(func.sum(Receipt.net_amount), 0))
        .filter(Receipt.is_deleted == False)
        .scalar() or 0
    )
    allocated_amount = float(
        db.query(func.coalesce(func.sum(ReceiptAllocation.allocated_amount), 0))
        .filter(ReceiptAllocation.is_deleted == False)
        .scalar() or 0
    )

    subs = db.query(MagazineSubscription).filter(MagazineSubscription.is_deleted == False)
    subs_by_status = dict(
        db.query(MagazineSubscription.delivery_status, func.count(MagazineSubscription.id))
        .filter(MagazineSubscription.is_deleted == False)
        .group_by(MagazineSubscription.delivery_status)
        .all()
    )
    active_pause_ids = _active_pause_subscription_ids(db)
    returns_total = count(db.query(MagazineReturn).filter(MagazineReturn.is_deleted == False))
    pending_returns = count(
        db.query(MagazineReturn).filter(
            MagazineReturn.is_deleted == False,
            MagazineReturn.follow_up_status == "PENDING",
        )
    )

    memberships_by_type = [
        {"membership_type": mt.name_en, "type_name_kn": mt.name_kn, "member_count": c}
        for mt, c in (
            db.query(MembershipType, func.count(MemberMembership.id))
            .join(MemberMembership, MemberMembership.membership_type_id == MembershipType.id)
            .filter(
                MembershipType.is_deleted == False,
                MemberMembership.is_deleted == False,
            )
            .group_by(MembershipType.id)
            .all()
        )
    ]

    return {
        "members": {
            "total": members_total,
            "by_approval_status": members_by_approval,
            "by_gender": members_by_gender,
            "by_registration_source": members_by_source,
        },
        "receipts": {
            "count": receipt_count,
            "total_amount": receipt_amount,
            "allocated_amount": allocated_amount,
        },
        "memberships": {
            "by_type": memberships_by_type,
        },
        "magazines": {
            "subscriptions_by_status": subs_by_status,
            "active_pauses": len(active_pause_ids),
            "returns_total": returns_total,
            "returns_pending_follow_up": pending_returns,
        },
    }


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
