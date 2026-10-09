"""Approving (and opening the approval queue) is always direct: it can never be set to need approval."""

API = "/api/v1"


def _role(client, h, key):
    return client.post(f"{API}/users/roles", headers=h, json={"name": key, "code": key.upper(), "rank_level": 10}).json()["id"]


def test_approvals_privileges_cannot_need_approval(client, admin_headers):
    h = admin_headers
    rid = _role(client, h, "direct_appr")
    for code in ("approvals.write", "approvals.read"):
        r = client.put(f"{API}/users/roles/{rid}/permissions", headers=h,
                       json={"permission_codes": ["approvals.read", "approvals.write"], "approval_required_codes": [code]})
        assert r.status_code == 400, (code, r.text)
        assert "always direct" in r.text
    # other privileges may still need approval; approving itself stays direct
    ok = client.put(f"{API}/users/roles/{rid}/permissions", headers=h,
                    json={"permission_codes": ["approvals.read", "approvals.write", "members.list.read", "members.list.write"],
                          "approval_required_codes": ["members.list.write"]})
    assert ok.status_code == 200, ok.text
