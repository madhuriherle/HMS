"""Configurable numbers: member code, membership number, receipt number.

A format is  PREFIX + sep + DATE + sep + COUNTER + SUFFIX  (empty parts and their separator are left out).
The counter lives in number_sequences, one row per restart period (``RECEIPT:2026-27``); a format that
never restarts uses the plain row (``MEMBER_CODE``) so existing counters carry on.
Changing a format only affects numbers made afterwards.
"""

import re
from dataclasses import dataclass
from datetime import date
from typing import Callable, Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.system import NumberFormat, NumberSequence

DOC_LABELS = {
    "MEMBER_CODE": "Membership number",  # the one permanent number a member gets at approval
    "RECEIPT": "Receipt number",
}

DATE_PARTS = {  # value -> label
    "NONE": "None",
    "FY": "Financial year (2026-27)",
    "FY_SHORT": "Financial year, short (26-27)",
    "YEAR": "Calendar year (2026)",
    "YEAR_MONTH": "Year and month (202610)",
    "DATE_FULL": "Full date (20261012)",
    "DATE_DMY": "Day-month-year (12102026)",
}
RESTARTS = {
    "NEVER": "Never",
    "FY": "Every financial year (April)",
    "YEAR": "Every calendar year",
    "MONTH": "Every month",
    "DAY": "Every day",
}
SEPARATORS = ["", "-", "/", "."]

# The date in the number must change whenever the counter restarts, or two numbers could repeat.
ALLOWED_DATE_PARTS = {
    "NEVER": set(DATE_PARTS),
    "FY": {"FY", "FY_SHORT"},
    "YEAR": {"YEAR", "YEAR_MONTH", "DATE_FULL", "DATE_DMY"},
    "MONTH": {"YEAR_MONTH", "DATE_FULL", "DATE_DMY"},
    "DAY": {"DATE_FULL", "DATE_DMY"},
}

TEXT_RE = re.compile(r"^[A-Za-z0-9/._-]{0,12}$")


@dataclass
class Fmt:
    doc_type: str
    prefix: str = ""
    date_part: str = "NONE"
    separator: str = "-"
    digits: int = 6
    start_value: int = 1
    restart: str = "NEVER"
    suffix: str = ""
    allow_manual: bool = True


DEFAULTS = {  # what the system produced before formats were configurable
    "MEMBER_CODE": Fmt("MEMBER_CODE", "HMS", "DATE_FULL", "-", 6, 1, "NEVER", "", True),
    "MEMBERSHIP_NO": Fmt("MEMBERSHIP_NO", "HMSM", "DATE_FULL", "-", 6, 1, "NEVER", "", True),
    "RECEIPT": Fmt("RECEIPT", "", "FY", "/", 4, 1, "FY", "", True),
}


