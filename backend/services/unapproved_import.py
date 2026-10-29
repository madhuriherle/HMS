"""Import unapproved applications from MstApplication.xlsx.

Creates UNAPPROVED members (no membership_number) with receipts attached so they appear
in the Unapproved queue with receipts assigned. CusNo is stored as legacy_ref_number
(application reference). CusNoNew is ignored. If CusNo is 0, use CusNoOld as legacy_ref_number.
"""

import io
import re
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime
from typing import Any, Optional

_PATRIKA = re.compile(r"patrika|\bp\.?\s*nidhi\b", re.I)
_KANNADA = re.compile("[\u0C80-\u0CFF]")
FIRST_YEAR = 1943
SLOTS = range(1, 7)
TYPE_FIXES = {"POSHAK": "POSHAKA", "AJEEV": "AJEEVA", "A": "AJEEVA"}
SAMPLE = 25
SOURCE = "UNAPPROVED_IMPORT"


def _s(v) -> str:
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def _num(v) -> float:
    try:
        return float(v) if v not in (None, "", " ") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _as_date(v) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    return v if isinstance(v, date) else None


def financial_year_start(d: date) -> int:
    return d.year if d.month >= 4 else d.year - 1


def read_register(content: bytes) -> list:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [_s(h) for h in next(it)]
    except Exception as exc:
        raise ValueError(f"Could not read the Excel file: {str(exc)[:160]}")
    if "CusNameKannada" not in header:
        header = ["CusNameKannada" if _KANNADA.search(h) else h for h in header]
    if "CusName" not in header:
        raise ValueError("This is not the application register: the column CusName is missing")
    return [dict(zip(header, row)) for row in it if any(c not in (None, "") for c in row)]


_SAME_WORDS = re.compile(r"\b(above|same|ditto|abv)\b", re.I)


def _lines(v) -> list:
    if v is None:
        return []
    text = str(v).replace("\r\n", "\n").replace("\r", "\n")
    return [l.strip() for l in text.split("\n") if l.strip()]


def preview(db, content: bytes) -> dict:
    """Judge the applications register exactly as the import would, without saving anything."""
    from services import legacy_import

    plan = legacy_import.build_plan(db, read_register(content))
    return {"counts": plan["counts"], "samples": legacy_import.summary_json(plan)["samples"]}


def run(db, content: bytes, user_id: int, file_name: str = "") -> dict:
    """Create the applicants as UNAPPROVED members (CusNo kept as the application number), then link their receipts."""
    from services import legacy_import

    rows = read_register(content)
    members = legacy_import.import_members(db, rows, user_id, run_id=uuid.uuid4().hex, file_name=file_name, applicants=True)
    receipts = legacy_import.import_receipts(db, rows, user_id, applicants=True)
    return {
        "created": members["created"],
        "skipped": members["skipped"],
        "receipts": {"created": receipts["created"], "skipped": receipts["skipped"]},
        "skipped_list": members["skipped_list"],
    }
