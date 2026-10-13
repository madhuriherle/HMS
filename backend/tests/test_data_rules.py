import pytest

from test_frontend_contract import API, _sfx


def test_format_rules_reject_bad_values_but_accept_good_ones(client, admin_headers):
    s = _sfx()
    h = admin_headers
    base = {"first_name_en": "Rule" + s, "mobile": "93" + s.zfill(8)}
    bad = client.post(f"{API}/members/", headers=h, json={**base, "aadhaar_number": "12345"})
    assert bad.status_code == 422 and "aadhaar" in bad.text
    ok = client.post(f"{API}/members/", headers=h, json={**base, "aadhaar_number": "1234 5678 9012"})
    assert ok.status_code == 201 and ok.json()["aadhaar_number"] == "123456789012"
    assert client.put(f"{API}/members/{ok.json()['id']}", headers=h, json={"aadhaar_number": "99"}).status_code == 422

    from test_api import _role_id
    role = _role_id(client, h, "STAFF")
    user = {"name": "U", "username": "ru" + s, "password": "Rulepass@123", "role_id": role}
    assert client.post(f"{API}/users/", headers=h, json={**user, "username": "ab"}).status_code == 422
    assert client.post(f"{API}/users/", headers=h, json={**user, "email": "not-an-email"}).status_code == 422
    assert client.post(f"{API}/users/", headers=h, json={**user, "mobile": "12"}).status_code == 422
    assert client.post(f"{API}/users/", headers=h, json={**user, "email": "a@b.co", "mobile": "9876543210"}).status_code == 200

    assert client.put(f"{API}/system/settings", headers=h, json={"email": "nope"}).status_code == 422
    assert client.put(f"{API}/system/settings", headers=h, json={"mobile": "12"}).status_code == 422


def test_online_payment_mode_needs_a_bank(client, admin_headers):
    s = _sfx()
    h = admin_headers
    no_bank = client.post(f"{API}/masters/payment-modes", headers=h, json={"payment_mode": "NoBank" + s, "payment_type": "Online"})
    assert no_bank.status_code == 400 and "bank" in no_bank.text
    offline = client.post(f"{API}/masters/payment-modes", headers=h, json={"payment_mode": "Hand" + s, "payment_type": "Offline"})
    assert offline.status_code in (200, 201)
    bank = client.post(f"{API}/masters/banks", headers=h, json={"name_en": "RuleBank" + s, "code": "RB" + s}).json()
    online = client.post(f"{API}/masters/payment-modes", headers=h, json={"payment_mode": "WithBank" + s, "payment_type": "Online", "bank_id": bank["id"]})
    assert online.status_code in (200, 201)
    # switching the mode on or off never trips the rule
    assert client.put(f"{API}/masters/payment-modes/{online.json()['id']}", headers=h, json={"status": False}).status_code == 200


@pytest.mark.approval_checklist
def test_approval_needs_the_key_details(client, admin_headers):
    s = _sfx()
    h = admin_headers
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Check" + s}).json()
    refused = client.put(f"{API}/members/{m['id']}/approve", headers=h)
    assert refused.status_code == 400
    for gap in ("mobile", "date of birth", "address"):
        assert gap in refused.text
    assert "PIN" not in refused.text and "Aadhaar" not in refused.text
    done = client.put(f"{API}/members/{m['id']}", headers=h, json={
        "mobile": "92" + s.zfill(8), "date_of_birth": "1980-01-01", "address_line1": "1 Main Road"})
    assert done.status_code == 200, done.text
    ok = client.put(f"{API}/members/{m['id']}/approve", headers=h)
    assert ok.status_code == 200 and ok.json()["approval_status"] == "APPROVED"


def test_rules_endpoint_serves_the_server_rules(client, admin_headers):
    r = client.get(f"{API}/meta/rules", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["aadhaar"]["digits"] == 12 and body["pincode"]["digits"] == 6
    assert body["password"]["min_length"] >= 8 and body["username"]["min_length"] == 3
    assert body["member"]["min_age"] == 18 and body["financial_year"]["start_month"] == 4
    assert "O+" in body["blood_groups"] and "MALE" in body["genders"]
    assert client.get(f"{API}/meta/rules").status_code in (401, 403)


def test_server_makes_a_code_when_none_is_sent(client, admin_headers):
    s = _sfx()
    h = admin_headers
    bank = client.post(f"{API}/masters/banks", headers=h, json={"name_en": "Auto Bank " + s})
    assert bank.status_code in (200, 201), bank.text
    assert bank.json()["code"] and bank.json()["code"].startswith("AUTO")
    part = client.post(f"{API}/masters/particulars", headers=h, json={"name_en": "Auto Particular " + s})
    assert part.status_code in (200, 201) and part.json()["code"]
    mine = client.post(f"{API}/masters/banks", headers=h, json={"name_en": "Own Code " + s, "code": "OWN" + s})
    assert mine.json()["code"] == "OWN" + s
    role = client.post(f"{API}/users/roles", headers=h, json={"name": "Auto Role " + s, "rank_level": 40})
    assert role.status_code == 200 and role.json()["code"]


def test_username_may_only_use_letters_numbers_dots_underscores(client, admin_headers):
    from test_api import _role_id
    h = admin_headers
    role = _role_id(client, h, "STAFF")
    bad = client.post(f"{API}/users/", headers=h, json={"name": "U", "username": "bad name!", "password": "Rulepass@123", "role_id": role})
    assert bad.status_code == 422


def test_pincode_lookup_goes_through_the_server(client, admin_headers, monkeypatch):
    from api.v1.endpoints import meta
    monkeypatch.setattr(meta, "_fetch_pincode", lambda pin: [{"Status": "Success", "PostOffice": [
        {"Name": "Malleswaram", "Block": "Bengaluru North", "District": "Bengaluru", "State": "Karnataka"}]}])
    ok = client.get(f"{API}/meta/pincode/560003", headers=admin_headers).json()
    assert ok == {"found": True, "area": "Malleswaram", "taluk": "Bengaluru North", "district": "Bengaluru", "state": "Karnataka"}
    assert client.get(f"{API}/meta/pincode/12", headers=admin_headers).status_code == 400

    def down(pin):
        raise OSError("no network")
    monkeypatch.setattr(meta, "_fetch_pincode", down)
    assert client.get(f"{API}/meta/pincode/560003", headers=admin_headers).json() == {"found": False}


def test_redirects_keep_https_behind_the_proxy(client):
    r = client.get(f"{API}/dashboard", headers={"X-Forwarded-Proto": "https", "X-Forwarded-For": "1.2.3.4"}, follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"].startswith("https://"), r.headers["location"]
