import os
from test_frontend_contract import API, _sfx

PNG = b"\x89PNG\r\n\x1a\n0123456789"


def test_member_photo_goes_to_member_folder_and_replaces(client, admin_headers):
    h, s = admin_headers, _sfx()
    m = client.post(f"{API}/members/", headers=h, json={"first_name_en": "Ph", "mobile": "91" + s.zfill(8)}).json()
    p1 = client.post(f"{API}/members/{m['id']}/photo", headers=h, files={"file": ("a.png", PNG, "image/png")}).json()["photo_path"]
    assert p1.replace("\\", "/").endswith(f"images/members/{m['id']}/photo.png") and os.path.isfile(p1)
    p2 = client.post(f"{API}/members/{m['id']}/photo", headers=h, files={"file": ("b.jpg", PNG, "image/jpeg")}).json()["photo_path"]
    assert p2.endswith("photo.jpg") and os.path.isfile(p2) and not os.path.exists(p1)
    bad = client.post(f"{API}/members/{m['id']}/photo", headers=h, files={"file": ("c.pdf", b"%PDF", "application/pdf")})
    assert bad.status_code == 400
    assert client.get(f"{API}/system/files", headers=h, params={"path": p2}).status_code == 200
