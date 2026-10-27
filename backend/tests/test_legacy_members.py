"""Import of the old register's members: membership number and old number, statuses, magazine, repeat runs."""
from datetime import datetime

from test_api import _create_membership_type
from test_frontend_contract import API, _sfx
from test_legacy_import import _register, _row


def test_members_import(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member, MemberMembership
    from models.magazines import MagazineSubscription
    from services import legacy_import

    s = _sfx()
    mt = _create_membership_type(client, admin_headers, "LM" + s[-5:], "Ajeeva")   # the register's AJEEVA finds this type by name
    rows = legacy_import.read_register(_register([
        _row(910001, "RAMA BHAT", CusNoOld=5, CusMobile="9876543299", CusGotra="KASHYAPA"),
        _row(910002, "SITA HEGDE", CusStatus="Expired"),
        _row(910003, "GOPAL RAO", DeleteMark="*"),
        _row(910004, ""),                                   # no name: skipped
        _row(910005, "LAKSHMI", CusMemberType="NOSUCH"),                # unknown type: skipped
    ]))
    db = SessionLocal()
    try:
        out = legacy_import.import_members(db, rows, 1, run_id="t" + s[-8:], file_name="MstMember.xlsx")
        assert out["created"] == 3 and out["skipped"] == 2 and out["deleted"] == 1 and out["expired"] == 1, out
        a = db.query(Member).filter(Member.membership_number == "910001").one()
        assert a.old_membership_number == "5" and a.legacy_ref_number is None and a.approval_status == "APPROVED" and a.registration_source == "MIGRATION"
        assert a.mobile == "9876543299"
        b = db.query(Member).filter(Member.membership_number == "910002").one()
        assert b.old_membership_number is None and b.member_status == "INACTIVE" and "Expired" in (b.remarks or "")
        c = db.query(Member).filter(Member.membership_number == "910003").one()
        assert c.is_deleted is False and c.member_status == "INACTIVE" and "Marked deleted" in (c.remarks or "")   # kept as an inactive member
        assert db.query(MemberMembership).filter(MemberMembership.member_id == a.id).one().membership_type_id == mt["id"]
        # a second run adds nothing
        again = legacy_import.import_members(db, rows, 1, run_id="u" + s[-8:])
        assert again["created"] == 0
    finally:
        db.close()
    found = client.get(f"{API}/members/", headers=admin_headers, params={"search": "910001"})
    assert found.status_code == 200 and any((m.get("membership_number") or m.get("member_code")) == "910001" for m in found.json()["data"])


def test_receipts_import(client, admin_headers):
    from datetime import date
    from db.session import SessionLocal
    from models.members import Member
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
    from services import legacy_import, membership_credit

    s = _sfx()
    # the Membership particular and the type the members get must exist
    _create_membership_type(client, admin_headers, "RM" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(920001, "ASHA A", [(5001, datetime(1990, 6, 1), 200), (None, datetime(1991, 7, 1), 0), (None, None, 200)],
             CusMemUpAmt2=0),
        _row(920002, "BHAT B", [(777, datetime(1985, 5, 1), 100)]),                       # shares receipt 777 ...
        _row(920003, "CHARAN C", [(777, datetime(1985, 5, 1), 100)]),                     # ... with this one
        _row(920004, "DEEPA D", [(9, datetime(1996, 5, 1), 400)], CusScholarAmt1=150, CusReceiptNote1="PATRIKA FUND"),
        _row(920005, "ESHA E", [(11, datetime(1927, 1, 1), 100)]),                         # wrong date: not imported
    ]))
    db = SessionLocal()
    try:
        from models.masters import Particular
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
        legacy_import.import_members(db, rows, 1, run_id="r" + s[-8:])
        out = legacy_import.import_receipts(db, rows, 1)
        assert out["ignored_undated"] == 1 and out["not_imported_other"] == 1, {k: v for k, v in out.items() if k != "plan"}
        assert out["created"] == 4 and out["shared"] == 1 and out["dummy"] == 1, {k: v for k, v in out.items() if k != "plan"}
        ids = {m.membership_number: m.id for m in db.query(Member).filter(Member.membership_number.in_(["920001", "920002", "920003", "920004"])).all()}
        shared = db.query(Receipt).filter(Receipt.receipt_number == "777", Receipt.source == "OLD_REGISTER").one()
        assert float(shared.net_amount) == 200 and shared.receipt_status == "ASSIGNED" and shared.is_old_receipt is False
        allocs = db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == shared.id).all()
        assert sorted(float(a.allocated_amount) for a in allocs) == [100.0, 100.0]
        dummy = db.query(Receipt).join(ReceiptAllocation, ReceiptAllocation.receipt_id == Receipt.id).filter(
            ReceiptAllocation.member_id == ids["920001"], Receipt.is_old_receipt == True).one()  # noqa: E712
        assert dummy.receipt_number == "FY91-001" and float(dummy.net_amount) == 0 and dummy.receipt_date == date(1991, 7, 1)
        mixed = db.query(Receipt).filter(Receipt.receipt_number == "9").one()
        assert float(mixed.net_amount) == 550 and mixed.receipt_type == "MEMBERSHIP"
        names = {i.particular_name + "/" + (i.sub_particular_name or "") for i in db.query(ReceiptItem).filter(ReceiptItem.receipt_id == mixed.id).all()}
        assert names == {"Membership/", "Scholarship/General"}
        # only the membership money counts toward the member
        assert float(membership_credit.credit_ledger(db, ids["920004"])["total"]) == 400
        # a second run adds nothing
        assert legacy_import.import_receipts(db, rows, 1)["created"] == 0
    finally:
        db.close()


