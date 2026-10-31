"""Data integrity checks across receipts, allocations, members, memberships, subscriptions and users.

Usage:
    python scripts/check_data_integrity.py [DATABASE_URL]
"""

import os
import sys
from collections import defaultdict
from decimal import Decimal
from typing import Any, Dict, List

# Add parent directory to path so imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session, sessionmaker

from core.config import settings
from models.magazines import MagazineSubscription
from models.members import Member, MemberMembership
from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
from models.users import User
from services.receipt_numbers import financial_year_for


def _d(val) -> Decimal:
    return Decimal(str(val or 0)).quantize(Decimal("0.01"))


def check_receipt_allocations_orphans(db: Session) -> List[Dict[str, Any]]:
    """1. Receipt allocations pointing at a deleted or missing receipt, member or membership."""
    issues = []
    allocs = db.query(ReceiptAllocation).filter(ReceiptAllocation.is_deleted == False).all()  # noqa: E712
    for a in allocs:
        # Check receipt
        r = db.query(Receipt.id, Receipt.is_deleted).filter(Receipt.id == a.receipt_id).first()
        if not r:
            issues.append({"id": a.id, "reason": f"receipt_id {a.receipt_id} does not exist"})
            continue
        if r.is_deleted:
            issues.append({"id": a.id, "reason": f"receipt_id {a.receipt_id} is deleted"})
            continue

        # Check member
        if a.member_id is not None:
            m = db.query(Member.id, Member.is_deleted).filter(Member.id == a.member_id).first()
            if not m:
                issues.append({"id": a.id, "reason": f"member_id {a.member_id} does not exist"})
                continue
            if m.is_deleted:
                issues.append({"id": a.id, "reason": f"member_id {a.member_id} is deleted"})
                continue

        # Check membership
        if a.membership_id is not None:
            mm = db.query(MemberMembership.id, MemberMembership.is_deleted).filter(MemberMembership.id == a.membership_id).first()
            if not mm:
                issues.append({"id": a.id, "reason": f"membership_id {a.membership_id} does not exist"})
                continue
            if mm.is_deleted:
                issues.append({"id": a.id, "reason": f"membership_id {a.membership_id} is deleted"})
                continue
    return issues


def check_receipt_status_mapping(db: Session) -> List[Dict[str, Any]]:
    """2. Receipts marked Assigned with no member link, or Unassigned but holding one."""
    issues = []
    receipts = db.query(Receipt).filter(Receipt.is_deleted == False).all()  # noqa: E712
    for r in receipts:
        alloc = db.query(ReceiptAllocation.id).filter(
            ReceiptAllocation.receipt_id == r.id,
            ReceiptAllocation.is_deleted == False,  # noqa: E712
            ReceiptAllocation.member_id != None,  # noqa: E711
        ).first()

        has_member_link = alloc is not None
        if r.receipt_status == "ASSIGNED" and not has_member_link:
            issues.append({"id": r.id, "receipt_number": r.receipt_number, "reason": "Marked ASSIGNED but has no active member allocation"})
        elif r.receipt_status == "UNASSIGNED" and has_member_link:
            issues.append({"id": r.id, "receipt_number": r.receipt_number, "reason": "Marked UNASSIGNED but has an active member allocation"})
    return issues


def check_receipt_items_and_amounts(db: Session) -> List[Dict[str, Any]]:
    """3. Receipts with no line, or whose amount differs from their lines."""
    issues = []
    # Cancelled receipts are voided / zeroed paper records; check non-cancelled active receipts
    receipts = db.query(Receipt).filter(
        Receipt.is_deleted == False,  # noqa: E712
        Receipt.receipt_status != "CANCELLED",
    ).all()

    for r in receipts:
        items = db.query(ReceiptItem).filter(
            ReceiptItem.receipt_id == r.id,
            ReceiptItem.is_deleted == False,  # noqa: E712
        ).all()

        if not items:
            issues.append({"id": r.id, "receipt_number": r.receipt_number, "reason": "Receipt has no active lines"})
            continue

        lines_sum = sum((_d(i.amount) for i in items), Decimal("0.00"))
        net = _d(r.net_amount)
        if lines_sum != net:
            issues.append({
                "id": r.id,
                "receipt_number": r.receipt_number,
                "reason": f"net_amount ({net}) != sum of lines ({lines_sum})",
            })
    return issues


