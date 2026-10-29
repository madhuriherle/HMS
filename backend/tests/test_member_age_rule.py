"""The 18-year rule is for members typed in; a member already on file (an imported child) must still open."""
import time
from datetime import date

from test_api import _create_member


def test_stored_child_member_can_be_read_but_a_new_one_cannot_be_added(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member

    member = _create_member(client, admin_headers, "97" + str(int(time.time() * 1000))[-8:], "ChildOnFile")
    db = SessionLocal()
    try:
        db.get(Member, member["id"]).date_of_birth = date.today().replace(year=date.today().year - 2)
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/v1/members/{member['id']}", headers=admin_headers)
    assert r.status_code == 200, r.text            # was an internal server error
    assert r.json()["date_of_birth"] is not None

    young = client.post("/api/v1/members/", headers=admin_headers, json={
        "first_name_en": "TooYoung", "mobile": "96" + str(int(time.time() * 1000))[-8:],
        "date_of_birth": str(date.today().replace(year=date.today().year - 5)),
    })
    assert young.status_code == 422 and "at least" in young.text


def test_stored_short_alternate_number_does_not_break_reading(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member

    member = _create_member(client, admin_headers, "95" + str(int(time.time() * 1000))[-8:], "ShortAlt")
    db = SessionLocal()
    try:
        row = db.get(Member, member["id"])
        row.alternate_mobile, row.whatsapp_number = "12345", "999"
        db.commit()
    finally:
        db.close()
    r = client.get(f"/api/v1/members/{member['id']}", headers=admin_headers)
    assert r.status_code == 200, r.text
    # typing a bad number in is still refused
    bad = client.post("/api/v1/members/", headers=admin_headers, json={"first_name_en": "BadAlt", "mobile": "94" + str(int(time.time() * 1000))[-8:], "alternate_mobile": "123"})
    assert bad.status_code == 422
