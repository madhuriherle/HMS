"""One way to write a blood group: A+, A-, AB+, O- ... whatever way it is typed, sent or imported."""
import time

from core.blood_group import normalize_blood_group
from test_api import _create_member


def test_normalize():
    cases = {"O+VE": "O+", "A +VE": "A+", "AB -VE": "AB-", "b+": "B+", "a + ve": "A+", "O-VE": "O-", "AB positive": "AB+", "A+": "A+", "AB-": "AB-"}
    for raw, want in cases.items():
        assert normalize_blood_group(raw) == want, raw
    assert normalize_blood_group("A") == "A" and normalize_blood_group("  ") is None and normalize_blood_group(None) is None
    assert normalize_blood_group("unknown") == "unknown"


def test_saved_blood_group_is_short(client, admin_headers):
    m = _create_member(client, admin_headers, "75" + str(int(time.time() * 1000))[-8:], "BloodShort")
    r = client.put(f"/api/v1/members/{m['id']}", headers=admin_headers, json={"blood_group": "A +VE"})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/v1/members/{m['id']}", headers=admin_headers).json()["blood_group"] == "A+"
