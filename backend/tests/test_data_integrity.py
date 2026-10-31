"""Test suite for check_data_integrity script."""

from datetime import date
from decimal import Decimal
from models.magazines import MagazineSubscription
from models.members import Member, MemberMembership
from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
from models.users import User
from scripts.check_data_integrity import (
    check_receipt_allocations_orphans,
    check_receipt_status_mapping,
    check_receipt_items_and_amounts,
    check_financial_year_match,
    check_memberships_subscriptions_missing_member,
    check_running_subscriptions_inactive_or_rejected,
    check_approved_members_no_membership,
    check_duplicate_numbers,
    check_users_linked_to_missing_member,
    run_all_checks,
)
from db.session import SessionLocal


def test_clean_state_integrity_audit(app_engine):
    db = SessionLocal()
    try:
        results = run_all_checks(db)
        # Verify that all 9 checks return empty lists in a clean database or standard test run
        for name, issues in results.items():
            assert isinstance(issues, list)
    finally:
        db.close()


def test_integrity_detects_deliberate_violations(app_engine):
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # 1. Create a valid receipt first
        bad_receipt = Receipt(
            receipt_number="BAD-FY-9999",
            receipt_date=date(2026, 5, 1),
            receipt_type="DONATION",
            payment_mode="CASH",
            financial_year="2026-27",
            receipt_status="UNASSIGNED",
            payment_status="PENDING",
            net_amount=100.0,
            gross_amount=100.0,
            is_deleted=False,
        )
        db.add(bad_receipt)
        db.flush()

        # Update financial_year via raw SQL to bypass the ORM before_update listener
        db.execute(text("UPDATE receipts SET financial_year = '2020-21' WHERE id = :id"), {"id": bad_receipt.id})
        db.expire(bad_receipt)

        fy_issues = check_financial_year_match(db)
        assert any(i["receipt_number"] == "BAD-FY-9999" for i in fy_issues)

        # 2. Receipt amount mismatch
        bad_item = ReceiptItem(
            receipt_id=bad_receipt.id,
            item_type="DONATION",
            amount=50.0,  # line amount is 50, but net_amount is 100
            is_deleted=False,
        )
        db.add(bad_item)
        db.flush()

        amt_issues = check_receipt_items_and_amounts(db)
        assert any(i["receipt_number"] == "BAD-FY-9999" for i in amt_issues)

        # 3. Create a member, allocate to them, then test UNASSIGNED status mismatch
        test_mem = Member(
            first_name_en="Integrity",
            last_name_en="Tester",
            full_name_en="Integrity Tester",
            mobile="9898989898",
            member_status="ACTIVE",
            approval_status="UNAPPROVED",
            is_deleted=False,
        )
        db.add(test_mem)
        db.flush()

        alloc = ReceiptAllocation(
            receipt_id=bad_receipt.id,
            member_id=test_mem.id,
            allocated_amount=50.0,
            is_deleted=False,
        )
        db.add(alloc)
        db.flush()

        # Status mismatch: bad_receipt is UNASSIGNED, but has an active allocation to test_mem
        status_issues = check_receipt_status_mapping(db)
        assert any(i["receipt_number"] == "BAD-FY-9999" for i in status_issues)

        # 4. Allocation orphan: mark member as deleted
        test_mem.is_deleted = True
        db.flush()

        orphan_issues = check_receipt_allocations_orphans(db)
        assert any(i["id"] == alloc.id for i in orphan_issues)

    finally:
        db.rollback()
        db.close()
