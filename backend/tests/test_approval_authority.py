"""Authority to finalize is per CRUD action: <code>.approve."""

import re
from pathlib import Path

from test_api import _staff_with_role

API = "/api/v1"


def test_every_gated_code_has_an_approve_privilege():
    """GATED_APPROVAL_CODES must equal the codes used in @approval_gate.gated(...)."""
    from db.seed_defaults import GATED_APPROVAL_CODES, PERMISSION_CATALOG

    used = set()
    for f in Path(__file__).resolve().parents[1].glob("api/**/*.py"):
        used |= set(re.findall(r'approval_gate\.gated\(\s*"[a-z_]+",\s*"[A-Z]+",\s*"[A-Za-z]+",\s*"([a-z._]+)"', f.read_text(encoding="utf8")))
    assert used, "scan found no gated endpoints"
    assert used == set(GATED_APPROVAL_CODES), f"out of sync: {sorted(used ^ set(GATED_APPROVAL_CODES))}"
    seeded = {p[0] for p in PERMISSION_CATALOG}
    for code in used:
        assert f"{code}.approve" in seeded, code


def _file_state_request(client, maker_headers, name):
    r = client.post(f"{API}/masters/states", headers=maker_headers, json={"name_en": name})
    assert r.status_code in (200, 201, 202), r.text
    assert r.json()["status"] == "PENDING"
    return r.json()["approval_request_id"]


def test_finalizing_needs_the_matching_approve_privilege(client, admin_headers):
    _, _, maker = _staff_with_role(
        client, admin_headers, "auth_maker", "AuthMaker", "AUTH_MAKER",
        permission_grants=[("masters.write", True)],
    )
    # can use the approvals screen but only holds the approve privilege for MEMBER deletions
    _, _, wrong = _staff_with_role(
        client, admin_headers, "auth_wrong", "AuthWrong", "AUTH_WRONG",
        permission_grants=[("approvals.write", False), ("members.delete.approve", False)],
    )
    # holds the approve privilege for MASTER changes
    _, _, right = _staff_with_role(
        client, admin_headers, "auth_right", "AuthRight", "AUTH_RIGHT",
        permission_grants=[("approvals.write", False), ("masters.write.approve", False)],
    )
    # approvals.write alone is not enough any more
    _, _, bare = _staff_with_role(
        client, admin_headers, "auth_bare", "AuthBare", "AUTH_BARE",
        permission_grants=[("approvals.write", False)],
    )

    rid = _file_state_request(client, maker, "Authority Nadu")
    for who in (wrong, bare):
        denied = client.put(f"{API}/approvals/requests/{rid}/approve", headers=who)
        assert denied.status_code == 403, denied.text
        assert "masters.write.approve" in denied.text
        rej = client.put(f"{API}/approvals/requests/{rid}/reject", headers=who, params={"note": "no"})
        assert rej.status_code == 403, rej.text

    ok = client.put(f"{API}/approvals/requests/{rid}/approve", headers=right)
    assert ok.status_code == 200, ok.text
    states = client.get(f"{API}/masters/states", headers=admin_headers, params={"limit": 200}).json()["data"]
    assert any(s["name_en"] == "Authority Nadu" for s in states)

    # the right privilege also lets them reject
    rid2 = _file_state_request(client, maker, "Authority Rejected")
    assert client.put(f"{API}/approvals/requests/{rid2}/reject", headers=right, params={"note": "not now"}).status_code == 200