def check_financial_year_match(db: Session) -> List[Dict[str, Any]]:
    """4. A financial year that doesn't match the receipt date."""
    issues = []
    receipts = db.query(Receipt).filter(Receipt.is_deleted == False).all()  # noqa: E712
    for r in receipts:
        if not r.receipt_date:
            issues.append({"id": r.id, "receipt_number": r.receipt_number, "reason": "receipt_date is NULL"})
            continue
        expected_fy = financial_year_for(r.receipt_date)
        if r.financial_year != expected_fy:
            issues.append({
                "id": r.id,
                "receipt_number": r.receipt_number,
                "reason": f"financial_year is '{r.financial_year}', expected '{expected_fy}' for date {r.receipt_date}",
            })
    return issues


def check_memberships_subscriptions_missing_member(db: Session) -> List[Dict[str, Any]]:
    """5. Memberships or magazine subscriptions of a deleted or missing member."""
    issues = []
    # Check MemberMembership
    mms = db.query(MemberMembership).filter(MemberMembership.is_deleted == False).all()  # noqa: E712
    for mm in mms:
        m = db.query(Member.id, Member.is_deleted).filter(Member.id == mm.member_id).first()
        if not m:
            issues.append({"type": "MemberMembership", "id": mm.id, "reason": f"member_id {mm.member_id} does not exist"})
        elif m.is_deleted:
            issues.append({"type": "MemberMembership", "id": mm.id, "reason": f"member_id {mm.member_id} is deleted"})

    # Check MagazineSubscription
    subs = db.query(MagazineSubscription).filter(MagazineSubscription.is_deleted == False).all()  # noqa: E712
    for s in subs:
        m = db.query(Member.id, Member.is_deleted).filter(Member.id == s.member_id).first()
        if not m:
            issues.append({"type": "MagazineSubscription", "id": s.id, "reason": f"member_id {s.member_id} does not exist"})
        elif m.is_deleted:
            issues.append({"type": "MagazineSubscription", "id": s.id, "reason": f"member_id {s.member_id} is deleted"})

    return issues


def check_running_subscriptions_inactive_or_rejected(db: Session) -> List[Dict[str, Any]]:
    """6. A running subscription for an inactive member or a rejected applicant (or unpaid applicant)."""
    issues = []
    subs = db.query(MagazineSubscription).filter(
        MagazineSubscription.is_deleted == False,  # noqa: E712
        MagazineSubscription.delivery_status == "ACTIVE",
    ).all()

    for s in subs:
        m = db.query(Member).filter(Member.id == s.member_id).first()
        if not m or m.is_deleted:
            issues.append({"id": s.id, "member_id": s.member_id, "reason": "Member missing or deleted while subscription ACTIVE"})
            continue
        if m.member_status != "ACTIVE":
            issues.append({"id": s.id, "member_id": m.id, "reason": f"Member status is {m.member_status} (inactive) while subscription ACTIVE"})
            continue
        if m.approval_status == "REJECTED":
            issues.append({"id": s.id, "member_id": m.id, "reason": "Applicant is REJECTED while subscription ACTIVE"})
            continue
        if m.approval_status != "APPROVED":
            # Applicant: must have at least one assigned, non-cancelled, active receipt
            has_paid = db.query(ReceiptAllocation.id).join(Receipt, Receipt.id == ReceiptAllocation.receipt_id).filter(
                ReceiptAllocation.member_id == m.id,
                ReceiptAllocation.is_deleted == False,  # noqa: E712
                Receipt.is_deleted == False,  # noqa: E712
                Receipt.receipt_status != "CANCELLED",
            ).first() is not None
            if not has_paid:
                issues.append({"id": s.id, "member_id": m.id, "reason": "Unapproved applicant has no active/paid receipt while subscription ACTIVE"})

    return issues


def check_approved_members_no_membership(db: Session) -> List[Dict[str, Any]]:
    """7. Approved members with no membership."""
    issues = []
    approved = db.query(Member).filter(
        Member.is_deleted == False,  # noqa: E712
        Member.approval_status == "APPROVED",
    ).all()

    for m in approved:
        mm = db.query(MemberMembership.id).filter(
            MemberMembership.member_id == m.id,
            MemberMembership.is_deleted == False,  # noqa: E712
        ).first()
        if not mm:
            issues.append({
                "id": m.id,
                "membership_number": m.membership_number or m.member_code,
                "name": m.full_name_en,
                "reason": "Approved member has no active member_membership record",
            })
    return issues


