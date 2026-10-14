"""Receipt numbers: ``2026-27/0001``, one series per financial year (1 April - 31 March)."""

import re
from datetime import date

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models.receipts import Receipt


def financial_year_for(d: date) -> str:
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def duplicate_message(number: str, fy: str, in_bin: bool = False) -> str:
    if in_bin:
        return (
            f'Receipt number "{number}" belongs to a deleted receipt in the Recycle Bin (financial year {fy}). '
            "Restore that receipt, or delete it permanently from the Recycle Bin, before using this number."
        )
    return (
        f'Receipt number "{number}" already exists in financial year {fy}. '
        "Use a different number, or change the receipt date to another financial year."
    )


def _free_check(db: Session, fy: str):
    def exists(number: str) -> bool:
        # a receipt in the Recycle Bin still holds its number until it is deleted permanently
        return db.query(Receipt.id).filter(Receipt.financial_year == fy, Receipt.receipt_number == number).first() is not None
    return exists


def next_receipt_number(db: Session, on: date, *, consume: bool = True) -> str:
    """Next number in the configured receipt format (Settings > Number Formats) for a receipt dated ``on``.
    consume=False only shows it (Receipt Entry's pre-filled number); consume=True uses it up."""
    from services import numbering

    exists = _free_check(db, financial_year_for(on))
    if consume:
        return numbering.next_number(db, "RECEIPT", on, exists=exists)
    return numbering.peek_number(db, "RECEIPT", on, exists=exists)


def assert_number_free(db: Session, fy: str, number: str, exclude_id: int | None = None) -> None:
    q = db.query(Receipt.id, Receipt.is_deleted).filter(Receipt.financial_year == fy, Receipt.receipt_number == number)
    if exclude_id is not None:
        q = q.filter(Receipt.id != exclude_id)
    found = q.order_by(Receipt.is_deleted).first()  # a live one is reported before a deleted one
    if found:
        raise HTTPException(409, duplicate_message(number, fy, in_bin=bool(found[1])))


def default_entry_date(db: Session) -> date:
    """The date Receipt Entry opens on: today. (Save & New keeps the date just used, so a pile of old receipts
    can still be entered one after another; a fresh open or Reset always starts on today.)"""
    return date.today()