def financial_year_for(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def _date_text(part: str, d: date) -> str:
    if part == "FY":
        return financial_year_for(d)
    if part == "FY_SHORT":
        fy = financial_year_for(d)
        return f"{fy[2:4]}-{fy[5:]}"
    return {
        "NONE": "",
        "YEAR": f"{d.year}",
        "YEAR_MONTH": d.strftime("%Y%m"),
        "DATE_FULL": d.strftime("%Y%m%d"),
        "DATE_DMY": d.strftime("%d%m%Y"),
    }[part]


def scope_key(restart: str, d: date) -> str:
    return {
        "NEVER": "",
        "FY": financial_year_for(d),
        "YEAR": f"{d.year}",
        "MONTH": d.strftime("%Y%m"),
        "DAY": d.strftime("%Y%m%d"),
    }[restart]


def render(f: Fmt, d: date, n: int) -> str:
    sep = f.separator or ""
    head = [p for p in (f.prefix, _date_text(f.date_part, d)) if p]
    return sep.join(head + [str(n).zfill(f.digits)]) + (f.suffix or "")


def _regex(f: Fmt, d: date) -> "re.Pattern[str]":
    """Matches numbers made with this format for the date's period; group 1 is the counter."""
    sep = f.separator or ""
    head = [p for p in (f.prefix, _date_text(f.date_part, d)) if p]
    pattern = re.escape(sep).join([re.escape(p) for p in head] + [r"(\d+)"]) + re.escape(f.suffix or "")
    return re.compile(f"^{pattern}$")


def validate(f: Fmt) -> None:
    if f.doc_type not in DOC_LABELS:
        raise HTTPException(404, "Unknown number type")
    if f.date_part not in DATE_PARTS:
        raise HTTPException(400, "Unknown date part")
    if f.restart not in RESTARTS:
        raise HTTPException(400, "Unknown restart rule")
    if f.separator not in SEPARATORS:
        raise HTTPException(400, "Separator must be -, /, . or none")
    if not (3 <= f.digits <= 8):
        raise HTTPException(400, "Digits must be between 3 and 8")
    if f.start_value < 1 or f.start_value >= 10 ** f.digits:
        raise HTTPException(400, "Start value must be 1 or more and fit in the digits")
    for label, text in (("Prefix", f.prefix), ("Suffix", f.suffix)):
        if not TEXT_RE.match(text or ""):
            raise HTTPException(400, f"{label} may only have letters, digits and / . _ - (up to 12)")
    if f.date_part not in ALLOWED_DATE_PARTS[f.restart]:
        allowed = ", ".join(DATE_PARTS[p] for p in DATE_PARTS if p in ALLOWED_DATE_PARTS[f.restart])
        raise HTTPException(
            400,
            "With this restart rule the date in the number must change too, otherwise numbers could repeat. "
            f"Allowed dates: {allowed}.",
        )


def get_format(db: Session, doc_type: str) -> Fmt:
    base = DEFAULTS[doc_type]
    row = db.query(NumberFormat).filter(NumberFormat.doc_type == doc_type, NumberFormat.is_deleted == False).first()  # noqa: E712
    if not row:
        return Fmt(**base.__dict__)
    return Fmt(
        doc_type, row.prefix or "", row.date_part, row.separator or "", int(row.digits), int(row.start_value),
        row.restart, row.suffix or "", bool(row.allow_manual),
    )


def save_format(db: Session, f: Fmt, user_id: int) -> Fmt:
    validate(f)
    row = db.query(NumberFormat).filter(NumberFormat.doc_type == f.doc_type).first()
    if not row:
        row = NumberFormat(doc_type=f.doc_type, created_by=user_id)
        db.add(row)
    row.is_deleted = False
    row.prefix, row.date_part, row.separator = f.prefix or None, f.date_part, f.separator
    row.digits, row.start_value, row.restart = f.digits, f.start_value, f.restart
    row.suffix, row.allow_manual = f.suffix or None, f.allow_manual
    row.updated_by = user_id
    db.commit()
    return get_format(db, f.doc_type)


# ── counters ────────────────────────────────────────────────────────────
def _sequence_name(f: Fmt, d: date) -> str:
    key = scope_key(f.restart, d)
    return f"{f.doc_type}:{key}" if key else f.doc_type


def _legacy_highest(db: Session, f: Fmt, d: date) -> int:
    """Highest number already issued in this period (receipts keep their own numbers; others start fresh)."""
    if f.doc_type != "RECEIPT":
        return 0
    from models.receipts import Receipt

    rx = _regex(f, d)
    q = db.query(Receipt.receipt_number).filter(Receipt.is_deleted == False)  # noqa: E712
    if f.restart == "FY":
        q = q.filter(Receipt.financial_year == financial_year_for(d))
    highest = 0
    for (number,) in q:
        m = rx.match(number or "")
        if m:
            highest = max(highest, int(m.group(1)))
    return highest


def _locked_sequence(db: Session, name: str, seed: Callable[[], int]) -> NumberSequence:
    def _row():
        return (
            db.query(NumberSequence)
            .filter(NumberSequence.sequence_type == name, NumberSequence.is_deleted == False)  # noqa: E712
            .with_for_update()
            .first()
        )

    seq = _row()
    if not seq:
        seq = NumberSequence(sequence_type=name, prefix=name.split(":")[0][:20], current_value=seed())
        try:
            with db.begin_nested():
                db.add(seq)
                db.flush()
        except IntegrityError:
            db.expire(seq)
            seq = _row()
            if not seq:
                raise
    return seq


def _issue(db: Session, doc_type: str, on: date, exists: Optional[Callable[[str], bool]], consume: bool) -> str:
    f = get_format(db, doc_type)
    seq = _locked_sequence(db, _sequence_name(f, on), lambda: _legacy_highest(db, f, on))
    value = max(int(seq.current_value or 0), f.start_value - 1)
    for _ in range(2000):
        value += 1
        number = render(f, on, value)
        if not exists or not exists(number):
            break
    else:
        raise HTTPException(409, "Could not find a free number; check the number format")
    if consume:
        seq.current_value = value
    return number


def next_number(db: Session, doc_type: str, on: Optional[date] = None, *, exists=None, commit: bool = False) -> str:
    """Take the next number (uses it up). The caller's transaction commits it unless commit=True."""
    number = _issue(db, doc_type, on or date.today(), exists, consume=True)
    if commit:
        db.commit()
    else:
        db.flush()
    return number


def peek_number(db: Session, doc_type: str, on: Optional[date] = None, *, exists=None) -> str:
    """The number that would be issued now, without using it up."""
    number = _issue(db, doc_type, on or date.today(), exists, consume=False)
    db.rollback()  # release the row lock taken while reading
    return number


def note_used(db: Session, doc_type: str, number: str, on: date) -> None:
    """A number typed by hand in this format moves the counter past it, so it is never offered again."""
    f = get_format(db, doc_type)
    m = _regex(f, on).match(number or "")
    if not m:
        return
    seq = _locked_sequence(db, _sequence_name(f, on), lambda: _legacy_highest(db, f, on))
    if int(m.group(1)) > int(seq.current_value or 0):
        seq.current_value = int(m.group(1))
        db.flush()
