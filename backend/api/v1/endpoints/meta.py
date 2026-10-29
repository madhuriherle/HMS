import json
import urllib.request
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from sqlalchemy.orm import Session

from api import deps
from core import rules
from models.users import User

router = APIRouter()


@router.get("/rules")
def read_rules(db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)) -> Any:
    """The data rules the server enforces (formats, limits, fixed lists), for the screens to use."""
    from models.masters import NameTitle

    out = rules.as_dict()
    titles = [t for (t,) in db.query(NameTitle.name_en).filter(NameTitle.is_deleted == False, NameTitle.status == True).order_by(NameTitle.id).all()]  # noqa: E712
    if titles:   # the Name Titles master; the built-in list only until it has rows
        out["name_titles"] = titles
    return out


@router.get("/lists")
def read_lists(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """The fixed lists the screens show (from the lookup_values table): {list_code: [{code, label, extra}]}."""
    from models.masters import LookupValue

    out: dict = {}
    for row in (
        db.query(LookupValue)
        .filter(LookupValue.is_deleted == False, LookupValue.status == True)  # noqa: E712
        .order_by(LookupValue.list_code, LookupValue.sort_order, LookupValue.id)
        .all()
    ):
        out.setdefault(row.list_code, []).append({"code": row.code, "label": row.label, "extra": row.extra})
    return out


@router.get("/pin-prefixes")
def read_pin_prefixes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
) -> Any:
    """The first two digits of the PIN codes in the master (for the PIN filter), with how many codes each has."""
    from sqlalchemy import func
    from models.masters import PostalCode

    prefix = func.substr(PostalCode.pincode, 1, 2)
    rows = (
        db.query(prefix, func.count(PostalCode.id))
        .filter(PostalCode.is_deleted == False)  # noqa: E712
        .group_by(prefix).order_by(prefix).all()
    )
    return [{"prefix": p, "count": c} for p, c in rows]


def _fetch_pincode(pin: str) -> Any:
    """The public postal service; called from the server so the browser never depends on it."""
    request = urllib.request.Request(f"https://api.postalpincode.in/pincode/{pin}", headers={"User-Agent": "hms-panel"})
    with urllib.request.urlopen(request, timeout=6) as response:  # noqa: S310 - fixed https URL
        return json.loads(response.read().decode("utf-8"))


@router.get("/pincode/{pin}")
def lookup_pincode(pin: str, current_user: User = Depends(deps.get_current_user)) -> Any:
    """Area / taluk / district / state for a PIN code from the public postal service (found=false if unknown or the
    service is unreachable). The PIN master is checked by the screens first."""
    if not (pin.isdigit() and len(pin) == rules.PINCODE_DIGITS):
        raise HTTPException(400, f"PIN code must be {rules.PINCODE_DIGITS} digits")
    try:
        data = _fetch_pincode(pin)
        office = data[0]["PostOffice"][0] if data and data[0].get("Status") == "Success" else None
    except Exception:  # unreachable, slow or an unexpected answer: the screen just continues without it
        office = None
    if not office:
        return {"found": False}
    return {
        "found": True,
        "area": office.get("Name") or "",
        "taluk": office.get("Block") or "",
        "district": office.get("District") or "",
        "state": office.get("State") or "",
    }


# Column headings of the files the office uploads. The templates carry the headings only (no made-up people or
# places), so a template uploaded unedited can never import anything.
IMPORT_TEMPLATES = {
    "members": (
        "members_import_template.csv",
        ["membership_number", "member_name", "gotra", "mobile", "gender", "date_of_birth", "email", "address_line1",
         "address_line2", "locality", "city", "pincode", "membership_type", "remarks"],
    ),
    "postal-codes": (
        "location_postal_codes_template.csv",
        ["pin_code", "post_office_name", "taluk_name", "district_name", "state_name"],
    ),
}


# What each column of the members CSV holds (shown on the import screen). (heading, meaning, required)
IMPORT_FORMATS = {
    "members": [
        ("membership_number", "The member's membership number. A number already in the system is skipped (or stops the import, as chosen)", True),
        ("member_name", "Full name, kept whole", True),
        ("gotra", "Gotra", False),
        ("mobile", "10-digit mobile. +91 and spaces are dropped; a landline or any other length is left blank with a warning", False),
        ("gender", "MALE, FEMALE or OTHER", False),
        ("date_of_birth", "Date of birth (YYYY-MM-DD or DD-MM-YYYY)", False),
        ("email", "Email address", False),
        ("address_line1", "First address line", False),
        ("address_line2", "Second address line", False),
        ("locality", "Locality / area", False),
        ("city", "City or town", False),
        ("pincode", "6-digit pincode; the state, district and taluk come from our pincode data", False),
        ("membership_type", "The membership type, as named in Membership Types", False),
        ("remarks", "Any note", False),
    ],
}


@router.get("/import-format/{kind}")
def import_format(kind: str, current_user: User = Depends(deps.get_current_user)) -> Any:
    """The columns an upload screen reads and what each holds (the screen shows them beside its template)."""
    if kind not in IMPORT_FORMATS:
        raise HTTPException(status_code=404, detail="Unknown format")
    return {"groups": [{"group": "Columns", "columns": [{"name": n, "meaning": m, "required": r} for n, m, r in IMPORT_FORMATS[kind]]}]}


@router.get("/import-template/{kind}")
def import_template(kind: str, current_user: User = Depends(deps.get_current_user)) -> Any:
    """Header-only CSV template for an upload screen (members, postal-codes)."""
    if kind not in IMPORT_TEMPLATES:
        raise HTTPException(status_code=404, detail="Unknown template")
    filename, headers = IMPORT_TEMPLATES[kind]
    return Response(
        content=",".join(headers) + "\n",
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
