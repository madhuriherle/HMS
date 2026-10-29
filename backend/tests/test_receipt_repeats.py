"""A register number used again keeps a tail (32170, 32170/2 ...): the tracking filter, the chip counts and the same-number lookup."""
from datetime import date

from test_frontend_contract import _sfx


def _receipt(db, number, on=date(2031, 5, 1), name="Repeat Payer", amount=100):
    from models.receipts import Receipt

    r = Receipt(receipt_number=number, receipt_date=on, financial_year=None, receipt_type="MEMBERSHIP", source="OLD_REGISTER",
                payer_name=name, gross_amount=amount, discount_amount=0, net_amount=amount, payment_status="SUCCESS",
                receipt_status="UNASSIGNED", payment_mode="CASH")
    db.add(r)
    db.flush()
    return r


def test_repeat_filter_counts_and_same_number(client, admin_headers):
    from db.session import SessionLocal

    db = SessionLocal()
    try:
        tag = "R" + _sfx()[-5:].replace("-", "")
        first, second, third, fourth = (_receipt(db, n) for n in (tag, tag + "/2", tag + "/3", tag + "/4"))
        other = _receipt(db, tag + "X")             # a different number that only starts the same
        other_year = _receipt(db, tag + "/2", on=date(2032, 5, 1))   # the same text in another financial year is a different number
        db.commit()
        ids = {k: v.id for k, v in dict(first=first, second=second, third=third, fourth=fourth, other=other, other_year=other_year).items()}
    finally:
        db.close()

    def listed(kind):
        r = client.get("/api/v1/receipts/tracking", headers=admin_headers, params={"number_kind": kind, "search": tag, "fy": "2031-32", "limit": 50})
        assert r.status_code == 200, r.text
        return r.json()

    rep = listed("REPEAT")
    assert {row["receipt_number"] for row in rep["data"]} == {tag + "/2", tag + "/3", tag + "/4"}
    assert {row["receipt_number"] for row in listed("REPEAT_2")["data"]} == {tag + "/2"}
    assert {row["receipt_number"] for row in listed("REPEAT_3")["data"]} == {tag + "/3"}
    assert {row["receipt_number"] for row in listed("REPEAT_4PLUS")["data"]} == {tag + "/4"}
    # a repeat names the number it repeats; the first one is not a repeat
    by_no = {row["receipt_number"]: row for row in rep["data"]}
    assert by_no[tag + "/3"]["repeat_of"] == tag and by_no[tag + "/3"]["repeat_no"] == 3
    allrows = {row["receipt_number"]: row for row in client.get("/api/v1/receipts/tracking", headers=admin_headers, params={"search": tag, "fy": "2031-32", "limit": 50}).json()["data"]}
    assert allrows[tag]["repeat_of"] is None and allrows[tag + "X"]["repeat_of"] is None
    # the chip counts follow the other filters, not the repeat choice itself
    counts = listed("KNOWN")["summary"]["repeat_counts"]
    assert counts["repeat"] == 3 and counts["repeat_2"] == 1 and counts["repeat_3"] == 1 and counts["repeat_4plus"] == 1
    assert listed("REPEAT_2")["summary"]["repeat_counts"] == counts
    assert client.get("/api/v1/receipts/tracking", headers=admin_headers, params={"number_kind": "NOPE"}).status_code == 400

    # the same-number lookup: every live receipt of the number in that financial year, the first one first
    for key in ("first", "third"):
        out = client.get(f"/api/v1/receipts/{ids[key]}/same-number", headers=admin_headers)
        assert out.status_code == 200, out.text
        body = out.json()
        assert body["base"] == tag and body["current_id"] == ids[key]
        assert [i["receipt_number"] for i in body["items"]] == [tag, tag + "/2", tag + "/3", tag + "/4"]
    lone = client.get(f"/api/v1/receipts/{ids['other']}/same-number", headers=admin_headers).json()
    assert [i["receipt_number"] for i in lone["items"]] == [tag + "X"]
    assert client.get("/api/v1/receipts/99999999/same-number", headers=admin_headers).status_code == 404
