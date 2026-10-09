"""Maker-checker rules: a gated action waits for someone else, and nobody approves their own request."""

from test_api import _staff_with_role

API = "/api/v1"


def _pending_state(client, headers, name):
    r = client.post(f"{API}/masters/states", headers=headers, json={"name_en": name})
    assert r.status_code in (200, 201, 202), r.text
    return r.json()


def test_nobody_approves_their_own_request(client, admin_headers):
    # a clerk whose masters.write needs approval, and who may also approve (approvals.write)
    _, _, clerk = _staff_with_role(
        client, admin_headers, "selfappr_clerk", "SelfApprClerk", "SELFAPPR_CLERK",
        permission_grants=[("masters.write", True), ("approvals.write", False)],
    )
    filed = _pending_state(client, clerk, "Gate Nadu")
    assert filed["status"] == "PENDING"
    rid = filed["approval_request_id"]

    # the maker cannot be the checker
    own = client.put(f"{API}/approvals/requests/{rid}/approve", headers=clerk)
    assert own.status_code == 403, own.text
    assert "own request" in own.text

    # another approver can; the action then really happens
    done = client.put(f"{API}/approvals/requests/{rid}/approve", headers=admin_headers)
    assert done.status_code == 200, done.text
    states = client.get(f"{API}/masters/states", headers=admin_headers, params={"limit": 200}).json()["data"]
    assert any(s["name_en"] == "Gate Nadu" for s in states)


def test_membership_credit_settings_respect_the_approval_grant(client, admin_headers):
    _, _, clerk = _staff_with_role(
        client, admin_headers, "credit_clerk", "CreditClerk", "CREDIT_CLERK",
        permission_grants=[("masters.write", True)],
    )
    current = client.get(f"{API}/masters/membership-credit-settings", headers=admin_headers).json()
    keep = current["receipt_types"]

    # gated: nothing changes until an approver acts
    filed = client.put(f"{API}/masters/membership-credit-settings", headers=clerk, json=keep[:1] or keep)
    assert filed.status_code == 200, filed.text
    assert filed.json()["status"] == "PENDING"
    unchanged = client.get(f"{API}/masters/membership-credit-settings", headers=admin_headers).json()
    assert unchanged["receipt_types"] == keep

    reset = client.post(f"{API}/masters/membership-credit-settings/reset", headers=clerk)
    assert reset.status_code == 200 and reset.json()["status"] == "PENDING"


def test_member_document_actions_are_registered_for_approval():
    from services import approval_registry
    import main  # noqa: F401  (registers every gated endpoint)
    assert approval_registry.get("members", "UPDATE", "MemberDocument")
    assert approval_registry.get("members", "DELETE", "MemberDocument")
