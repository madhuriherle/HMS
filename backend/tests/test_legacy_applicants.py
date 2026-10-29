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


def test_applicants_import_endpoints(client, admin_headers):
    """The Unapproved screen's Import: preview the register, then import it in one call."""
    from db.session import SessionLocal
    from models.masters import Particular
    from models.members import Member

    s = _sfx()
    _create_membership_type(client, admin_headers, "AX" + s[-5:], "Ajeeva")
    db = SessionLocal()
    try:
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
    finally:
        db.close()
    content = _register([
        _row(960001, "API APPLICANT", [(6101, datetime(2026, 3, 1), 1000)], CusTitle="SRI."),
        _row(960002, "API APPLICANT TWO", CusTitle="SMT."),
        _row(960003, "API APPLICANT THREE", CusTitle="DR."),
    ])
    name = "MstApplication.xlsx"
    pre = client.post("/api/v1/members/unapproved-applications/import/preview", headers=admin_headers,
                      files={"file": (name, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert pre.status_code == 200, pre.text
    counts = pre.json()["counts"]
    assert counts["members"] == 3 and counts["receipts_to_import"] == 1
    got = client.post("/api/v1/members/unapproved-applications/import", headers=admin_headers,
                      files={"file": (name, content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["created"] == 3 and body["receipts"]["created"] == 1, body
    db = SessionLocal()
    try:
        one = db.query(Member).filter(Member.legacy_ref_number == "960001").one()
        assert one.approval_status == "UNAPPROVED" and one.membership_number is None
        assert one.gender == "MALE"                                  # SRI.
        assert db.query(Member).filter(Member.legacy_ref_number == "960002").one().gender == "FEMALE"   # SMT.
        assert db.query(Member).filter(Member.legacy_ref_number == "960003").one().gender is None       # DR.: not guessed
    finally:
        db.close()


def test_applicants_payment_status_filter_and_shortfall(client, admin_headers):
    """The Unapproved list can be filtered by payment status, and its rows carry the shortfall (an applicant paying less than the price of the type they chose)."""
    from db.session import SessionLocal
    from models.masters import MembershipTypePrice, Particular
    from services import legacy_import

    s = _sfx()
    name = "Payshort" + s[-5:]
    made = _create_membership_type(client, admin_headers, "PS" + s[-5:], name)
    rows = legacy_import.read_register(_register([
        _row(970001, "SHORT PAYER", [(5101, datetime(2026, 3, 1), 400)], CusMemberType=name.upper()),
        _row(970002, "FULL PAYER", [(5102, datetime(2026, 3, 2), 1000)], CusMemberType=name.upper()),
        _row(970003, "NO RECEIPT", CusMemberType=name.upper()),
    ]))
    db = SessionLocal()
    try:
        db.add(MembershipTypePrice(membership_type_id=made["id"], amount=1000, effective_from=date(2000, 1, 1)))
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
        db.commit()
        assert legacy_import.import_members(db, rows, 1, run_id="p" + s[-8:], applicants=True)["created"] == 3
        legacy_import.import_receipts(db, rows, 1, applicants=True)
    finally:
        db.close()
    got = client.get("/api/v1/members/", headers=admin_headers, params={"approval_status": "UNAPPROVED", "payment_status": "MISMATCH", "limit": 200})
    assert got.status_code == 200, got.text
    data = got.json()["data"] if isinstance(got.json(), dict) else got.json()
    short = [m for m in data if str(m.get("legacy_ref_number")) == "970001"]
    assert short and float(short[0]["payment_shortfall"]) == 600 and short[0]["payment_no_receipt"] is False
    assert not [m for m in data if str(m.get("legacy_ref_number")) == "970002"]                          # paid in full: not listed
    none = client.get("/api/v1/members/", headers=admin_headers, params={"approval_status": "UNAPPROVED", "payment_status": "NO_RECEIPT", "limit": 200}).json()
    none = none["data"] if isinstance(none, dict) else none
    assert [m for m in none if str(m.get("legacy_ref_number")) == "970003"]

