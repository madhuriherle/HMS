"""Receipt numbers: ``2026-27/0001``, one series per financial year (1 April - 31 March)."""

import re
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.receipts import Receipt


def financial_year_for(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def duplicate_message(number: str, fy: str) -> str:
    return (
        f'Receipt number "{number}" already exists in financial year {fy}. '
        "Use a different number, or change the receipt date to another financial year."
    )


def next_receipt_number(db: Session, fy: str) -> str:
    """Highest ``<fy>/NNNN`` in the year + 1. Numbers typed in another shape are ignored."""
    pattern = re.compile(rf"^{re.escape(fy)}/(\d+)$")
    highest = 0
    rows = db.query(Receipt.receipt_number).filter(
        Receipt.financial_year == fy, Receipt.is_deleted == False  # noqa: E712
    )
    for (number,) in rows:
        m = pattern.match(number or "")
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{fy}/{highest + 1:04d}"


def assert_number_free(db: Session, fy: str, number: str, exclude_id: int | None = None) -> None:
    q = db.query(Receipt.id).filter(
        Receipt.financial_year == fy,
        Receipt.receipt_number == number,
        Receipt.is_deleted == False,  # noqa: E712
    )
    if exclude_id is not None:
        q = q.filter(Receipt.id != exclude_id)
    if q.first():
        raise HTTPException(409, duplicate_message(number, fy))


def default_entry_date(db: Session) -> date:
    """Date of the receipt entered last, or today when there is none."""
    last = (
        db.query(Receipt.receipt_date)
        .filter(Receipt.is_deleted == False)  # noqa: E712
        .order_by(Receipt.id.desc())
        .first()
    )
    return last[0] if last else date.today()
