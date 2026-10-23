"""Add old price, the upgrade by the prices of the receipt's date, the payments table and the Receipt Entry preview."""
from datetime import date

from test_api import _create_membership_type
from test_frontend_contract import API, _sfx


def _old_price(client, h, type_id, a, b, amount):
    return client.post(f"{API}/masters/membership-types/{type_id}/prices/old", headers=h,
                       json={"from_year": a, "to_year": b, "amount": amount})


def _deactivate(*type_ids):
    from db.session import SessionLocal
    from models.masters import MembershipType
    db = SessionLocal()
    try:
        for t in db.query(MembershipType).filter(MembershipType.id.in_(type_ids)).all():
            t.status = False
        db.commit()
    finally:
        db.close()


def _pay(client, h, mid, amount, when):
    r = client.post(f"{API}/receipts/", headers=h, json={
        "receipt_date": when, "receipt_type": "MEMBERSHIP", "payment_mode": "CASH", "payer_name": "x",
        "gross_amount": amount, "discount_amount": 0, "net_amount": amount, "items": [{"item_type": "MEMBERSHIP", "amount": amount}],
        "allocations": [{"member_id": mid, "allocated_amount": amount}]})
    assert r.status_code == 201, r.text
    return r.json()


def test_add_old_price_rules(client, admin_headers):
    h, s = admin_headers, _sfx()
    mt = _create_membership_type(client, h, "OP" + s[-5:], "Old Price " + s)
    try:
        made = _old_price(client, h, mt["id"], 1960, 1974, 211)
        assert made.status_code == 200, made.text
        row = made.json()
        assert row["effective_from"] == "1960-04-01" and row["effective_to"] == "1975-03-31" and float(row["amount"]) == 211
        # years that overlap an existing price are refused
        assert _old_price(client, h, mt["id"], 1970, 1980, 300).status_code == 409
        assert _old_price(client, h, mt["id"], 1975, 1989, 411).status_code == 200      # the next years follow on
        assert _old_price(client, h, mt["id"], 1990, 1980, 300).status_code == 422       # first year after the last
        assert _old_price(client, h, mt["id"], 1990, 1995, 0).status_code == 422         # a price of nothing
        assert _old_price(client, h, mt["id"], 1890, 1895, 5).status_code == 422
        history = client.get(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h).json()["data"]
        assert len(history) == 2
    finally:
        _deactivate(mt["id"])


def test_upgrade_follows_the_prices_of_the_receipt_date(client, admin_headers):
    """Poshaka paid 422 in 1962 (price 211) and 1033 in 1976 (Mahaposhaka then 1033): he becomes Mahaposhaka by himself."""
    h, s = admin_headers, _sfx()
    po = _create_membership_type(client, h, "EP" + s[-5:], "Era Poshaka " + s)
    ma = _create_membership_type(client, h, "EM" + s[-5:], "Era Maha " + s)
    try:
        for t, a, b in ((po, 211, 411), (ma, 533, 1033)):
            assert _old_price(client, h, t["id"], 1960, 1974, a).status_code == 200
            assert _old_price(client, h, t["id"], 1975, 1989, b).status_code == 200
        mid = client.post(f"{API}/members/", headers=h, json={
            "first_name_en": "Era", "mobile": "93" + s.zfill(8), "existing_member": True, "existing_membership_number": "ER-" + s}).json()["id"]
        assert client.post(f"{API}/members/{mid}/memberships", headers=h, json={"membership_type_id": po["id"]}).status_code in (200, 201)

        def held():
            return client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()["memberships"][0]["membership_type_id"]

        _pay(client, h, mid, 422, "1962-06-01")
        assert held() == po["id"]
        _pay(client, h, mid, 1033, "1976-06-01")
        assert held() == ma["id"]

        prof = client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()
        assert prof["payment_check"]["mismatch"] is False
        credit = prof["membership_credit"]
        assert credit["credit_total"] == 1455 and credit["current_type"]["code"] == ma["code"] and credit["remaining_amount"] == 422

        # the payments table: one row per receipt with the price of the held type in that year
        table = prof["payments"]
        assert table["type_name"] == ma["name_en"] and [r["paid"] for r in table["rows"]] == [422, 1033]
        assert [r["price_then"] for r in table["rows"]] == [533, 1033] and [r["running_total"] for r in table["rows"]] == [422, 1455]
        assert [r["financial_year"] for r in table["rows"]] == ["1962-63", "1976-77"]
    finally:
        _deactivate(po["id"], ma["id"])


def test_receipt_preview_shows_the_shortfall_and_the_extra(client, admin_headers):
    h, s = admin_headers, _sfx()
    po = _create_membership_type(client, h, "PV" + s[-5:], "Preview Poshaka " + s)
    try:
        assert _old_price(client, h, po["id"], 1960, 1974, 211).status_code == 200
        mid = client.post(f"{API}/members/", headers=h, json={
            "first_name_en": "Prev", "mobile": "92" + s.zfill(8), "existing_member": True, "existing_membership_number": "PV-" + s}).json()["id"]
        assert client.post(f"{API}/members/{mid}/memberships", headers=h, json={"membership_type_id": po["id"]}).status_code in (200, 201)
        _pay(client, h, mid, 111, "1962-06-01")

        def preview(amount):
            return client.get(f"{API}/receipts/payment-preview", headers=h,
                              params={"member_id": mid, "date": "1962-07-01", "amount": amount}).json()
        p = preview(100)
        assert p["applies"] and p["price_then"] == 211 and p["paid_so_far"] == 111 and p["shortfall_before"] == 100
        assert p["shortfall_after"] == 0 and p["extra"] == 0 and p["financial_year"] == "1962-63"
        assert preview(300)["extra"] == 200                       # 300 against a gap of 100
        # no price row covers 1990 for this type: the match cannot be checked
        far = client.get(f"{API}/receipts/payment-preview", headers=h, params={"member_id": mid, "date": "1990-01-01", "amount": 5}).json()
        assert far["applies"] and far["price_known"] is False
    finally:
        _deactivate(po["id"])
