"""Receipt Entry redesign: assigning a receipt to a member, and the member data the screen reads."""

from test_frontend_contract import API, _items, _sfx
from test_receipt_entry_flow import _entry_payload, _tracking


def test_assign_receipt_to_unapproved_member_with_bank_account(client, admin_headers):
    h, s = admin_headers, _sfx()
    m = client.post(f"{API}/members/", headers=h, json={
        "first_name_en": "Assign", "mobile": "93" + s.zfill(8),
        "registration_payment": {"payment_mode": "SBI", "bank_account": "SBI", "amount": 1000}}).json()
    body = _entry_payload(f"AS-{s}", "Assign Payer", payment_mode="NETBANKING", bank_account="SBI",
                          transaction_reference="UTR77", is_renewal=False,
                          allocations=[{"member_id": m["id"], "allocated_amount": 1000}])
    r = client.post(f"{API}/receipts/", headers=h, json=body)
    assert r.status_code in (200, 201), r.text
    row = next(x for x in _tracking(client, h) if x["id"] == r.json()["id"])
    assert row["member_id"] == m["id"] and row["bank_account"] == "SBI" and row["payment_mode"] == "NETBANKING"
    # the screen's lists: this member now counts as "assigned" (it has a linked receipt)
    linked = {x["member_id"] for x in _tracking(client, h) if x.get("member_id")}
    assert m["id"] in linked


def test_member_lists_and_profile_have_what_the_screen_reads(client, admin_headers):
    h, s = admin_headers, _sfx()
    mt = client.post(f"{API}/masters/membership-types", headers=h, json={"code": f"PR{s}", "name_en": f"Prof{s}", "status": True}).json()
    client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                json={"amount": 750, "effective_from": "2026-01-01", "change_reason": "Initial price"})
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Prof", "mobile": "92" + s.zfill(8), "date_of_birth": "1980-01-01"}).json()
    client.post(f"{API}/members/{m['id']}/memberships", headers=h, json={"membership_type_id": mt["id"]})

    prof = client.get(f"{API}/members/{m['id']}/profile", headers=h).json()
    ms = prof["memberships"][0]
    assert ms["type_name_en"] == f"Prof{s}" and ms["membership_type_id"] == mt["id"] and ms["current_price"] == 750

    un = _items(client.get(f"{API}/members/", headers=h, params={"approval_status": "UNAPPROVED", "limit": 1000}).json())
    row = next(x for x in un if x["id"] == m["id"])
    for key in ("first_name_en", "mobile", "date_of_birth", "created_at", "approval_status", "state_id", "district_id"):
        assert key in row, key
