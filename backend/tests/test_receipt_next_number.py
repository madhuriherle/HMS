"""The number Receipt Entry offers is the office's own series: receipts imported from the old register (with their typing mistakes) never move it."""
import time
from datetime import date

from test_receipt_repeats import _receipt


def test_imported_register_numbers_do_not_move_the_next_number(client, admin_headers):
    from db.session import SessionLocal

    year = 1900 + int(str(int(time.time()))[-3:]) % 40            # a year no other test uses
    on = date(year, 7, 1)
    db = SessionLocal()
    try:
        r = _receipt(db, "725600", on=on)                          # the register's typo for 72560
        r.source = "OLD_REGISTER"
        db.commit()
    finally:
        db.close()
    got = client.get("/api/v1/receipts/next-number", headers=admin_headers, params={"date": on.isoformat()})
    assert got.status_code == 200, got.text
    assert "725601" not in got.json()["receipt_number"], got.json()
    assert got.json()["receipt_number"].lstrip("0") in ("1", "") or got.json()["receipt_number"].endswith("0001"), got.json()
