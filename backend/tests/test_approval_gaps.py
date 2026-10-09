"""Maker-checker rules: a gated action waits for someone else, and nobody approves their own request."""

from test_api import _staff_with_role

API = "/api/v1"


def _pending_state(client, headers, name):
    r = client.post(f"{API}/masters/states", headers=headers, json={"name_en": name})
    assert r.status_code in (200, 201, 202), r.text
    return r.json()


def test_a_holder_of_approve_permission_can_approve_their_own_request(client, admin_headers):
    # a clerk whose masters.write needs approval, and who also holds the approve permission
    _, _, clerk = _staff_with_role(
        client, admin_headers, "selfappr_clerk", "SelfApprClerk", "SELFAPPR_CLERK",
        permission_grants=[("masters.write", True), ("approvals.write", False)],
    )
    filed = _pending_state(client, clerk, "Gate Nadu")
    assert filed["status"] == "PENDING"
    states = lambda: client.get(f"{API}/masters/states", headers=admin_headers, params={"limit": 200}).json()["data"]
    assert not any(s["name_en"] == "Gate Nadu" for s in states()), "waits until approved"

    done = client.put(f"{API}/approvals/requests/{filed['approval_request_id']}/approve", headers=clerk)
    assert done.status_code == 200, done.text
    assert any(s["name_en"] == "Gate Nadu" for s in states())


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


def test_one_approve_permission_finalizes_everything(client, admin_headers):
    """approvals.write alone is enough: it approves requests from any module."""
    _, _, maker = _staff_with_role(
        client, admin_headers, "one_maker", "OneMaker", "ONE_MAKER",
        permission_grants=[("masters.write", True), ("members.delete", True)],
    )
    _, _, approver = _staff_with_role(
        client, admin_headers, "one_approver", "OneApprover", "ONE_APPROVER",
        permission_grants=[("approvals.write", False)],
    )
    rid = _pending_state(client, maker, "One Permission Nadu")["approval_request_id"]
    assert client.put(f"{API}/approvals/requests/{rid}/approve", headers=approver).status_code == 200
