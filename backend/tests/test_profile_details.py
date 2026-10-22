"""The member profile tabs carry the extra detail: who did it, receipt references, magazine start / address fallback."""
from tests.test_api import _create_member


def test_profile_sections_carry_detail(client, admin_headers):
    member = _create_member(client, admin_headers, "9000000091", "Profile Detail Member")
    base = f"/api/v1/members/{member['id']}/profile"

    mag = client.get(f"{base}/magazine", headers=admin_headers)
    assert mag.status_code == 200, mag.text
    body = mag.json()
    assert "member_address" in body and "subscription_log" in body
    assert isinstance(body["issues"], list) and isinstance(body["pauses"], list)

    mem = client.get(f"{base}/membership", headers=admin_headers)
    assert mem.status_code == 200, mem.text
    approval = mem.json()["approval"]
    assert approval["status"] and "registered_by" in approval and "approved_by" in approval

    hist = client.get(f"{base}/history", headers=admin_headers)
    assert hist.status_code == 200, hist.text
    assert "approvals" in hist.json() and "profile_changes" in hist.json()

    ev = client.get(f"{base}/events", headers=admin_headers)
    assert ev.status_code == 200, ev.text

    rc = client.get(f"{base}/receipts", headers=admin_headers)
    assert rc.status_code == 200, rc.text
