"""Register New Member screen: every field it sends is accepted, stored and returned."""

from test_frontend_contract import API, _items, _sfx, _state


def _payload(s, **over):
    body = {
        "name_title": "SRI.",
        "first_name_en": "Ramesh",
        "last_name_en": "Rao",
        "father_husband_name": "Krishna Rao",
        "mobile": "98" + s.zfill(8),
        "mobile_country_code": "+91",
        "whatsapp_number": "97" + s.zfill(8),
        "whatsapp_country_code": "+91",
        "date_of_birth": "1985-04-12",
        "gender": "MALE",
        "blood_group": "O+",
        "aadhaar_number": "123456789012",
        "gotra_text": "Vasista",
        "qualification_text": "BE",
        "occupation": "Engineer",
        "native_place_text": "Sirsi",
        "address_line1": "12 MG Road",
        "locality": "Jayanagar",
        "applied_on_behalf_of": "Self",
        "magazine_needed": True,
        "membership_type_category": "Only Havyaka Mahasabha Membership",
        "referred_by_number": "M-100",
        "referred_by_name": "Suresh Hegde",
        "family_membership_number": "F-55",
        "family_membership_name": "Hegde Family",
        "registration_payment": {"payment_mode": "Online", "bank_account": "SBI", "amount": 1000,
                                 "receipt_date": "2026-10-09", "transaction_id": "UTR1", "remarks": "paid at office"},
        "registration_source": "OFFLINE",
    }
    body.update(over)
    return body


def test_every_registration_field_round_trips(client, admin_headers):
    h, s = admin_headers, _sfx()
    body = _payload(s)
    r = client.post(f"{API}/members/", headers=h, json=body)
    assert r.status_code in (200, 201), r.text
    mid = r.json()["id"]
    got = client.get(f"{API}/members/{mid}", headers=h).json()
    lost = {k: (got.get(k), v) for k, v in body.items() if k != "registration_source" and got.get(k) != v}
    assert not lost, lost

    # edit mode: change some of them and read back
    up = client.put(f"{API}/members/{mid}", headers=h, json={
        "name_title": "MS.", "gender": "FEMALE", "magazine_needed": False, "applied_on_behalf_of": "Family",
        "family_membership_name": "Rao Family",
        "registration_payment": {"payment_mode": "Cash", "amount": 2000}})
    assert up.status_code == 200, up.text
    got = client.get(f"{API}/members/{mid}", headers=h).json()
    assert got["name_title"] == "MS." and got["gender"] == "FEMALE" and got["magazine_needed"] is False
    assert got["registration_payment"] == {"payment_mode": "Cash", "amount": 2000}


def test_membership_type_attached_after_registration(client, admin_headers):
    h, s = admin_headers, _sfx()
    mt = client.post(f"{API}/masters/membership-types", headers=h, json={"code": f"RG{s}", "name_en": f"Reg{s}", "status": True}).json()
    client.post(f"{API}/masters/membership-types/{mt['id']}/prices", headers=h,
                json={"amount": 1500, "effective_from": "2026-01-01", "change_reason": "Initial price"})
    mid = client.post(f"{API}/members/", headers=h, json=_payload(s)).json()["id"]
    ms = client.post(f"{API}/members/{mid}/memberships", headers=h, json={"membership_type_id": mt["id"]})
    assert ms.status_code in (200, 201), ms.text


def test_starter_gotras_and_qualifications_seed_only_into_empty_masters(client, admin_headers):
    from db.seed_defaults import GOTRA_VALUES, QUALIFICATION_VALUES, seed_personal_master_values
    from db.session import SessionLocal

    h = admin_headers
    with SessionLocal() as db:
        added = seed_personal_master_values(db)
        again = seed_personal_master_values(db)
    assert again == 0, "second run must add nothing"
    gotras = {x["name_en"] for x in _items(client.get(f"{API}/masters/gotras?limit=1000", headers=h).json())}
    quals = {x["name_en"] for x in _items(client.get(f"{API}/masters/qualifications?limit=1000", headers=h).json())}
    if added:  # masters were empty: the starter lists are now there
        assert set(GOTRA_VALUES) <= gotras and set(QUALIFICATION_VALUES) <= quals
    assert gotras and quals
