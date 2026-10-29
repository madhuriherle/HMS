"""The member profile carries every stored detail: registration and approval details, the Aadhaar number and the magazine choice."""
import time

from test_api import _create_member


def test_profile_sections_carry_the_remaining_fields(client, admin_headers):
    m = _create_member(client, admin_headers, "90" + str(int(time.time() * 1000))[-8:], "ProfileAll")
    upd = client.put(f"/api/v1/members/{m['id']}", headers=admin_headers, json={"aadhaar_number": "123456789012", "magazine_needed": True, "magazine_kind": "PHYSICAL",
                                                                              "magazine_delivery_address": "1 Temple Road, Ankola"})
    assert upd.status_code == 200, upd.text
    personal = client.get(f"/api/v1/members/{m['id']}/profile/personal", headers=admin_headers)
    assert personal.status_code == 200, personal.text
    p = personal.json()
    assert p["aadhaar_number"] == "123456789012"
    assert {"membership_type_category", "registration_payment", "approved_at", "approved_by_name", "verified_by_name", "login_count"} <= set(p)
    contact = client.get(f"/api/v1/members/{m['id']}/profile/contact", headers=admin_headers).json()
    assert contact["magazine_needed"] is True and contact["magazine_kind"] == "PHYSICAL"
    assert contact["magazine_delivery_address"] == "1 Temple Road, Ankola" and "magazine_email" not in contact
