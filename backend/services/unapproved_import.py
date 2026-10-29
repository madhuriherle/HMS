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

# The file the import reads: the MstApplication register, one applicant per row, headings in row 1. Only these columns are used
# (any others in the register are ignored). (heading, meaning, required)
FORMAT_GROUPS = [
    ("Applicant", [
        ("CusNo", "Application number. Kept as the application reference; the membership number stays blank until approval", True),
        ("CusNoOld", "Used as the application number when CusNo is 0", False),
        ("CusTitle", "SRI. / SMT. / KUM. / DR. ... The gender is taken from this (SRI male, SMT. and KUM. female, others blank)", False),
        ("CusName", "Full name, kept whole", True),
        ("CusNameKannada", "Name in Kannada", False),
        ("CusDoB", "Date of birth", False),
        ("CusBloodGroup", "Blood group, for example O+VE", False),
        ("CusGotra", "Gotra", False),
        ("CusRelation", "S (son of), W (wife of), D (daughter of) or G (guardian)", False),
        ("CusNameFather", "Name of the father, husband or guardian (the relation above says which)", False),
        ("CusDesignation", "Occupation / designation", False),
    ]),
    ("Contact", [
        ("CusMobile", "Mobile number", False),
        ("CusPhone", "Alternate or landline number", False),
        ("CusEmail", "Email address", False),
    ]),
    ("Address", [
        ("CusAddress", "Address lines", False),
        ("CusPinCode", "6-digit pincode. The state, district and taluk come from our pincode data, not from the file", False),
        ("CusPost", "Post office", False),
        ("CusCity", "City or town", False),
        ("CusArea", "Area", False),
        ("CusPlace", "Place or village", False),
        ("CusState", "State (only used when the pincode is not found)", False),
        ("CusLabelPoint", "Label point for the magazine", False),
        ("CusAddressNative", "Native address", False),
    ]),
    ("Membership", [
        ("CusMemberType", "POSHAKA, AJEEVA, MAHAPOSHAKA or MAHAPALAKA", False),
        ("CusMagazine", "Yes / No", False),
        ("CusOnline", "Online / Print", False),
    ]),
    ("Receipts (up to 6 per applicant; repeat for 1 to 6)", [
        ("CusReceiptNo1", "Receipt number; a number already used is saved with /2, /3 ...", False),
        ("CusReceiptDate1", "Receipt date", False),
        ("CusMemAmt1", "Membership amount", False),
        ("CusMemUpAmt1", "Upgrade amount (Patrika Nidhi)", False),
        ("CusScholarAmt1", "Scholarship amount", False),
        ("CusReceiptNote1", "Note on the receipt", False),
    ]),
]


def template_xlsx() -> bytes:
    """A blank file with the headings the import reads (nothing in it would be imported), and a second sheet that explains each
    column with one example applicant."""
    from openpyxl import Workbook

    heads = []
    for _, cols in FORMAT_GROUPS:
        for name, _m, _r in cols:
            if name.endswith("1"):
                heads.extend(name[:-1] + str(n) for n in range(1, 7))
            else:
                heads.append(name)
    example = {
        "CusNo": 16892, "CusTitle": "SRI.", "CusName": "SUDHINDRA NADIGAR .R", "CusDoB": "1983-08-29", "CusBloodGroup": "O+VE", "CusGotra": "VASHISHTA",
        "CusRelation": "G", "CusNameFather": "Ramakrishna Nadigar", "CusMobile": "9980899909", "CusAddress": "534, 9TH CROSS, NAGASANDRA", "CusPinCode": "560073",
        "CusPost": "NAGASANDRA", "CusCity": "BANGALORE", "CusMemberType": "POSHAKA", "CusMagazine": "No", "CusOnline": "Online",
        "CusReceiptNo1": 1045, "CusReceiptDate1": "2026-03-20", "CusMemAmt1": 1000, "CusMemUpAmt1": 0, "CusScholarAmt1": 0,
    }
    wb = Workbook()
    ws = wb.active
    ws.title = "MstApplication"
    ws.append(heads)                    # the sheet the import reads: headings only
    notes = wb.create_sheet("Format")
    notes.append(["Heading", "Required", "What it holds", "Example"])
    for group, cols in FORMAT_GROUPS:
        notes.append([group])
        for name, meaning, required in cols:
            notes.append([name, "Yes" if required else "", meaning, example.get(name, "")])
    notes.append([])
    notes.append(["Fill the first sheet (MstApplication) from row 2, one applicant per row. This sheet is only an explanation."])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
