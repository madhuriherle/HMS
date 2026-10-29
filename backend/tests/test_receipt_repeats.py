"""A register number used again keeps a tail (32170, 32170/2 ...): the repeated numbers list and the same-number lookup."""
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

    def groups(**params):
        r = client.get("/api/v1/receipts/repeats", headers=admin_headers, params={"search": tag, "fy": "2031-32", "limit": 50, **params})
        assert r.status_code == 200, r.text
        return r.json()

    out = groups()
    assert out["total"] == 1 and out["counts"] == {"ALL": 1, "2": 0, "3": 0, "4PLUS": 1}
    g = out["groups"][0]
    assert g["number"] == tag and g["count"] == 4 and g["has_original"] and g["financial_year"] == "2031-32"
    assert [i["receipt_number"] for i in g["items"]] == [tag, tag + "/2", tag + "/3", tag + "/4"]
    assert g["alike"] == [tag + "/2", tag + "/3", tag + "/4"]    # the same name and amount as the first
    # the level filter: this number reached /4, so it shows under 4PLUS only; the same text in another year is another number
    assert groups(kind="4PLUS")["total"] == 1 and groups(kind="2")["total"] == 0 and groups(kind="3")["total"] == 0
    assert groups(fy="2032-33")["groups"][0]["items"][0]["receipt_number"] == tag + "/2" and not groups(fy="2032-33")["groups"][0]["has_original"]
    assert groups(search="Nobody Has This Name")["total"] == 0
    assert groups(search="Repeat Payer")["total"] >= 1
    assert client.get("/api/v1/receipts/repeats", headers=admin_headers, params={"kind": "NOPE"}).status_code == 400
    x = client.get("/api/v1/receipts/repeats", headers=admin_headers, params={"search": tag, "export": "excel"})
    assert x.status_code == 200 and x.content[:2] == b"PK"

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
