"""Receipt Entry: "who is this membership number?" lookup."""

from datetime import datetime, timedelta, timezone

from test_frontend_contract import _sfx
from test_receipt_entry_flow import _entry_payload
from test_register_member import _payload
from test_sub_modules import _role_user

API = "/api/v1"


def _lookup(client, h, number):
    r = client.get(f"{API}/receipts/member-lookup", headers=h, params={"number": number})
    assert r.status_code == 200, r.text
    return r.json()


def _approved_member(client, h, s):
    mt = client.post(f"{API}/masters/membership-types", headers=h, json={"code": f"LK{s}", "name_en": f"Lookup Type {s}", "status": True}).json()
    client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                json={"amount": 500, "effective_from": "2026-01-01", "change_reason": "Initial price"})
    member = client.post(f"{API}/members/", headers=h, json=_payload(s)).json()
    client.post(f"{API}/members/{member['id']}/memberships", headers=h, json={"membership_type_id": mt["id"]})
    done = client.put(f"{API}/members/{member['id']}/approve", headers=h)
    assert done.status_code == 200, done.text
    return member["id"], mt["name_en"], done.json()["member_code"]


def test_lookup_finds_members_and_applicants_by_every_kind_of_number(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid, type_name, code = _approved_member(client, h, s)
    prof = client.get(f"{API}/members/{mid}/profile", headers=h).json()
    membership_no = prof["memberships"][0]["membership_number"]
    mobile = client.get(f"{API}/members/{mid}", headers=h).json()["mobile"]

    # by member code, membership number (any case), mobile (with +91 and spaces)
    for typed in (code, code.lower(), membership_no, membership_no.lower(), mobile, f"+91 {mobile}"):
        r = _lookup(client, h, typed)
        assert r["found"] and r["matches"][0]["id"] == mid, typed
    card = _lookup(client, h, membership_no)["matches"][0]
    assert card["kind"] == "member" and card["membership_type"] == type_name
    assert card["member_code"] == code and card["membership_number"] == membership_no
    assert card["name"].startswith("SRI.") and card["warnings"] == []

    # an applicant is found by the registration number the screens show
    applicant = client.post(f"{API}/members/", headers=h, json=_payload(_sfx())).json()
    reg = f"REG-{datetime.now(timezone.utc).year}-{applicant['id']:04d}"
    a = _lookup(client, h, reg)["matches"][0]
    assert a["id"] == applicant["id"] and a["kind"] == "applicant"
    assert any(w["code"] == "not_approved" for w in a["warnings"])
    assert _lookup(client, h, reg.lower())["found"], "case does not matter"


def test_lookup_not_found_and_too_short(client, admin_headers):
    h = admin_headers
    assert _lookup(client, h, "HMSM-DOES-NOT-EXIST") == {"number": "HMSM-DOES-NOT-EXIST", "found": False, "matches": []}
    assert _lookup(client, h, "REG-2020-9999")["found"] is False
    assert _lookup(client, h, "ab")["found"] is False, "two characters are not a number"
    assert _lookup(client, h, "   ")["found"] is False


def test_lookup_shows_last_receipt_and_warnings(client, admin_headers):
    h, s = admin_headers, _sfx()
    mid, _t, code = _approved_member(client, h, s)
    assert _lookup(client, h, code)["matches"][0]["last_receipt"] is None

    rec = client.post(f"{API}/receipts/", headers=h, json=_entry_payload(
        f"LK-{s}", "Lookup Payer", allocations=[{"member_id": mid, "allocated_amount": 1000}]))
    assert rec.status_code in (200, 201), rec.text
    last = _lookup(client, h, code)["matches"][0]["last_receipt"]
    assert last["receipt_number"] == f"LK-{s}" and last["amount"] == 1000

    # an expired membership and an inactive member are flagged
    from db.session import SessionLocal
    from models.members import Member, MemberMembership
    with SessionLocal() as db:
        db.query(MemberMembership).filter(MemberMembership.member_id == mid).update(
            {"expires_at": datetime.now(timezone.utc) - timedelta(days=30)})
        db.query(Member).filter(Member.id == mid).update({"member_status": "INACTIVE"})
        db.commit()
    codes = {w["code"] for w in _lookup(client, h, code)["matches"][0]["warnings"]}
    assert {"expired", "inactive"} <= codes


def test_lookup_needs_only_receipt_entry_access(client, admin_headers):
    h, s = admin_headers, _sfx()
    _mid, _t, code = _approved_member(client, h, s)
    clerk = _role_user(client, h, ["receipts.entry.read", "receipts.entry.write"])
    assert _lookup(client, clerk, code)["found"], "a Receipt Entry clerk can look a member up"
    assert client.get(f"{API}/members/", headers=clerk).status_code == 403, "but gets no access to the member list"

    nobody = _role_user(client, h, ["members.list.read"])
    assert client.get(f"{API}/receipts/member-lookup", headers=nobody, params={"number": code}).status_code == 403
    tracking = _role_user(client, h, ["receipts.tracking.read"])
    assert client.get(f"{API}/receipts/member-lookup", headers=tracking, params={"number": code}).status_code == 403
