"""The whole membership flow, in the order the office works:
register -> Unapproved -> receipt entry (assign) -> approve -> Membership List -> Receipt Tracking."""

from test_frontend_contract import API, _items, _sfx
from test_receipt_entry_flow import _entry_payload, _tracking
from test_register_member import _payload


def _ids(client, h, **params):
    return [x["id"] for x in _items(client.get(f"{API}/members/", headers=h, params={"limit": 1000, **params}).json())]


def test_full_membership_flow(client, admin_headers):
    h, s = admin_headers, _sfx()

    # a membership type with a price (what the registration page selects)
    mt = client.post(f"{API}/masters/membership-types", headers=h, json={"code": f"FL{s}", "name_en": f"Flow{s}", "status": True}).json()
    client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                json={"amount": 1000, "effective_from": "2026-01-01", "change_reason": "Initial price"})

    # 1. REGISTER NEW MEMBER -> saved as Unapproved, no permanent numbers yet
    m = client.post(f"{API}/members/", headers=h, json=_payload(s)).json()
    mid = m["id"]
    assert client.post(f"{API}/members/{mid}/memberships", headers=h, json={"membership_type_id": mt["id"]}).status_code in (200, 201)
    got = client.get(f"{API}/members/{mid}", headers=h).json()
    assert got["approval_status"] == "UNAPPROVED" and not got.get("member_code")

    # 2. UNAPPROVED MEMBERS lists the application
    assert mid in _ids(client, h, approval_status="UNAPPROVED")
    assert mid not in _ids(client, h, approval_status="APPROVED")

    # 3. RECEIPT ENTRY, normal mode: no member linked -> still listed in Tracking, unassigned
    free = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(f"F-{s}", "Walk-in Donor")).json()
    row = next(x for x in _tracking(client, h) if x["id"] == free["id"])
    assert row["member_id"] is None and row["payer_name"] == "Walk-in Donor"

    # 4. RECEIPT ENTRY, assign mode: receipt linked to the unapproved applicant
    rec = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
        f"A-{s}", "Applicant Payer", is_renewal=False, allocations=[{"member_id": mid, "allocated_amount": 1000}])).json()
    row = next(x for x in _tracking(client, h) if x["id"] == rec["id"])
    assert row["member_id"] == mid and row["approval_status"] == "UNAPPROVED", "tracking lists receipts of unapproved applicants"

    # 5. APPROVE -> permanent member code and membership number, leaves the Unapproved list
    ap = client.put(f"{API}/members/{mid}/approve", headers=h)
    assert ap.status_code == 200, ap.text
    assert ap.json()["member_code"] and ap.json()["approval_status"] == "APPROVED"
    prof = client.get(f"{API}/members/{mid}/profile", headers=h).json()
    assert prof["memberships"][0]["membership_number"], "membership number minted on approval"
    assert mid not in _ids(client, h, approval_status="UNAPPROVED")
    assert mid in _ids(client, h, approval_status="APPROVED")

    # 6. TRACKING after approval: same receipt, now showing the approved member
    row = next(x for x in _tracking(client, h) if x["id"] == rec["id"])
    assert row["approval_status"] == "APPROVED" and row["member_code"]

    # 7. a cancelled receipt disappears from Tracking; the others stay
    assert client.post(f"{API}/receipts/{free['id']}/cancel", headers=h, json={"reason": "typo"}).status_code == 200
    ids = {x["id"] for x in _tracking(client, h)}
    assert free["id"] not in ids and rec["id"] in ids


def test_membership_list_default_includes_unapproved_members(client, admin_headers):
    """Documents today's behaviour: GET /members/ with no filter also returns Unapproved members,
    so a screen that wants only approved members must ask for approval_status=APPROVED."""
    h, s = admin_headers, _sfx()
    mid = client.post(f"{API}/members/", headers=h, json=_payload(s)).json()["id"]
    assert mid in _ids(client, h)
    assert mid not in _ids(client, h, approval_status="APPROVED")
