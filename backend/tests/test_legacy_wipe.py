"""Wiping the old-register import removes it and its dependents, keeps test data, and cuts links from test rows."""
from test_frontend_contract import _sfx


def test_wipe_only_the_import(client, admin_headers):
    from datetime import date
    from db.session import SessionLocal
    from models.members import Member, MemberMembership
    from models.receipts import Receipt, ReceiptAllocation, ReceiptItem
    from services import legacy_wipe

    db = SessionLocal()
    try:
        tag = _sfx()[-5:]
        old = Member(first_name_en="ImportedOne" + tag, registration_source="MIGRATION", membership_number="9" + tag.replace("-", "")[:4] + "1")
        keep = Member(first_name_en="TestKeep" + tag, registration_source="ONLINE")
        db.add_all([old, keep])
        db.flush()
        r_old = Receipt(receipt_number="WIPE-" + tag, receipt_date=date(2020, 5, 1), financial_year="2020-21", receipt_type="MEMBERSHIP", source="OLD_REGISTER",
                        gross_amount=100, discount_amount=0, net_amount=100, payment_status="SUCCESS", receipt_status="ASSIGNED", payment_mode="OTHER")
        r_test = Receipt(receipt_number="KEEP-" + tag, receipt_date=date(2020, 5, 2), financial_year="2020-21", receipt_type="MEMBERSHIP", source="OFFLINE",
                         gross_amount=50, discount_amount=0, net_amount=50, payment_status="SUCCESS", receipt_status="ASSIGNED", payment_mode="CASH")
        db.add_all([r_old, r_test])
        db.flush()
        db.add_all([ReceiptItem(receipt_id=r_old.id, item_type="MEMBERSHIP", particular_name="Membership", amount=100, line_no=1),
                    ReceiptAllocation(receipt_id=r_old.id, member_id=old.id, allocated_amount=100),
                    ReceiptAllocation(receipt_id=r_test.id, member_id=old.id, allocated_amount=50)])   # a test receipt mapped to an imported member
        db.commit()
        ids = (old.id, keep.id, r_old.id, r_test.id)
        out = legacy_wipe.wipe(db, dry=True)
        assert db.get(Member, ids[0]) is not None and out.get("members", 0) >= 1          # a dry run changes nothing
        legacy_wipe.wipe(db)
        db.expire_all()
        assert db.get(Member, ids[0]) is None and db.get(Receipt, ids[2]) is None
        assert db.get(Member, ids[1]) is not None and db.get(Receipt, ids[3]) is not None   # test data stays
        assert db.query(ReceiptAllocation).filter(ReceiptAllocation.receipt_id == ids[2]).count() == 0
        # and the other way round (a dry run: the shared test database must keep its other rows): the test data would go, an import stays
        keep2 = Member(first_name_en="TestKeepTwo" + tag, registration_source="ONLINE")
        db.add(keep2)
        db.commit()
        out2 = legacy_wipe.wipe(db, dry=True, others=True)
        db.expire_all()
        assert out2.get("members", 0) >= 1 and db.get(Member, keep2.id) is not None       # counted, nothing removed
    finally:
        db.close()
