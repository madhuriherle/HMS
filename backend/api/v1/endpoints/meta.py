import json
import urllib.request
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from api import deps
from core import rules
from models.users import User

router = APIRouter()


@router.get("/rules")
def read_rules(current_user: User = Depends(deps.get_current_user)) -> Any:
    """The data rules the server enforces (formats, limits, fixed lists), for the screens to use."""
    return rules.as_dict()


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