def test_receipts_import_adds_to_a_shared_receipt_of_an_earlier_run(client, admin_headers):
    from datetime import date
    from db.session import SessionLocal
    from models.masters import Particular
    from models.receipts import Receipt, ReceiptAllocation
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "RN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([
        _row(930001, "FIRST F", [(888, datetime(1984, 5, 1), 100)]),
        _row(930002, "SECOND S", [(888, datetime(1984, 5, 1), 100)]),
    ]))
    db = SessionLocal()
    try:
        if not db.query(Particular).filter(Particular.name_en == "Membership", Particular.parent_id.is_(None), Particular.is_deleted == False).first():  # noqa: E712
            db.add(Particular(code="RT-" + s[-6:], name_en="Membership", status=True, pays_for_membership=True))
            db.commit()
        legacy_import.import_members(db, rows, 1, run_id="q" + s[-8:])
        assert legacy_import.import_receipts(db, rows[:1], 1)["created"] == 1          # the first member alone
        assert legacy_import.import_receipts(db, rows, 1)["created"] == 1              # the second joins the same receipt
        r = db.query(Receipt).filter(Receipt.receipt_number == "888", Receipt.receipt_date == date(1984, 5, 1)).one()
        assert float(r.net_amount) == 200
        assert db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == r.id).count() == 2
    finally:
        db.close()


def test_renumber_imported(client, admin_headers):
    """Members imported with CusNo taken as the old number are corrected: number = CusNo, old number = CusNoOld."""
    from db.session import SessionLocal
    from models.members import Member, MemberMembership
    from services import legacy_import

    s = _sfx()
    _create_membership_type(client, admin_headers, "RN" + s[-5:], "Ajeeva")
    rows = legacy_import.read_register(_register([_row(940001, "NITIN K", CusNoOld=7), _row(940002, "OMKAR L")]))
    db = SessionLocal()
    try:
        legacy_import.import_members(db, rows, 1, run_id="v" + s[-8:])
        for m in db.query(Member).filter(Member.membership_number.in_(["940001", "940002"])).all():   # put them back as the wrong import left them
            m.old_membership_number, m.membership_number, m.legacy_ref_number = m.membership_number, None, "9"
            db.query(MemberMembership).filter(MemberMembership.member_id == m.id).update({"membership_number": None})
        db.commit()
        out = legacy_import.renumber_imported(db, rows)
        assert out["members"] == 2 and out["with_old_number"] == 1, out
        a = db.query(Member).filter(Member.membership_number == "940001").one()
        b = db.query(Member).filter(Member.membership_number == "940002").one()
        assert a.old_membership_number == "7" and a.legacy_ref_number is None and b.old_membership_number is None
        assert db.query(MemberMembership).filter(MemberMembership.member_id == a.id).one().membership_number == "940001"
        try:
            legacy_import.renumber_imported(db, rows)
            raised = False
        except RuntimeError:
            raised = True
        assert raised          # a second run is refused
    finally:
        db.close()
