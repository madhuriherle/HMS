"""The applications register: unapproved applicants with no membership number, CusNo as application number, receipts linked; matched / missed."""
from datetime import date, datetime

from test_legacy_members import _create_membership_type, _register, _row
from test_frontend_contract import _sfx


def test_applicants_import_and_check(client, admin_headers):
    from db.session import SessionLocal
    from models.masters import Particular
    from models.members import Member
    from models.receipts import Receipt, ReceiptAllocation
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "AP" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(950001, "APPLICANT ONE", [(4101, datetime(2026, 3, 1), 1000)]),
        _row(950002, "APPLICANT TWO", [(4102, datetime(2026, 3, 2), 500)]),
    ]))
    db = SessionLocal()
    try:
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
        out = legacy_import.import_members(db, rows, 1, run_id="a" + s[-8:], applicants=True)
        assert out["created"] == 2 and out["skipped"] == 0, out
        one = db.query(Member).filter(Member.legacy_ref_number == "950001").one()
        assert one.approval_status == "UNAPPROVED" and one.membership_number is None and one.registration_source == "MIGRATION"
        rec = legacy_import.import_receipts(db, rows, 1, applicants=True)
        assert rec["created"] == 2 and rec["skipped"] == 0, {k: v for k, v in rec.items() if k != "plan"}
        r = db.query(Receipt).join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id).filter(ReceiptAllocation.member_id == one.id).one()
        assert r.receipt_status == "ASSIGNED" and float(r.net_amount) == 1000 and r.payer_membership_no is None
        check = legacy_import.reconcile_applicants(db, rows)
        assert check["counts"]["applicant stored"] == 2 and check["counts"]["receipt matched"] == 2 and "applicant missed" not in check["counts"]
        # an applicant that was never imported shows as missed
        more = legacy_import.read_register(_register([_row(950003, "APPLICANT THREE", [(4103, datetime(2026, 3, 3), 100)])]))
        miss = legacy_import.reconcile_applicants(db, rows + more)
        assert miss["counts"]["applicant missed"] == 1 and miss["counts"]["receipt missed"] == 1
        # an applicant whose receipt number and date are already on another receipt (a member's): a receipt of their own, number/2; the other is untouched
        existing = Receipt(receipt_number="4104", receipt_date=date(2026, 3, 4), financial_year="2025-26", receipt_type="MEMBERSHIP", source="OLD_REGISTER",
                           gross_amount=700, discount_amount=0, net_amount=700, payment_status="SUCCESS", receipt_status="ASSIGNED", payment_mode="OTHER")
        db.add(existing)
        db.commit()
        clash = legacy_import.read_register(_register([_row(950004, "APPLICANT FOUR", [(4104, datetime(2026, 3, 4), 1000)])]))
        assert legacy_import.import_members(db, clash, 1, run_id="c" + s[-8:], applicants=True)["created"] == 1
        assert legacy_import.import_receipts(db, clash, 1, applicants=True)["created"] == 1
        four = db.query(Member).filter(Member.legacy_ref_number == "950004").one()
        mine = db.query(Receipt).join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id).filter(ReceiptAllocation.member_id == four.id).one()
        db.refresh(existing)
        assert mine.receipt_number == "4104/2" and float(mine.net_amount) == 1000 and float(existing.net_amount) == 700
        assert legacy_import.import_receipts(db, clash, 1, applicants=True)["created"] == 0            # a repeated run makes no second one
        # a second run adds nothing
        assert legacy_import.import_members(db, rows, 1, run_id="b" + s[-8:], applicants=True)["created"] == 0
    finally:
        db.close()
