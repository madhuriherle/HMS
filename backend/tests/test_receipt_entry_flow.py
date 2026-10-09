"""Receipt Entry -> Receipt Tracking: what the screen sends, and that the list shows it."""

from test_frontend_contract import API, _items, _sfx


def _entry_payload(number, name, **over):
    """Exactly what receiptToApiPayload() builds from the Receipt Entry form
    (no member selected: assigning is a separate step)."""
    body = {
        "receipt_number": number,
        "receipt_date": "2026-10-09",
        "receipt_type": "MEMBERSHIP",
        "payer_name": name,
        "payment_mode": "CASH",
        "transaction_reference": None,
        "transaction_date": None,
        "gross_amount": 1000,
        "discount_amount": 0,
        "net_amount": 1000,
        "source": "OFFLINE",
        "is_renewal": False,
        "notes": None,
        "items": [{"item_type": "MEMBERSHIP", "description": "Membership", "amount": 1000}],
        "allocations": [],
    }
    body.update(over)
    return body


def _tracking(client, h, **params):
    return _items(client.get(f"{API}/receipts/tracking", headers=h, params={"limit": 500, **params}).json())


def test_cash_and_online_receipts_save_and_list(client, admin_headers):
    h, s = admin_headers, _sfx()
    cash = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(f"C-{s}", "Cash Payer"))
    assert cash.status_code in (200, 201), cash.text
    online = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
        f"O-{s}", "Online Payer", payment_mode="NETBANKING", receipt_type="DONATION",
        transaction_reference="UTR123456", transaction_date="2026-10-09", gross_amount=2500, net_amount=2500,
        items=[{"item_type": "DONATION", "description": "Hostel fund", "amount": 2500}]))
    assert online.status_code in (200, 201), online.text

    rows = {r["receipt_number"]: r for r in _tracking(client, h)}
    c, o = rows[f"C-{s}"], rows[f"O-{s}"]
    # what Receipt Tracking needs to draw the row
    assert c["payer_name"] == "Cash Payer" and c["amount"] == 1000 and c["payment_mode"] == "CASH"
    assert c["receipt_type"] == "MEMBERSHIP" and c["receipt_date"] == "2026-10-09"
    assert c["member_id"] is None, "a receipt saved without a member must be listed as unassigned"
    assert o["payer_name"] == "Online Payer" and o["amount"] == 2500
    assert o["receipt_type"] == "DONATION" and o["transaction_reference"] == "UTR123456"


def test_every_particular_and_mode_the_screen_can_send_is_accepted(client, admin_headers):
    h, s = admin_headers, _sfx()
    n = 0
    for rtype in ("MEMBERSHIP", "SCHOLARSHIP", "DONATION", "MAGAZINE", "EVENT", "OTHER"):
        for mode in ("CASH", "NETBANKING"):
            n += 1
            r = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
                f"E{n}-{s}", f"P{n}", receipt_type=rtype, payment_mode=mode,
                items=[{"item_type": rtype, "description": rtype.title(), "amount": 1000}]))
            assert r.status_code in (200, 201), (rtype, mode, r.text)


def test_duplicate_receipt_number_and_bad_input_are_rejected_readably(client, admin_headers):
    h, s = admin_headers, _sfx()
    assert client.post(f"{API}/receipts/", headers=h, json=_entry_payload(f"D-{s}", "First")).status_code in (200, 201)
    dup = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(f"D-{s}", "Second"))
    assert dup.status_code == 409 and isinstance(dup.json()["detail"], str), dup.text
    # missing mandatory field -> 422 plus a field list the screen shows
    bad = _entry_payload(f"B-{s}", "Bad")
    del bad["receipt_date"]
    r = client.post(f"{API}/receipts/", headers=h, json=bad)
    assert r.status_code == 422, r.text
    errors = r.json().get("errors") or []
    assert any("receipt_date" in e["field"] for e in errors), r.text


def test_saved_receipt_can_be_found_by_search_and_edited(client, admin_headers):
    h, s = admin_headers, _sfx()
    rec = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(f"S-{s}", "Searchable Person")).json()
    found = _tracking(client, h, search="Searchable Person")
    assert any(x["id"] == rec["id"] for x in found), "search by payer name found nothing"
    edit = _entry_payload("x", "Searchable Person")
    for k in ("receipt_number", "items", "allocations"):
        edit.pop(k)
    edit.update(gross_amount=1200, net_amount=1200)
    up = client.put(f"{API}/receipts/{rec['id']}", headers=h, json=edit)
    assert up.status_code == 200, up.text
    row = next(x for x in _tracking(client, h) if x["id"] == rec["id"])
    assert row["amount"] == 1200


def test_bank_account_and_notes_are_stored_and_listed(client, admin_headers):
    h, s = admin_headers, _sfx()
    r = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
        f"BK-{s}", "Bank Payer", payment_mode="NETBANKING", bank_account="SBI Main 1234",
        transaction_reference="UTR9", notes="Bank: SBI Main 1234 - paid online"))
    assert r.status_code in (200, 201), r.text
    assert r.json()["bank_account"] == "SBI Main 1234"
    row = next(x for x in _tracking(client, h) if x["id"] == r.json()["id"])
    assert row["bank_account"] == "SBI Main 1234" and row["notes"] == "Bank: SBI Main 1234 - paid online"
