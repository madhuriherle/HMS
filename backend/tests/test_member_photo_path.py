"""The member detail carries the photo path, so the Edit page can show the photo."""
from test_frontend_contract import _sfx


def test_member_detail_has_photo_path(client, admin_headers):
    from db.session import SessionLocal
    from models.members import Member

    db = SessionLocal()
    try:
        m = Member(first_name_en="PhotoMember" + _sfx()[-4:], photo_path="members/photos/x.jpg")
        db.add(m)
        db.commit()
        mid = m.id
    finally:
        db.close()
    got = client.get(f"/api/v1/members/{mid}", headers=admin_headers)
    assert got.status_code == 200 and got.json()["photo_path"] == "members/photos/x.jpg"
