"""An unknown receipt becomes a normal one on Edit when it is unticked and holds a real amount; it is never made unknown on Edit."""
from datetime import date

from test_receipt_repeats import _receipt


def _make(on, number, amount, unknown=True):
    from db.session import SessionLocal

    db = SessionLocal()
    r = _receipt(db, number, on=on, amount=amount)
    r.is_old_receipt = unknown
    db.commit()
    rid = r.id
    db.close()
    return rid


def _flag(rid):
    from db.session import SessionLocal
    from models.receipts import Receipt

    db = SessionLocal()
    try:
        return db.get(Receipt, rid).is_old_receipt
    finally:
        db.close()


def test_unticking_needs_a_real_amount_and_never_goes_the_other_way(client, admin_headers):
    zero = _make(date(1981, 6, 1), "FY81-0001", 0)
    r = client.put(f"/api/v1/receipts/{zero}", json={"is_old_receipt": False}, headers=admin_headers)
    assert r.status_code == 400 and "real amount" in r.text and _flag(zero) is True

    paid = _make(date(1981, 6, 2), "FY81-0002", 0)
    r = client.put(f"/api/v1/receipts/{paid}", json={"is_old_receipt": False, "gross_amount": 250, "net_amount": 250,
                                                     "items": [{"item_type": "MEMBERSHIP", "description": "Membership", "amount": 250}]},
                   headers=admin_headers)
    assert r.status_code == 200, r.text
    assert _flag(paid) is False                       # normal now; the number is kept as typed
    assert r.json()["receipt_number"] == "FY81-0002"

    normal = _make(date(1981, 6, 3), "8101", 100, unknown=False)
    r = client.put(f"/api/v1/receipts/{normal}", json={"is_old_receipt": True}, headers=admin_headers)
    assert r.status_code == 200 and _flag(normal) is False   # a normal receipt is never made unknown on Edit

    keep = _make(date(1981, 6, 4), "FY81-0004", 100)
    r = client.put(f"/api/v1/receipts/{keep}", json={"payer_name": "Someone"}, headers=admin_headers)
    assert r.status_code == 200 and _flag(keep) is True      # an edit that does not untick leaves it unknown


def test_an_imported_receipt_can_be_read_and_saved_again(client, admin_headers):
    rid = _make(date(1981, 7, 1), "FY81-0009", 100)          # source OLD_REGISTER
    assert client.get(f"/api/v1/receipts/{rid}", headers=admin_headers).status_code == 200
    r = client.put(f"/api/v1/receipts/{rid}", json={"payer_name": "Edited"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["source"] == "OLD_REGISTER"
