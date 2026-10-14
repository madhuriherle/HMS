"""Shared KYC request creation + message builders.

The KYC flow exists in two channels:
  * LINK  — member without the mobile app gets a secure WhatsApp link
  * APP   — member with the app gets a WhatsApp nudge to open the KYC screen

Both create a MemberKycRequest row for tracking; only the SHA-256 of the
token is stored so a database leak cannot forge links.
"""

import hashlib
import os
import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from models.members import Member, MemberKycRequest

# The mobile app's KYC screen; the DEFAULT, unused once KYC_WEB_BASE_URL is set.
KYC_BASE_URL = "https://hms-mma.app/kyc"


def kyc_link_url(token: str) -> str:
    """The URL the LINK channel sends to members without the app: the web
    panel's KYC form when configured, else the app screen."""
    base = os.environ.get("KYC_WEB_BASE_URL") or KYC_BASE_URL
    return f"{base}?token={token}"


def create_kyc_request(
    db: Session, member: Member, created_by: Optional[int] = None
) -> Tuple[MemberKycRequest, str]:
    """Create the tracking row; returns (row, raw_token)."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    kyc = MemberKycRequest(
        member_id=member.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        sent_to=member.mobile,
        sent_at=now,
        expires_at=now.replace(hour=23, minute=59, second=0, microsecond=0),
        status="SENT",
        created_by=created_by,
    )
    db.add(kyc)
    db.commit()
    return kyc, token


def link_message(member: Member, token: str) -> str:
    return (
        f"Dear {member.first_name_en}, please update your KYC details using "
        f"this link (valid today): {kyc_link_url(token)}"
    )


def app_message(member: Member) -> str:
    return (
        f"Dear {member.first_name_en}, please update your KYC details in the "
        f"HMS MMA app: Profile → KYC Update."
    )
