"""Registered on / Approved on / Member since: an imported member is known by the date of the first receipt, never by the day of the import."""
import time
from datetime import date, datetime, timezone

from test_api import _create_member


def _set(member_id, **fields):
    from db.session import SessionLocal
    from models.members import Member

    db = SessionLocal()
    try:
        row = db.get(Member, member_id)
        for k, v in fields.items():
            setattr(row, k, v)
        db.commit()
    finally:
        db.close()


def _receipt_for(member_id, number, on):
    from db.session import SessionLocal
    from models.receipts import Receipt, ReceiptAllocation

    db = SessionLocal()
    try:
        r = Receipt(receipt_number=number, receipt_date=on, financial_year=None, receipt_type="MEMBERSHIP", source="OLD_REGISTER", payer_name="Dates",
                    gross_amount=100, discount_amount=0, net_amount=100, payment_status="SUCCESS", receipt_status="ASSIGNED", payment_mode="CASH")
        db.add(r)
        db.flush()
        db.add(ReceiptAllocation(receipt_id=r.id, member_id=member_id, allocated_amount=100))
        db.commit()
    finally:
        db.close()


def test_member_dates_rules(client, admin_headers):
    tag = "MD" + str(int(time.time()))[-6:]
    import_day = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)

    def personal(mid):
        r = client.get(f"/api/v1/members/{mid}/profile/personal", headers=admin_headers)
        assert r.status_code == 200, r.text
        return r.json()

    # imported and approved: the first receipt (the earlier of two), not the import day
    imp = _create_member(client, admin_headers, "80" + str(int(time.time() * 1000))[-8:], tag + "Imp")["id"]
    _set(imp, registration_source="MIGRATION", approval_status="APPROVED", created_at=import_day, approved_at=import_day)
    _receipt_for(imp, tag + "A", date(2015, 6, 1))
    _receipt_for(imp, tag + "B", date(2019, 3, 9))
    p = personal(imp)
    assert (p["registered_on"], p["member_since"], p["approved_on"], p["imported_on"]) == ("2015-06-01", "2015-06-01", None, "2026-10-28")

    # imported with no receipt: nothing (not the import day)
    bare = _create_member(client, admin_headers, "81" + str(int(time.time() * 1000))[-8:], tag + "Bare")["id"]
    _set(bare, registration_source="MIGRATION", approval_status="APPROVED", created_at=import_day, approved_at=import_day)
    p = personal(bare)
    assert p["registered_on"] is None and p["member_since"] is None and p["approved_on"] is None

    # registered the normal way: registered on the day of the form, approved on its approval day, a member since then
    norm = _create_member(client, admin_headers, "82" + str(int(time.time() * 1000))[-8:], tag + "Norm")["id"]
    _set(norm, registration_source="OFFLINE", approval_status="APPROVED", created_at=datetime(2024, 2, 1, 10, 0, tzinfo=timezone.utc), approved_at=datetime(2024, 2, 5, 11, 0, tzinfo=timezone.utc))
    p = personal(norm)
    assert (p["registered_on"], p["approved_on"], p["member_since"], p["imported_on"]) == ("2024-02-01", "2024-02-05", "2024-02-05", None)

    # not approved yet: registered on the form day, no approval, no member since
    pend = _create_member(client, admin_headers, "83" + str(int(time.time() * 1000))[-8:], tag + "Pend")["id"]
    _set(pend, registration_source="OFFLINE", approval_status="UNAPPROVED", created_at=datetime(2025, 7, 7, 10, 0, tzinfo=timezone.utc), approved_at=None)
    p = personal(pend)
    assert (p["registered_on"], p["approved_on"], p["member_since"]) == ("2025-07-07", None, None)

    # the member page and the lists carry the same dates
    assert client.get(f"/api/v1/members/{imp}", headers=admin_headers).json()["registered_on"] == "2015-06-01"
    listed = client.get("/api/v1/members/", headers=admin_headers, params={"search": tag, "limit": 50}).json()["data"]
    by_id = {r["id"]: r for r in listed}
    assert by_id[imp]["registered_on"] == "2015-06-01" and by_id[norm]["approved_on"] == "2024-02-05"
    assert client.get(f"/api/v1/members/{imp}/profile/summary", headers=admin_headers).json()["member_since"] == "2015-06-01"
