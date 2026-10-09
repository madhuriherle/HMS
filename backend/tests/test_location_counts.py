"""Location Setup counts are real: per state, per district and per taluk."""

from test_api import STAFF_PW, _create_district, _create_taluk
from test_frontend_contract import _sfx
from test_sub_modules import _role_user

API = "/api/v1"


def _pin(client, h, state, district, taluk, pincode):
    r = client.post(f"{API}/masters/postal-codes", headers=h, json={
        "pincode": pincode, "state_id": state["id"], "district_id": district["id"], "taluk_id": taluk["id"] if taluk else None})
    assert r.status_code == 200, r.text
    return r.json()


def test_counts_at_every_level_are_real(client, admin_headers):
    h, s = admin_headers, _sfx()
    state = client.post(f"{API}/masters/states", headers=h, json={"name_en": f"Count Nadu {s}"}).json()
    d1 = _create_district(client, h, state["id"], f"CountDist1 {s}")
    d2 = _create_district(client, h, state["id"], f"CountDist2 {s}")
    t1 = _create_taluk(client, h, d1["id"], f"CountTaluk1 {s}")
    t2 = _create_taluk(client, h, d1["id"], f"CountTaluk2 {s}")
    t3 = _create_taluk(client, h, d2["id"], f"CountTaluk3 {s}")
    made = {}
    for code, taluk, dist in (("560101", t1, d1), ("560102", t1, d1), ("560103", t2, d1), ("570101", t3, d2)):
        made[code] = _pin(client, h, state, dist, taluk, code)
    # a PIN with no taluk still counts for its district and state
    _pin(client, h, state, d2, None, "570102")

    states = {x["id"]: x for x in client.get(f"{API}/masters/states-summary", headers=h).json()["data"]}
    assert (states[state["id"]]["districts"], states[state["id"]]["taluks"], states[state["id"]]["pins"]) == (2, 3, 5)

    dists = {x["id"]: x for x in client.get(f"{API}/masters/districts-summary", headers=h, params={"state_id": state["id"]}).json()["data"]}
    assert (dists[d1["id"]]["taluks"], dists[d1["id"]]["pins"]) == (2, 3)
    assert (dists[d2["id"]]["taluks"], dists[d2["id"]]["pins"]) == (1, 2)

    taluks = {x["id"]: x["pins"] for x in client.get(f"{API}/masters/taluks-summary", headers=h, params={"district_id": d1["id"]}).json()["data"]}
    assert taluks == {t1["id"]: 2, t2["id"]: 1}

    # removing a PIN lowers every level
    assert client.delete(f"{API}/masters/postal-codes/{made['560102']['id']}", headers=h).status_code == 200
    again = {x["id"]: x for x in client.get(f"{API}/masters/districts-summary", headers=h, params={"state_id": state["id"]}).json()["data"]}
    assert again[d1["id"]]["pins"] == 2


def test_summaries_belong_to_location_setup(client, admin_headers):
    location_only = _role_user(client, admin_headers, ["masters.location.read"])
    for path, params in (("/masters/states-summary", {}), ("/masters/districts-summary", {"state_id": 1}), ("/masters/taluks-summary", {"district_id": 1})):
        assert client.get(f"{API}{path}", headers=location_only, params=params).status_code == 200, path
    banks_only = _role_user(client, admin_headers, ["masters.banks.read"])
    assert client.get(f"{API}/masters/districts-summary", headers=banks_only, params={"state_id": 1}).status_code == 403
