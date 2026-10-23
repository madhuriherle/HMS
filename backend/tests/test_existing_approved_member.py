"""An existing member entered by hand: saved Approved with the typed membership number, no receipt needed."""
from test_api import _create_membership_type
from test_frontend_contract import API, _sfx


def _body(s, **over):
    b = {"first_name_en": "Existing", "mobile": "98" + s.zfill(8)}
    b.update(over)
    return b


def test_existing_member_is_approved_with_typed_number(client, admin_headers):
    h, s = admin_headers, _sfx()
    number = "OLD-" + s
    r = client.post(f"{API}/members/", headers=h, json=_body(s, existing_member=True, existing_membership_number=number))
    assert r.status_code in (200, 201), r.text
    mid = r.json()["id"]
    got = client.get(f"{API}/members/{mid}", headers=h).json()
    assert got["approval_status"] == "APPROVED"
    assert got["membership_number"] == number

    # a membership added afterwards carries the same number and is active at once
    mt = _create_membership_type(client, h, "EX" + s[-4:], "Existing Type " + s)
    ms = client.post(f"{API}/members/{mid}/memberships", headers=h, json={"membership_type_id": mt["id"]})
    assert ms.status_code in (200, 201), ms.text
    assert ms.json()["membership_number"] == number
    shown = client.get(f"{API}/members/{mid}/profile/membership", headers=h).json()["memberships"][0]
    assert shown["membership_number"] == number and shown["activated_at"]

    # the number cannot be used twice
    s2 = _sfx()
    dup = client.post(f"{API}/members/", headers=h, json=_body(s2, existing_member=True, existing_membership_number=number))
    assert dup.status_code == 409, dup.text


def test_existing_member_needs_a_number(client, admin_headers):
    s = _sfx()
    r = client.post(f"{API}/members/", headers=admin_headers, json=_body(s, existing_member=True))
    assert r.status_code == 400, r.text


def test_ordinary_registration_is_still_unapproved(client, admin_headers):
    s = _sfx()
    r = client.post(f"{API}/members/", headers=admin_headers, json=_body(s))
    assert r.status_code in (200, 201), r.text
    assert client.get(f"{API}/members/{r.json()['id']}", headers=admin_headers).json()["approval_status"] == "UNAPPROVED"


def test_mobile_and_whatsapp_owner_are_saved(client, admin_headers):
    h, s = admin_headers, _sfx()
    r = client.post(f"{API}/members/", headers=h, json=_body(
        s, applied_on_behalf_of="Father", mobile_owner_name="Ramesh Rao",
        whatsapp_number="97" + s.zfill(8), whatsapp_owner_relation="Wife", whatsapp_owner_name="Latha Rao"))
    assert r.status_code in (200, 201), r.text
    got = client.get(f"{API}/members/{r.json()['id']}", headers=h).json()
    assert got["mobile_owner_name"] == "Ramesh Rao"
    assert got["whatsapp_owner_relation"] == "Wife" and got["whatsapp_owner_name"] == "Latha Rao"
