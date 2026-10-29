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
    "bad_email": "Email address is not in a valid format",
    "no_place": "No pincode or no district",
    "print_no_address": "Printed magazine but no address",
    "odd_name": "Odd characters in the name",
}


def _years_ago(years: int) -> date:
    today = date.today()
    try:
        return today.replace(year=today.year - years)
    except ValueError:   # 29 February
        return today.replace(year=today.year - years, day=28)


def _filter(kind: str, db: Session):
    today, adult, ancient = date.today(), _years_ago(18), _years_ago(110)
    pg = db.get_bind().dialect.name == "postgresql"
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
    if kind == "bad_email":
        email = func.trim(Member.email)
        # PostgreSQL: the usual shape name@domain.tld; SQLite (tests): an @ with something on both sides and a dot after it
        shaped = email.op("~*")(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$") if pg else and_(email.like("%_@_%._%"), ~email.contains(" "))
        return and_(Member.email.isnot(None), email != "", ~shaped)
    if kind == "no_place":
        return or_(Member.pincode_id.is_(None), Member.district_id.is_(None))
    if kind == "print_no_address":
        blank = lambda col: or_(col.is_(None), func.trim(col) == "")  # noqa: E731
        return and_(Member.magazine_needed == True, Member.magazine_kind == "PHYSICAL", blank(Member.address_line1), blank(Member.magazine_delivery_address))  # noqa: E712
    if kind == "odd_name":
        # anything but letters, spaces, dots, apostrophes and hyphens
        return Member.full_name_en.op("~")(r"[^A-Za-z .'-]") if pg else Member.full_name_en.op("GLOB")("*[^A-Za-z .'-]*")
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
        "email": m.email, "missing": [w for w, empty in (("Pincode", m.pincode_id is None), ("District", m.district_id is None)) if empty],
        "approval": m.approval_status, "status": m.member_status,
    }


def find(db: Session, kind: str, search: Optional[str] = None, page: int = 1, limit: int = 25, everything: bool = False) -> dict:
    cond = _filter(kind, db)
    q = db.query(Member, District.name_en).outerjoin(District, District.id == Member.district_id).filter(Member.is_deleted == False, cond)  # noqa: E712
    wanted = (search or "").strip()
    if wanted:
        like = f"%{wanted}%"
        q = q.filter(or_(Member.full_name_en.ilike(like), Member.first_name_en.ilike(like), Member.last_name_en.ilike(like), Member.mobile.ilike(like),
                         Member.membership_number.ilike(like), Member.old_membership_number.ilike(like)))
    total = q.count()
    # the most wrong first: a date of birth furthest from today, then by name
    if kind in ("future_dob", "under_18"):
        order = Member.date_of_birth.desc()
    elif kind == "very_old":
        order = Member.date_of_birth.asc()
    else:
        order = Member.id.asc()
    q = q.order_by(order, Member.id)
    rows = q.all() if everything else q.offset((max(1, page) - 1) * limit).limit(limit).all()
    return {"rows": [_row(m, d) for m, d in rows], "total": total}


def rows_xlsx(kind: str, rows: list) -> bytes:
    from openpyxl import Workbook

    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Data check")
    ws.append(["Problem", "Name", "Membership no", "Old no", "Mobile", "Alternate number", "Email", "Date of birth", "Age", "District", "Missing", "Approval", "Status"])
    for r in rows:
        ws.append([KINDS[kind], r["name"], r["membership_no"], r["old_no"], r["mobile"], r["alternate_mobile"], r["email"], r["dob"], r["age"], r["district"], ", ".join(r["missing"]), r["approval"], r["status"]])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