def check_duplicate_numbers(db: Session) -> List[Dict[str, Any]]:
    """8. Duplicate membership numbers, or duplicate receipt numbers within one financial year."""
    issues = []

    # Duplicate membership numbers among active members
    mem_codes = defaultdict(list)
    members = db.query(Member).filter(Member.is_deleted == False).all()  # noqa: E712
    for m in members:
        code = (m.membership_number or m.member_code or "").strip()
        if code:
            mem_codes[code].append(m.id)

    for code, ids in mem_codes.items():
        if len(ids) > 1:
            issues.append({
                "type": "Duplicate membership number",
                "code": code,
                "member_ids": ids,
                "reason": f"Membership number '{code}' used by {len(ids)} active members",
            })

    # Duplicate receipt numbers within one financial year
    r_codes = defaultdict(list)
    receipts = db.query(Receipt).filter(Receipt.is_deleted == False).all()  # noqa: E712
    for r in receipts:
        if r.financial_year and r.receipt_number:
            key = (r.financial_year, r.receipt_number.strip())
            r_codes[key].append(r.id)

    for (fy, rnum), ids in r_codes.items():
        if len(ids) > 1:
            issues.append({
                "type": "Duplicate receipt number in FY",
                "financial_year": fy,
                "receipt_number": rnum,
                "receipt_ids": ids,
                "reason": f"Receipt '{rnum}' repeated {len(ids)} times in FY {fy}",
            })

    return issues


def check_users_linked_to_missing_member(db: Session) -> List[Dict[str, Any]]:
    """9. User logins linked to a missing member."""
    issues = []
    users = db.query(User).filter(
        User.is_deleted == False,  # noqa: E712
        User.member_id != None,  # noqa: E711
    ).all()

    for u in users:
        m = db.query(Member.id, Member.is_deleted).filter(Member.id == u.member_id).first()
        if not m:
            issues.append({"user_id": u.id, "username": u.username, "member_id": u.member_id, "reason": "member_id does not exist"})
        elif m.is_deleted:
            issues.append({"user_id": u.id, "username": u.username, "member_id": u.member_id, "reason": "member_id is deleted"})
    return issues


CHECKS = [
    ("1. Receipt allocations pointing at deleted/missing receipt, member, or membership", check_receipt_allocations_orphans),
    ("2. Receipts marked Assigned without member link, or Unassigned with member link", check_receipt_status_mapping),
    ("3. Receipts with no line, or net amount differing from line sum", check_receipt_items_and_amounts),
    ("4. Financial year not matching receipt date", check_financial_year_match),
    ("5. Memberships or magazine subscriptions of a deleted/missing member", check_memberships_subscriptions_missing_member),
    ("6. Running subscription for inactive member, rejected applicant, or unpaid applicant", check_running_subscriptions_inactive_or_rejected),
    ("7. Approved members with no membership", check_approved_members_no_membership),
    ("8. Duplicate membership numbers, or duplicate receipt numbers in same FY", check_duplicate_numbers),
    ("9. User logins linked to a missing or deleted member", check_users_linked_to_missing_member),
]


def run_all_checks(db: Session) -> Dict[str, List[Dict[str, Any]]]:
    results = {}
    for name, fn in CHECKS:
        results[name] = fn(db)
    return results


def main():
    db_url = sys.argv[1] if len(sys.argv) > 1 else str(settings.DATABASE_URL)
    print(f"Connecting to: {db_url}")
    engine = create_engine(db_url)
    SessionClass = sessionmaker(bind=engine)
    session = SessionClass()

    total_issues = 0
    try:
        results = run_all_checks(session)
        print("\n" + "=" * 80)
        print("                        DATA INTEGRITY AUDIT REPORT")
        print("=" * 80)
        for name, issues in results.items():
            count = len(issues)
            total_issues += count
            status = "PASS (0 issues)" if count == 0 else f"FAIL ({count} issue(s))"
            print(f"\n[{status}] {name}")
            if issues:
                for item in issues[:10]:
                    print(f"    - {item}")
                if len(issues) > 10:
                    print(f"    ... and {len(issues) - 10} more")
        print("\n" + "=" * 80)
        if total_issues == 0:
            print("AUDIT RESULT: ALL CHECKS PASSED. Database is completely consistent.")
        else:
            print(f"AUDIT RESULT: FOUND {total_issues} INTEGRITY ISSUE(S).")
        print("=" * 80 + "\n")
    finally:
        session.close()

    sys.exit(0 if total_issues == 0 else 1)


if __name__ == "__main__":
    main()
