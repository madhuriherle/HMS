"""Members whose stored data looks wrong, one list per kind of problem, for the office to correct.
Nothing is changed here: the office opens the member and fixes the value."""
import io
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from models.masters import District
from models.members import Member

KINDS = {
    "future_dob": "Date of birth in the future",
    "under_18": "Under 18 years old",
    "very_old": "Over 110 years old",
    "alt_number": "Alternate number is not 10 to 12 digits",
}


def _years_ago(years: int) -> date:
    today = date.today()
    try:
        return today.replace(year=today.year - years)
    except ValueError:   # 29 February
        return today.replace(year=today.year - years, day=28)


def _filter(kind: str):
    today, adult, ancient = date.today(), _years_ago(18), _years_ago(110)
    if kind == "future_dob":
        return Member.date_of_birth > today
    if kind == "under_18":
        return and_(Member.date_of_birth > adult, Member.date_of_birth <= today)
    if kind == "very_old":
        return Member.date_of_birth < ancient
    if kind == "alt_number":
        digits = func.length(func.trim(Member.alternate_mobile))
        # PostgreSQL: anything that is not 10 to 12 digits only (a landline with a dash, a short number); SQLite (tests): the length alone
        return and_(Member.alternate_mobile.isnot(None), func.trim(Member.alternate_mobile) != "", or_(digits < 10, digits > 12, Member.alternate_mobile.contains("-"), Member.alternate_mobile.contains(" ")))
    raise ValueError("kind must be one of: " + ", ".join(KINDS))


def _age(dob: Optional[date]) -> Optional[int]:
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def _row(m: Member, district: Optional[str]) -> dict:
    return {
        "id": m.id, "name": m.display_name, "membership_no": m.membership_number, "old_no": m.old_membership_number, "mobile": m.mobile,
        "alternate_mobile": m.alternate_mobile, "dob": m.date_of_birth, "age": _age(m.date_of_birth), "district": district,
        "approval": m.approval_status, "status": m.member_status,
    }


def find(db: Session, kind: str, search: Optional[str] = None, page: int = 1, limit: int = 25, everything: bool = False) -> dict:
    cond = _filter(kind)
    q = db.query(Member, District.name_en).outerjoin(District, District.id == Member.district_id).filter(Member.is_deleted == False, cond)  # noqa: E712
    wanted = (search or "").strip()
    if wanted:
        like = f"%{wanted}%"
        q = q.filter(or_(Member.full_name_en.ilike(like), Member.first_name_en.ilike(like), Member.last_name_en.ilike(like), Member.mobile.ilike(like),
                         Member.membership_number.ilike(like), Member.old_membership_number.ilike(like)))
    total = q.count()
    # the most wrong first: a date of birth furthest from today, then by name
    order = (Member.date_of_birth.desc() if kind in ("future_dob", "under_18") else Member.date_of_birth.asc()) if kind != "alt_number" else Member.id.asc()
    q = q.order_by(order, Member.id)
    rows = q.all() if everything else q.offset((max(1, page) - 1) * limit).limit(limit).all()
    return {"rows": [_row(m, d) for m, d in rows], "total": total}


def rows_xlsx(kind: str, rows: list) -> bytes:
    from openpyxl import Workbook

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Data check")
    ws.append(["Problem", "Name", "Membership no", "Old no", "Mobile", "Alternate number", "Date of birth", "Age", "District", "Approval", "Status"])
    for r in rows:
        ws.append([KINDS[kind], r["name"], r["membership_no"], r["old_no"], r["mobile"], r["alternate_mobile"], r["dob"], r["age"], r["district"], r["approval"], r["status"]])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
