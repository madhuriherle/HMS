"""Public KYC update flow — authenticated by the token in the sent link.

GET  /api/v1/kyc/{token}  → member's current basic details + editable fields
POST /api/v1/kyc/{token}  → submits changes as a profile-change request that
                            still requires admin approval before applying.
Only the SHA-256 of the token is stored, so a database leak cannot be used to
forge links.
"""

import hashlib
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from api import deps
from models.members import Member, MemberKycRequest, MemberProfileChangeRequest
from schemas.members import EDITABLE_MEMBER_FIELDS

router = APIRouter()


class KycUpdate(BaseModel):
    values: dict

    @field_validator("values")
    @classmethod
    def _restrict_fields(cls, values: dict) -> dict:
        unknown = sorted(set(values) - EDITABLE_MEMBER_FIELDS)
        if unknown:
            raise ValueError(f"Fields not allowed: {', '.join(unknown)}")
        if not values:
            raise ValueError("values must contain at least one field")
        return values


def _resolve_request(db: Session, token: str) -> MemberKycRequest:
    digest = hashlib.sha256(token.encode()).hexdigest()
    row = db.query(MemberKycRequest).filter(
        MemberKycRequest.token_hash == digest,
        MemberKycRequest.is_deleted == False,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Invalid or unknown KYC link")

    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="KYC link has expired")
    if row.status in ("SUBMITTED", "REJECTED"):
        raise HTTPException(status_code=400, detail="KYC link has already been used")
    return row


@router.get("/{token}")
def kyc_preview(*, db: Session = Depends(deps.get_db), token: str) -> Any:
    """What the member sees when they open the link."""
    row = _resolve_request(db, token)
    member = db.get(Member, row.member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    return {
        "member": {
            "id": member.id,
            "first_name_en": member.first_name_en,
            "last_name_en": member.last_name_en,
            "mobile": member.mobile,
            "email": member.email,
            "address_line1": member.address_line1,
            "address_line2": member.address_line2,
            "locality": member.locality,
            "state_id": member.state_id,
            "district_id": member.district_id,
            "taluk_id": member.taluk_id,
            "pincode_id": member.pincode_id,
        },
        "expires_at": row.expires_at,
        "editable_fields": sorted(EDITABLE_MEMBER_FIELDS),
    }


@router.post("/{token}")
def kyc_submit(
    *, db: Session = Depends(deps.get_db), token: str, payload: KycUpdate
) -> Any:
    """Submit updated details — stored as a request, applied after approval."""
    row = _resolve_request(db, token)

    request_row = MemberProfileChangeRequest(
        member_id=row.member_id,
        requested_by=None,
        source="KYC",
        new_values=payload.values,
        status="PENDING",
        created_by=None,
    )
    db.add(request_row)
    row.status = "SUBMITTED"
    row.submitted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(request_row)
    return {
        "message": "Details submitted and queued for admin approval",
        "request_id": request_row.id,
    }
