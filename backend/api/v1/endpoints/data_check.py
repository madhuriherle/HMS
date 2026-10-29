from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from api import deps
from models.users import User
from services import data_check

router = APIRouter()


@router.get("/members")
def members_with_wrong_data(
    kind: str = "future_dob",       # future_dob | under_18 | very_old | alt_number | bad_email | no_place | print_no_address | no_mobile | no_address | no_dob
    search: Optional[str] = None,   # a name, mobile or membership number
    page: int = 1, limit: int = 25,
    export: Optional[str] = None,   # "excel": every row of the list
    verification: Optional[str] = None,   # verified | not_verified: by the member's KYC call
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.require_permission("members.list.read")),
) -> Any:
    """Members whose stored data looks wrong (a date of birth in the future, under 18, over 110, an alternate number that is not 10 to 12
    digits). At most 200 rows a page; nothing is changed, the office corrects the member on the Edit screen."""
    from core.pagination import LIST_PAGE_MAX

    kind = (kind or "").lower()
    page, limit = max(1, page), max(1, min(limit, LIST_PAGE_MAX))
    try:
        out = data_check.find(db, kind, search, page, limit, everything=bool(export), verification=verification if verification in ("verified", "not_verified") else None)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if export:
        return Response(
            content=data_check.rows_xlsx(kind, out["rows"]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=members_{kind}.xlsx"},
        )
    return {"rows": out["rows"], "total": out["total"], "page": page, "limit": limit, "pages": max(1, -(-out["total"] // limit)),
            "problem": data_check.KINDS[kind]}
