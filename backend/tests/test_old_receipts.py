"""Old (dummy) receipts and the joining-era payment check."""
from datetime import date

from test_api import _create_membership_type
from test_frontend_contract import API, _sfx


def _era_prices(type_id):
    """Priced 200 from 1985 to 1999 and 1000 from 2000 on (the price history of Membership Types)."""
    from db.session import SessionLocal
    from models.masters import MembershipTypePrice
    db = SessionLocal()
    try:
        db.add(MembershipTypePrice(membership_type_id=type_id, amount=200, effective_from=date(1985, 1, 1), effective_to=date(1999, 12, 31)))
        db.add(MembershipTypePrice(membership_type_id=type_id, amount=1000, effective_from=date(2000, 1, 1), effective_to=None))
        db.commit()
    finally:
        db.close()


def _old_member(client, h, s, type_id):
    r = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": "Old", "mobile": "98" + s.zfill(8),
        "existing_member": True, "existing_membership_number": "OM-" + s})
    assert r.status_code in (200, 201), r.text
    mid = r.json()["id"]
    ms = client.post(f"{API}/members/{mid}/memberships", headers=h, json={"membership_type_id": type_id})
    assert ms.status_code in (200, 201), ms.text
    return mid


def _ids(client, h):
    got = client.get(f"{API}/members/payment-mismatches", headers=h, params={"limit": 200})
    assert got.status_code == 200, got.text
    return {row["member_id"]: row for row in got.json()["data"]}


def _old_body(mid, amount, when, **over):
    body = {"receipt_date": when, "receipt_type": "MEMBERSHIP", "payment_mode": "CASH", "payer_name": "Old",
            "gross_amount": amount, "discount_amount": 0, "net_amount": amount,
            "items": [{"item_type": "MEMBERSHIP", "amount": amount}],
            "allocations": [{"member_id": mid, "allocated_amount": amount}]}
    body.update(over)
    return body


def _check(client, h, mid):
    return client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()["payment_check"]


def test_missing_old_receipt_is_flagged_and_cleared_by_a_dummy_receipt(client, admin_headers):
    h, s = admin_headers, _sfx()
    mt = _create_membership_type(client, h, "OR" + s[-5:], "Old Poshaka " + s)
    _era_prices(mt["id"])
    mid = _old_member(client, h, s, mt["id"])

    # no membership receipt on record at all: flagged
    row = _ids(client, h)[mid]
    assert row["no_receipt"] is True and row["shortfall"] > 0
    assert _check(client, h, mid)["mismatch"] is True
    listed = client.get(f"{API}/members/", headers=h, params={"search": "98" + s.zfill(8), "limit": 5}).json()["data"]
    assert listed and listed[0]["payment_mismatch"] is True
    assert listed[0]["payment_no_receipt"] is True
    for status, expect in (("NO_RECEIPT", True), ("MISMATCH", False), ("NOT_MAPPED", False)):
        got = client.get(f"{API}/members/", headers=h, params={"payment_status": status, "search": "98" + s.zfill(8), "limit": 5}).json()["data"]
        assert bool(got) is expect

    # the number of an old (dummy) receipt is typed, in the old-receipt format
    body = _old_body(mid, 200, "1990-06-01", is_old_receipt=True)
    assert client.post(f"{API}/receipts/", headers=h, json=body).status_code == 400
    assert client.post(f"{API}/receipts/", headers=h, json={**body, "receipt_number": "R-" + s}).status_code == 400

    # a short receipt (150 against the 1990 price of 200) leaves the member flagged, short by 50
    number = "OLD-" + s
    made = client.post(f"{API}/receipts/", headers=h, json={**_old_body(mid, 150, "1990-06-01", is_old_receipt=True), "receipt_number": number})
    assert made.status_code == 201, made.text
    assert made.json()["is_old_receipt"] is True and made.json()["receipt_number"] == number
    short = _ids(client, h)[mid]
    assert short["no_receipt"] is False and short["price_then"] == 200 and short["shortfall"] == 50

    # a number cannot be used twice, and the last one is shown so the next follows it
    assert client.post(f"{API}/receipts/", headers=h, json={**body, "receipt_number": number}).status_code == 409
    last = client.get(f"{API}/receipts/old-number", headers=h).json()
    assert last["last_number"] == number and last["prefix"] == "OLD-"
    assert last["next_number"].startswith("OLD-") and last["next_number"] != number

    # the missing 50 as a NORMAL receipt with its real date clears it: real and dummy receipts count the same
    real = client.post(f"{API}/receipts/", headers=h, json=_old_body(mid, 50, "1990-07-01"))
    assert real.status_code == 201, real.text
    assert mid not in _ids(client, h)
    check = _check(client, h, mid)
    assert check["mismatch"] is False and check["reference_date"] == "1990-07-01" and check["paid"] == 200
    listed = client.get(f"{API}/members/", headers=h, params={"search": "98" + s.zfill(8), "limit": 5}).json()["data"]
    assert listed[0]["payment_mismatch"] is False
    assert listed[0]["payment_no_receipt"] is False


def test_a_flagged_member_keeps_their_type_when_money_arrives(client, admin_headers):
    """Poshaka entered by hand with nothing on record: a payment today must not move the type."""
    h, s = admin_headers, _sfx()
    mt = _create_membership_type(client, h, "OK" + s[-5:], "Keep Type " + s)
    _era_prices(mt["id"])
    mid = _old_member(client, h, s, mt["id"])
    assert mid in _ids(client, h)
    r = client.post(f"{API}/receipts/", headers=h, json=_old_body(mid, 1000, date.today().isoformat()))
    assert r.status_code == 201, r.text
    prof = client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()
    assert [m["membership_type_id"] for m in prof["memberships"]] == [mt["id"]]


def test_ordinary_receipts_are_not_old(client, admin_headers):
    h = admin_headers
    r = client.post(f"{API}/receipts/", headers=h, json={
        "receipt_date": date.today().isoformat(), "receipt_type": "OTHER", "payment_mode": "CASH", "payer_name": "x",
        "gross_amount": 10, "discount_amount": 0, "net_amount": 10, "items": [{"item_type": "OTHER", "amount": 10}]})
    assert r.status_code == 201 and r.json()["is_old_receipt"] is False


def test_old_receipt_format_is_listed_in_number_formats(client, admin_headers):
    got = client.get(f"{API}/system/number-formats", headers=admin_headers)
    assert got.status_code == 200, got.text
    old = [d for d in got.json()["data"] if d["doc_type"] == "OLD_RECEIPT"]
    assert old and old[0]["prefix"] == "OLD"


def _ladder(client, h, s):
    """Poshaka 1337 and Mahaposhaka 6061 from the start of 1990 (prices no other test uses)."""
    from db.session import SessionLocal
    from models.masters import MembershipTypePrice
    po = _create_membership_type(client, h, "DP" + s[-5:], "Down Poshaka " + s)
    ma = _create_membership_type(client, h, "DM" + s[-5:], "Down Maha " + s)
    db = SessionLocal()
    try:
        for t, amt in ((po, 1337), (ma, 6061)):
            db.add(MembershipTypePrice(membership_type_id=t["id"], amount=amt, effective_from=date(1990, 1, 1), effective_to=None))
        db.commit()
    finally:
        db.close()
    return po, ma


def _pay(client, h, mid, amount, when="1991-01-01"):
    r = client.post(f"{API}/receipts/", headers=h, json={
        "receipt_date": when, "receipt_type": "MEMBERSHIP", "payment_mode": "CASH", "payer_name": "x",
        "gross_amount": amount, "discount_amount": 0, "net_amount": amount, "items": [{"item_type": "MEMBERSHIP", "amount": amount}],
        "allocations": [{"member_id": mid, "allocated_amount": amount}]})
    assert r.status_code == 201, r.text
    return r.json()


def _type_of(client, h, mid):
    return client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()["memberships"][0]["membership_type_id"]


def test_deleting_or_cancelling_a_receipt_lowers_the_type(client, admin_headers):
    h, s = admin_headers, _sfx()
    po, ma = _ladder(client, h, s)
    mid = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Down", "mobile": "97" + s.zfill(8)}).json()["id"]
    client.put(f"{API}/members/{mid}/approve", headers=h)
    first = _pay(client, h, mid, 1337)           # Poshaka
    second = _pay(client, h, mid, 4724, "1992-01-01")   # Maha
    assert _type_of(client, h, mid) == ma["id"]

    # delete the second receipt: the payments no longer pay for Maha, back to Poshaka
    assert client.delete(f"{API}/receipts/{second['id']}", headers=h, params={"force": True, "reason": "wrong entry"}).status_code in (200, 204)
    assert _type_of(client, h, mid) == po["id"]
    hist = client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()["type_changes"]
    assert any("Auto-downgrade" in (c["reason"] or "") for c in hist)

    # cancelling the first leaves nothing cheaper to go to: the type stays and the approvers are told
    assert client.post(f"{API}/receipts/{first['id']}/cancel", headers=h, json={"reason": "bounced"}).status_code == 200
    assert _type_of(client, h, mid) == po["id"]


def test_removing_a_receipt_does_not_lower_a_member_with_a_missing_old_receipt(client, admin_headers):
    """The Maha of 1990 whose own old receipt was never entered is left alone when some other receipt goes."""
    h, s = admin_headers, _sfx()
    po, ma = _ladder(client, h, s)
    r = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": "Legacy", "mobile": "96" + s.zfill(8), "existing_member": True, "existing_membership_number": "LG-" + s})
    mid = r.json()["id"]
    assert client.post(f"{API}/members/{mid}/memberships", headers=h,
                       json={"membership_type_id": ma["id"]}).status_code in (200, 201)
    other = _pay(client, h, mid, 1400, "1995-01-01")    # some membership money, short of the 1995 Mahaposhaka price
    assert mid in _ids(client, h)                       # flagged: payments fall short of the price on the receipt date
    assert client.delete(f"{API}/receipts/{other['id']}", headers=h, params={"force": True, "reason": "x"}).status_code in (200, 204)
    assert _type_of(client, h, mid) == ma["id"]         # not lowered
